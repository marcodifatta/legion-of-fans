"""Legion of Fans — Decky backend.

Drives the fan of the original Lenovo Legion Go (product 83E1) through the
embedded controller's 10-step fan table, reports temperatures and power, keeps
a 5-minute history and per-game session statistics, and can optionally protect
the device by temporarily capping the TDP while it is too hot.

EC facts (from the device DSDT, GZFD/SFAN; the same map Panel de Control uses):
  * the EC window is physical memory at 0xFE0B0000 (mapped via /dev/mem)
  * SFNT  (+0x30E): 1 = the EC follows the custom fan table, 0 = firmware curve
  * TABLE (+0x930): 10 bytes, fan duty in percent per firmware step
  * RPM   (+0x38B): 16-bit little-endian current fan speed
The table is indexed by a board sensor cooler than the APU, so we write the duty
we want (from the APU temperature) into every step, never below the firmware's
own minimums on the hot steps. The firmware drops SFNT back to 0 on some events
(e.g. platform-profile changes), so the loop re-asserts it every cycle.

Safety: every write is read back; at or above GUARD_TEMP_C, or when no
temperature can be read, the fan is driven at 100 %; on disable, unload or any
unexpected error the fan is handed back to the firmware (SFNT = 0) and any TDP
cap applied by the protection is undone.
"""

import asyncio
import glob
import json
import mmap
import os
import time
from collections import deque

import decky

# --- EC map -----------------------------------------------------------------
EC_BASE = 0xFE0B0000
EC_SIZE = 0x1000
SFNT = 0x30E
RPM = 0x38B
TABLE = 0x930
STEPS = 10
# Firmware minimum duty on the hot steps (None = no floor).
HOT_FLOOR = (None, None, None, None, None, 79, 87, 87, 100, 100)

SUPPORTED_PRODUCT = "83E1"
LOOP_INTERVAL_S = 1.0
GUARD_TEMP_C = 90
HISTORY_S = 300  # 5 minutes at one sample per second

# --- TDP (firmware attributes) and protection ---------------------------------
TDP_DIR = "/sys/class/firmware-attributes/lenovo-wmi-other-0/attributes"
TDP_RAILS = ("ppt_pl1_spl", "ppt_pl2_sppt", "ppt_pl3_fppt")
PROTECT_STEP_W = 3
PROTECT_FLOOR_W = 15
# Gradual: one -3 W step after `protect_interval_min` minutes above the threshold,
# one +3 W step after the same time spent cool, so games stay playable and the
# TDP does not see-saw.
PROTECT_COOL_DELTA = 8      # "cool" = this many degrees under the threshold
# Emergency brake: near the temperature where the device shut down (~93-94 C
# after ~4 min), cut at once, at most once a minute.
PROTECT_EMERGENCY_C = 92
PROTECT_EMERGENCY_EVERY_S = 60
PROTECT_EMERGENCY_HOLD_S = 5

SDTDP_SETTINGS = os.path.join(decky.DECKY_HOME, "settings", "SimpleDeckyTDP", "settings.json")

# --- curve ------------------------------------------------------------------
STEP_TEMPS = [40, 50, 60, 70, 80, 90]
PRESETS = {
    "silenziosa": [15, 25, 45, 75, 100, 100],
    "bilanciata": [20, 30, 50, 80, 100, 100],
    # Tuned on this device: quiet at idle (52-58 C), full speed from 70 C, which a
    # game at 25 W reaches within a minute or two.
    "ottimale": [20, 35, 60, 100, 100, 100],
    "massima": [40, 60, 100, 100, 100, 100],
}
# Modes without a fixed table.
AUTO_MODE = "automatica"
# Automatic mode: start from the optimal curve, then react to how fast the
# temperature is rising and to the APU load, and smooth the result so the fan
# speeds up quickly but slows down gently.
AUTO_TREND_WINDOW_S = 10
AUTO_TREND_GAIN = 40      # +40 % duty per +1 C/s of rise
AUTO_LOAD_W = 18          # APU power that means "a game is running"
AUTO_LOAD_FLOOR = 60      # minimum duty under that load
AUTO_MAX_UP = 15          # % per second
AUTO_MAX_DOWN = 3         # % per second
DEFAULT_SETTINGS = {
    "enabled": False,
    "preset": "ottimale",
    "steps": PRESETS["ottimale"],
    "alert_enabled": True,
    "alert_temp": 88,
    "protect_enabled": False,
    "protect_temp": 88,
    "protect_interval_min": 5,
    # Lenovo firmware charge limit (Long_Life = stop at ~80 %), re-applied at
    # start and checked every minute in case something resets it.
    "charge_limit": True,
}

