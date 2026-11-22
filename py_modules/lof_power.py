"""TDP, GPU and CPU controls for the original Lenovo Legion Go (83E1).

Mirrors what SimpleDeckyTDP does on this device, so its per-game profiles can be
imported unchanged:
  * TDP: platform profile `custom` (lenovo-wmi-gamezone) + the three PPT rails of
    lenovo-wmi-other (fast, slow, sustained), each clamped to its firmware range.
  * GPU: amdgpu `power_dpm_force_performance_level` (low / auto / manual) and, in
    manual mode, the SCLK range through `pp_od_clk_voltage`.
  * CPU: SMT, core performance boost, cpufreq governor and EPP.
Every function returns True on success and never raises.
"""

import glob
import os
import time

import decky

WMI = "/sys/class/firmware-attributes/lenovo-wmi-other-0/attributes"
# Written in this order (fast first), like SimpleDeckyTDP.
RAILS = ("ppt_pl3_fppt", "ppt_pl2_sppt", "ppt_pl1_spl")
RAIL_WRITE_DELAY_S = 0.3

GPU_MODES = ("BATTERY", "BALANCE", "RANGE", "FIXED")
GPU_LEVEL = {"BATTERY": "low", "BALANCE": "auto", "RANGE": "manual", "FIXED": "manual"}

DEFAULT_PROFILE = {
    "tdp": 15,
    "gpuMode": "BALANCE",
    "minGpuFrequency": 800,
    "maxGpuFrequency": 2700,
    "fixedGpuFrequency": 1750,
    "smt": True,
    "cpuBoost": True,
    "powerGovernor": "performance",
    "epp": "performance",
}


def _read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def _write(path, value):
    try:
        with open(path, "w") as f:
            f.write(str(value))
        return True
    except OSError as e:
        decky.logger.error(f"write {path}={value} failed: {e}")
        return False


def _int(path):
    v = _read(path)
    try:
        return int(v) if v is not None else None
    except ValueError:
        return None


# ------------------------------------------------------------------ TDP
def platform_profile_path():
    for p in glob.glob("/sys/class/platform-profile/*"):
        if _read(os.path.join(p, "name")) == "lenovo-wmi-gamezone":
            return os.path.join(p, "profile")
    return None


def rail_limits():
    return {r: (_int(f"{WMI}/{r}/min_value") or 5, _int(f"{WMI}/{r}/max_value") or 30) for r in RAILS}


def read_rails():
    return {r: _int(f"{WMI}/{r}/current_value") for r in RAILS}


def wmi_ready():
    return all(os.path.exists(f"{WMI}/{r}/current_value") for r in RAILS) and platform_profile_path() is not None


def rail_targets(tdp):
    """Same watt value on every rail, clamped to each rail's firmware range
    (e.g. 40 W -> fast 40, slow 35, sustained 30)."""
    return {r: max(lo, min(hi, int(tdp))) for r, (lo, hi) in rail_limits().items()}


def tdp_matches(tdp):
    return read_rails() == rail_targets(tdp) and _read(platform_profile_path() or "") == "custom"


def set_tdp(tdp, retries=3):
    targets = rail_targets(tdp)
    for attempt in range(retries):
        prof = platform_profile_path()
        if prof and _read(prof) != "custom":
            _write(prof, "custom")
            time.sleep(RAIL_WRITE_DELAY_S)
        ok = True
        for rail in RAILS:
            if _int(f"{WMI}/{rail}/current_value") != targets[rail]:
                ok = _write(f"{WMI}/{rail}/current_value", targets[rail]) and ok
                time.sleep(RAIL_WRITE_DELAY_S)
        if ok and read_rails() == targets:
            return True
        time.sleep(RAIL_WRITE_DELAY_S * (attempt + 1))
    decky.logger.error(f"TDP {tdp} W not confirmed after {retries} attempts: {read_rails()}")
    return False


# ------------------------------------------------------------------ GPU
def _gpu_dir():
    d = glob.glob("/sys/class/drm/card*/device/power_dpm_force_performance_level")
    return os.path.dirname(d[0]) if d else None


def gpu_clock_range():
    d = _gpu_dir()
    txt = _read(f"{d}/pp_od_clk_voltage") if d else None
    if txt and "SCLK:" in txt:
        nums = [int(x.replace("Mhz", "").replace("MHz", "")) for x in txt.split("SCLK:")[-1].split()[:2]]
        if len(nums) == 2:
            return nums
    return [800, 2700]