CHARGE_TYPES = "/sys/class/power_supply/BATT/charge_types"

SETTINGS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")


def _read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def _int(path):
    v = _read(path)
    try:
        return int(v) if v is not None else None
    except ValueError:
        return None


def _num(path, scale=1.0, digits=1):
    v = _int(path)
    return None if v is None else round(v / scale, digits)


def _hwmon(name):
    for h in glob.glob("/sys/class/hwmon/hwmon*"):
        if _read(os.path.join(h, "name")) == name:
            return h
    return None


def interp(steps, temp):
    """Duty (0-100) for `temp` from the step table, linear between steps."""
    pts = list(zip(STEP_TEMPS, steps))
    if temp <= pts[0][0]:
        return pts[0][1]
    for (t0, d0), (t1, d1) in zip(pts, pts[1:]):
        if temp <= t1:
            return round(d0 + (d1 - d0) * (temp - t0) / (t1 - t0))
    return pts[-1][1]


def sanitize_steps(steps):
    """Clamp to 0-100, round to 5, make non-decreasing, lock the last step at 100."""
    out = []
    for v in list(steps)[: len(STEP_TEMPS)]:
        v = max(0, min(100, int(round(float(v) / 5) * 5)))
        if out:
            v = max(v, out[-1])
        out.append(v)
    while len(out) < len(STEP_TEMPS):
        out.append(100)
    out[-1] = 100
    return out


class EC:
    """Byte access to the EC window through /dev/mem. Maps per access so a
    mapping is never held open. Never raises."""

    def __init__(self):
        self.error = None

    def _access(self, fn):
        fd = os.open("/dev/mem", os.O_RDWR | os.O_SYNC)
        try:
            with mmap.mmap(fd, EC_SIZE, mmap.MAP_SHARED,
                           mmap.PROT_READ | mmap.PROT_WRITE, offset=EC_BASE) as win:
                return fn(win)
        finally:
            os.close(fd)

    def available(self):
        try:
            self._access(lambda w: w[0])
            return True
        except (OSError, ValueError) as e:
            self.error = f"{type(e).__name__}: {e}"
            return False

    def read(self, off):
        try:
            return self._access(lambda w: w[off])
        except (OSError, ValueError, IndexError):
            return None

    def write(self, off, val):
        def poke(w):
            w[off] = val & 0xFF
        try:
            self._access(poke)
            return True
        except (OSError, ValueError, IndexError) as e:
            decky.logger.error(f"EC write {off:#x}={val} failed: {e}")
            return False

    def rpm(self):
        lo, hi = self.read(RPM), self.read(RPM + 1)
        return None if lo is None or hi is None else (hi << 8) | lo

    def table(self):
        return [self.read(TABLE + i) for i in range(STEPS)]


def table_for(duty):
    return [duty if f is None else max(duty, f) for f in HOT_FLOOR]


def read_tdp():
    return {r: _int(f"{TDP_DIR}/{r}/current_value") for r in TDP_RAILS}


def write_tdp_rail(rail, watts):
    try:
        with open(f"{TDP_DIR}/{rail}/current_value", "w") as f:
            f.write(str(int(watts)))
        return True
    except OSError as e:
        decky.logger.error(f"TDP write {rail}={watts} failed: {e}")
        return False


def new_stats(appid=None, name=None):
    return {
        "appid": appid,
        "name": name,
        "started": time.time(),
        "seconds": 0,
        "temp_max": None,
        "temp_sum": 0.0,
        "temp_samples": 0,
        "above_85_s": 0,
        "above_90_s": 0,
        "rpm_max": None,
        "apu_w_max": None,
        "throttle_events": 0,
        "protect_events": 0,
    }