def gpu_level():
    d = _gpu_dir()
    return _read(f"{d}/power_dpm_force_performance_level") if d else None


def gpu_matches(profile):
    return gpu_level() == GPU_LEVEL.get(profile.get("gpuMode"), "auto")


def set_gpu(profile):
    d = _gpu_dir()
    if not d:
        return False
    mode = profile.get("gpuMode", "BALANCE")
    level = GPU_LEVEL.get(mode, "auto")
    ok = _write(f"{d}/power_dpm_force_performance_level", level)
    if mode in ("RANGE", "FIXED"):
        lo, hi = gpu_clock_range()
        if mode == "RANGE":
            fmin = max(lo, min(hi, int(profile.get("minGpuFrequency", lo))))
            fmax = max(fmin, min(hi, int(profile.get("maxGpuFrequency", hi))))
        else:
            fmin = fmax = max(lo, min(hi, int(profile.get("fixedGpuFrequency", 1750))))
        time.sleep(0.1)
        od = f"{d}/pp_od_clk_voltage"
        ok = _write(od, f"s 0 {fmin}") and _write(od, f"s 1 {fmax}") and _write(od, "c") and ok
    return ok


# ------------------------------------------------------------------ CPU
SMT = "/sys/devices/system/cpu/smt/control"
BOOST = "/sys/devices/system/cpu/cpufreq/boost"


def cpu_options():
    return {
        "governors": (_read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors") or "").split(),
        "epps": (_read("/sys/devices/system/cpu/cpu0/cpufreq/energy_performance_available_preferences") or "").split(),
        "smt_supported": _read(SMT) not in (None, "notsupported", "forceoff"),
        "boost_supported": os.path.exists(BOOST),
    }


def _cpufreq_files(name):
    return glob.glob(f"/sys/devices/system/cpu/cpu[0-9]*/cpufreq/{name}")


def cpu_state():
    gov = _read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")
    epp = _read("/sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference")
    return {"smt": _read(SMT) == "on", "cpuBoost": _read(BOOST) == "1", "powerGovernor": gov, "epp": epp}


def cpu_matches(profile):
    st = cpu_state()
    if st["smt"] != bool(profile.get("smt", True)) or st["cpuBoost"] != bool(profile.get("cpuBoost", True)):
        return False
    if profile.get("powerGovernor") and st["powerGovernor"] != profile["powerGovernor"]:
        return False
    # With the performance governor amd-pstate pins EPP to "performance".
    if st["powerGovernor"] != "performance" and profile.get("epp") and st["epp"] != profile["epp"]:
        return False
    return True


def set_smt(enabled):
    want = "on" if enabled else "off"
    return _read(SMT) == want or _write(SMT, want)


def set_cpu(profile):
    opts = cpu_options()
    ok = True
    if opts["smt_supported"]:
        ok = set_smt(profile.get("smt", True)) and ok
    if opts["boost_supported"]:
        want = "1" if profile.get("cpuBoost", True) else "0"
        if _read(BOOST) != want:
            ok = _write(BOOST, want) and ok
    gov = profile.get("powerGovernor")
    if gov in opts["governors"]:
        for f in _cpufreq_files("scaling_governor"):
            if _read(f) != gov:
                ok = _write(f, gov) and ok
    epp = profile.get("epp")
    if epp in opts["epps"] and gov != "performance":
        for f in _cpufreq_files("energy_performance_preference"):
            if _read(f) != epp:
                ok = _write(f, epp) and ok
    return ok


# ------------------------------------------------------------------ SimpleDeckyTDP import
def profile_from_sdtdp(p):
    """Convert one SimpleDeckyTDP profile to ours (amd-pstate-epp power controls)."""
    pc = (p.get("powerControls") or {}).get("amd-pstate-epp") or {}
    out = dict(DEFAULT_PROFILE)
    for k in ("tdp", "gpuMode", "minGpuFrequency", "maxGpuFrequency", "fixedGpuFrequency", "smt", "cpuBoost"):
        if k in p:
            out[k] = p[k]
    if out["gpuMode"] not in GPU_MODES:
        out["gpuMode"] = "BALANCE"
    out["powerGovernor"] = pc.get("powerGovernor", out["powerGovernor"])
    out["epp"] = pc.get("epp", out["epp"])
    return out