class Plugin:
    # ---------------------------------------------------------------- lifecycle
    async def _main(self):
        self.settings = self._load_settings()
        self.ec = EC()
        product = _read("/sys/class/dmi/id/product_name") or ""
        self.supported = product == SUPPORTED_PRODUCT
        self.ec_ok = self.supported and self.ec.available()
        self.driving = False
        self.last_duty = None
        self.reasserts = 0
        self.last_error = None if self.ec_ok else (
            self.ec.error if self.supported else f"modello non supportato ({product})")
        self.state = {}
        self.history = deque(maxlen=HISTORY_S)
        self.stats = new_stats()
        self._hot_since = None
        self._last_alert = 0.0
        self._prev_apu_w = None
        self._last_throttle = 0.0
        # protection
        self.cap = None              # current TDP cap in W, None = inactive
        self._cap_original = None    # rails before we started capping
        self._protect_hot_since = None
        self._protect_cool_since = None
        self._protect_emergency_since = None
        self._protect_last_step = 0.0
        decky.logger.info(f"Legion of Fans started: product={product} ec_ok={self.ec_ok}")
        self.task = asyncio.get_event_loop().create_task(self._loop())

    async def _unload(self):
        if getattr(self, "task", None):
            self.task.cancel()
        self._release()
        self._protect_restore()
        decky.logger.info("Legion of Fans unloaded, fan and TDP handed back")

    async def _uninstall(self):
        self._release()
        self._protect_restore()

    # ---------------------------------------------------------------- settings
    def _load_settings(self):
        s = dict(DEFAULT_SETTINGS)
        try:
            with open(SETTINGS_PATH) as f:
                s.update(json.load(f))
        except (OSError, ValueError):
            pass
        s["steps"] = sanitize_steps(s.get("steps", DEFAULT_SETTINGS["steps"]))
        s["alert_temp"] = max(70, min(95, int(s.get("alert_temp", 88))))
        s["protect_temp"] = max(75, min(90, int(s.get("protect_temp", 88))))
        s["protect_interval_min"] = max(3, min(15, int(s.get("protect_interval_min", 5))))
        return s

    def _save_settings(self):
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.settings, f, indent=2)
        os.replace(tmp, SETTINGS_PATH)

    # ---------------------------------------------------------------- sensors
    def _read_sensors(self):
        cpu, gpu, nvme, acpi, bath = (_hwmon(n) for n in ("k10temp", "amdgpu", "nvme", "acpitz", "BATT"))
        bat = "/sys/class/power_supply/BATT"
        busy = glob.glob("/sys/class/drm/card*/device/gpu_busy_percent")
        tdp = read_tdp()
        status = _read(f"{bat}/status")
        bat_w = _num(f"{bath}/power1_input", 1_000_000) if bath else None
        if bat_w is not None and status == "Discharging":
            bat_w = -bat_w
        pd_ma = None
        for p in glob.glob("/sys/class/power_supply/ucsi-source-psy-*"):
            if _read(f"{p}/online") == "1":
                pd_ma = _num(f"{p}/current_now", 1000, 0)
        return {
            "cpu_c": _num(f"{cpu}/temp1_input", 1000) if cpu else None,
            "gpu_c": _num(f"{gpu}/temp1_input", 1000) if gpu else None,
            "nvme_c": _num(f"{nvme}/temp1_input", 1000) if nvme else None,
            "board_c": _num(f"{acpi}/temp1_input", 1000) if acpi else None,
            "apu_w": _num(f"{gpu}/power1_input", 1_000_000) if gpu else None,
            "gpu_busy": _num(busy[0], 1, 0) if busy else None,
            "tdp_w": tdp["ppt_pl1_spl"],
            "tdp_slow_w": tdp["ppt_pl2_sppt"],
            "tdp_fast_w": tdp["ppt_pl3_fppt"],
            "battery_pct": _num(f"{bat}/capacity", 1, 0),
            "battery_status": status,
            "battery_w": bat_w,
            "charge_limit": "Long_Life" in (_read(f"{bat}/charge_types") or "").split("[")[-1],
            "ac_online": _read("/sys/class/power_supply/ACAD/online") == "1",
            "charger_ma": pd_ma,
            # USB-PD contract current only: the voltage is not exposed, 20 V assumed.
            "charger_max_w_est": round(20 * pd_ma / 1000) if pd_ma else None,
        }

    def _control_temp(self, s):
        temps = [t for t in (s.get("cpu_c"), s.get("gpu_c")) if t is not None]
        return max(temps) if temps else None

    # ---------------------------------------------------------------- EC drive
    def _drive(self, duty):
        table = table_for(duty)
        if self.ec.read(SFNT) == 1 and self.ec.table() == table:
            return True
        if self.driving and self.ec.read(SFNT) != 1:
            self.reasserts += 1
        # Table first, then the switch, so the EC never runs a half-written table.
        for i, pct in enumerate(table):
            self.ec.write(TABLE + i, pct)
        self.ec.write(SFNT, 1)
        ok = self.ec.read(SFNT) == 1 and self.ec.table() == table
        if not ok:
            self.last_error = "scrittura tabella ventola non confermata"
        return ok

    def _release(self):
        if not getattr(self, "ec_ok", False):
            return True
        if not self.driving:
            return True  # we never took the fan (or another tool owns it): leave it alone
        for _ in range(3):
            if self.ec.write(SFNT, 0) and self.ec.read(SFNT) == 0:
                self.driving = False
                self.last_duty = None
                return True
        decky.logger.error("Could not hand the fan back to firmware")
        return False

    # ---------------------------------------------------------------- protection
    async def _protect(self, temp, now):
        enabled = self.settings["protect_enabled"]
        limit = self.settings["protect_temp"]
        if not enabled or temp is None:
            if self.cap is not None and not enabled:
                self._protect_restore()
                await decky.emit("protect_event", "off", None, temp)
            self._protect_hot_since = self._protect_cool_since = None
            return

        interval = self.settings["protect_interval_min"] * 60
        hot = temp >= limit
        cool = temp <= limit - PROTECT_COOL_DELTA
        emergency = temp >= PROTECT_EMERGENCY_C
        self._protect_hot_since = (self._protect_hot_since or now) if hot else None
        self._protect_cool_since = (self._protect_cool_since or now) if cool else None
        self._protect_emergency_since = (
            (getattr(self, "_protect_emergency_since", None) or now) if emergency else None)
        since_step = now - self._protect_last_step

        gradual_cut = hot and now - self._protect_hot_since >= interval and since_step >= interval
        emergency_cut = (emergency and now - self._protect_emergency_since >= PROTECT_EMERGENCY_HOLD_S
                         and since_step >= PROTECT_EMERGENCY_EVERY_S)
        if gradual_cut or emergency_cut:
            current = read_tdp()
            if self.cap is None:
                self._cap_original = current
            base = self.cap if self.cap is not None else (current["ppt_pl1_spl"] or 25)
            new_cap = max(PROTECT_FLOOR_W, base - PROTECT_STEP_W)
            if new_cap < base:
                first = self.cap is None
                self.cap = new_cap
                self._protect_last_step = now
                self._protect_hot_since = now  # next gradual cut needs another full interval
                self.stats["protect_events"] += 1
                why = "emergency" if emergency_cut else "gradual"
                decky.logger.info(f"Protection ({why}): TDP capped at {new_cap} W ({temp} C)")
                await decky.emit("protect_event", "on" if first else "down", new_cap, temp)
        elif (self.cap is not None and cool and now - self._protect_cool_since >= interval
              and since_step >= interval):
            original = (self._cap_original or {}).get("ppt_pl1_spl") or 25
            self._protect_last_step = now
            self._protect_cool_since = now
            if self.cap + PROTECT_STEP_W >= original:
                self._protect_restore()
                await decky.emit("protect_event", "off", None, temp)
            else:
                self.cap += PROTECT_STEP_W
                decky.logger.info(f"Protection: TDP cap raised to {self.cap} W ({temp} C)")

        # Enforce the cap every cycle: SimpleDeckyTDP re-applies its profile
        # periodically, so a lowered value would otherwise be overwritten.
        if self.cap is not None:
            for rail, val in read_tdp().items():
                if val is not None and val > self.cap:
                    write_tdp_rail(rail, self.cap)

    def _protect_restore(self):
        if getattr(self, "cap", None) is None:
            return
        for rail, val in (self._cap_original or {}).items():
            if val is not None:
                write_tdp_rail(rail, val)
        decky.logger.info("Protection: TDP restored")
        self.cap = None
        self._cap_original = None

    # ---------------------------------------------------------------- stats
    def _update_stats(self, s, temp, now):
        st = self.stats
        st["seconds"] += LOOP_INTERVAL_S
        if temp is not None:
            st["temp_max"] = temp if st["temp_max"] is None else max(st["temp_max"], temp)
            st["temp_sum"] += temp
            st["temp_samples"] += 1
            if temp >= 85:
                st["above_85_s"] += LOOP_INTERVAL_S
            if temp >= 90:
                st["above_90_s"] += LOOP_INTERVAL_S
        rpm, w = s.get("fan_rpm"), s.get("apu_w")
        if rpm is not None:
            st["rpm_max"] = rpm if st["rpm_max"] is None else max(st["rpm_max"], rpm)
        if w is not None:
            st["apu_w_max"] = w if st["apu_w_max"] is None else max(st["apu_w_max"], w)
        # Firmware power cut: APU power suddenly drops by 35 %+ from near the
        # TDP limit while hot (the pattern seen before the shutdowns).
        prev, tdp = self._prev_apu_w, s.get("tdp_w")
        if (prev is not None and w is not None and tdp and temp is not None and temp >= 85
                and prev >= tdp - 3 and w < prev * 0.65 and now - self._last_throttle >= 20):
            st["throttle_events"] += 1
            self._last_throttle = now
        self._prev_apu_w = w

    # ---------------------------------------------------------------- automatic mode
    def _temp_trend(self, now):
        """Temperature change in C/s over the last AUTO_TREND_WINDOW_S seconds."""
        past = [(t, temp) for t, temp, _, _ in self.history
                if temp is not None and now - t >= AUTO_TREND_WINDOW_S - 1]
        if not past or not self.history or self.history[-1][1] is None:
            return 0.0
        t0, temp0 = past[-1]
        t1, temp1 = self.history[-1][0], self.history[-1][1]
        return (temp1 - temp0) / max(1.0, t1 - t0)

    def _auto_duty(self, temp, s, now):
        target = interp(PRESETS["ottimale"], temp)
        target += max(0.0, self._temp_trend(now)) * AUTO_TREND_GAIN
        if (s.get("apu_w") or 0) >= AUTO_LOAD_W:
            target = max(target, AUTO_LOAD_FLOOR)
        target = max(0, min(100, round(target)))
        prev = self.last_duty if self.last_duty is not None else target
        if target > prev:
            return min(target, prev + AUTO_MAX_UP)
        return max(target, prev - AUTO_MAX_DOWN)

    def _duty_for(self, temp, s, now):
        if temp is None or temp >= GUARD_TEMP_C:
            return 100
        if self.settings["preset"] == AUTO_MODE:
            return self._auto_duty(temp, s, now)
        return interp(self.settings["steps"], temp)

    # ---------------------------------------------------------------- charge limit
    def _apply_charge_limit(self):
        current = _read(CHARGE_TYPES)
        if current is None:
            return
        want = "Long_Life" if self.settings["charge_limit"] else "Standard"
        selected = current.split("[")[-1].split("]")[0] if "[" in current else current
        if selected != want:
            try:
                with open(CHARGE_TYPES, "w") as f:
                    f.write(want)
                decky.logger.info(f"Charge limit: {selected} -> {want}")
            except OSError as e:
                decky.logger.error(f"Charge limit write failed: {e}")

    # ---------------------------------------------------------------- loop
    async def _loop(self):
        last_charge_check = -1e9
        while True:
            try:
                now = time.monotonic()
                s = self._read_sensors()
                temp = self._control_temp(s)
                if self.ec_ok and self.settings["enabled"]:
                    duty = self._duty_for(temp, s, now)
                    if self._drive(duty):
                        self.driving = True
                        self.last_duty = duty
                elif self.driving:
                    self._release()
                s["fan_rpm"] = self.ec.rpm() if self.ec_ok else None
                s["control_temp"] = temp
                s["updated"] = time.time()
                self.state = s
                self.history.append((now, temp, s["fan_rpm"], s.get("apu_w")))
                self._update_stats(s, temp, now)
                await self._protect(temp, now)
                await self._check_alert(temp, now)
                if now - last_charge_check >= 60:
                    last_charge_check = now
                    self._apply_charge_limit()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # never leave the fan stuck on our table
                self.last_error = f"{type(e).__name__}: {e}"
                decky.logger.exception("loop error")
                self._release()
            await asyncio.sleep(LOOP_INTERVAL_S)

    async def _check_alert(self, temp, now):
        if not self.settings["alert_enabled"] or temp is None:
            self._hot_since = None
            return
        if temp >= self.settings["alert_temp"]:
            self._hot_since = self._hot_since or now
            if now - self._hot_since >= 10 and now - self._last_alert >= 120:
                self._last_alert = now
                await decky.emit("temp_alert", temp)
        else:
            self._hot_since = None

    # ---------------------------------------------------------------- game
    def _game_profile(self, appid):
        try:
            with open(SDTDP_SETTINGS) as f:
                d = json.load(f)
        except (OSError, ValueError):
            return None
        profiles = d.get("tdpProfiles", {})
        prof = profiles.get(str(appid)) if appid and d.get("enableTdpProfiles") else None
        source = "gioco" if prof else "predefinito"
        prof = prof or profiles.get("default") or {}
        return {"tdp": prof.get("tdp"), "gpu_mode": prof.get("gpuMode"), "source": source}

    # ---------------------------------------------------------------- frontend API
    async def get_state(self, appid=None, name=None):
        appid = int(appid) if appid else None
        if appid != self.stats["appid"]:
            self.stats = new_stats(appid, name)
        st = dict(self.stats)
        st["temp_avg"] = round(st["temp_sum"] / st["temp_samples"], 1) if st["temp_samples"] else None
        return {
            "supported": self.supported,
            "ec_ok": self.ec_ok,
            "driving": self.driving,
            "duty": self.last_duty,
            "reasserts": self.reasserts,
            "error": self.last_error,
            "guard_temp": GUARD_TEMP_C,
            "step_temps": STEP_TEMPS,
            "presets": PRESETS,
            "auto_mode": AUTO_MODE,
            "settings": self.settings,
            "sensors": self.state,
            "stats": st,
            "game": {"appid": appid, "name": name, "profile": self._game_profile(appid)},
            "protect": {"cap": self.cap, "floor": PROTECT_FLOOR_W, "step": PROTECT_STEP_W,
                        "emergency_temp": PROTECT_EMERGENCY_C},
        }

    async def get_history(self):
        """[[seconds_ago, temp, rpm, apu_w], ...] oldest first, one point every 2 s."""
        now = time.monotonic()
        pts = list(self.history)[::2]
        return [[round(now - t), temp, rpm, w] for t, temp, rpm, w in pts]

    async def reset_stats(self):
        self.stats = new_stats(self.stats["appid"], self.stats["name"])
        return True

    async def set_enabled(self, enabled: bool):
        self.settings["enabled"] = bool(enabled) and self.ec_ok
        self._save_settings()
        if not self.settings["enabled"]:
            self._release()
        return True

    async def set_steps(self, steps: list):
        self.settings["steps"] = sanitize_steps(steps)
        self.settings["preset"] = next(
            (k for k, v in PRESETS.items() if v == self.settings["steps"]), "personalizzata")
        self._save_settings()
        return True

    async def apply_preset(self, name: str):
        if name in PRESETS:
            self.settings["steps"] = list(PRESETS[name])
            self.settings["preset"] = name
            self._save_settings()
        elif name == AUTO_MODE:
            self.settings["preset"] = AUTO_MODE  # keeps the last steps for later
            self._save_settings()
        return True

    async def set_alert(self, enabled: bool, temp: int):
        self.settings["alert_enabled"] = bool(enabled)
        self.settings["alert_temp"] = max(70, min(95, int(temp)))
        self._save_settings()
        return True

    async def set_charge_limit(self, enabled: bool):
        self.settings["charge_limit"] = bool(enabled)
        self._save_settings()
        self._apply_charge_limit()
        return True

    async def set_protect(self, enabled: bool, temp: int, interval_min: int = 5):
        self.settings["protect_enabled"] = bool(enabled)
        self.settings["protect_temp"] = max(75, min(90, int(temp)))
        self.settings["protect_interval_min"] = max(3, min(15, int(interval_min)))
        self._save_settings()
        return True
