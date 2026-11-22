"""CPU undervolt (AMD Curve Optimizer) for the Legion Go's Ryzen Z1 Extreme.

Uses the system `ryzenadj` (Bazzite ships it, with the ryzen_smu module).
Only negative or zero offsets are ever written, so the chip runs at the same
frequency with less voltage: same or better performance, less heat. A value that
is too aggressive can only cause a freeze/crash, never damage, and the offset is
reset by the hardware on every reboot and suspend.

Crash guard: before applying a non-zero value we write a marker with the current
boot id. The marker is removed on a clean plugin unload. If, at the next start,
the marker comes from a *previous* boot and that boot did not shut down cleanly,
the value is not re-applied until the user confirms it.
"""

import asyncio
import json
import os
import shutil
import subprocess
import time

import decky

BASELINE = 0x100000          # Curve Optimizer 0 in ryzenadj's encoding
CPU_MIN = -20                # prudent limit chosen for this device
SAFETY_MARGIN = 3            # final value = last stable + 3 (less negative)
TEST_PHASES = (              # (label, stress-ng args, seconds): all cores, then one core at max boost
    ("tutti i core", ["--cpu", "0", "--cpu-method", "all", "--verify"], 150),
    ("un core al massimo boost", ["--cpu", "1", "--cpu-method", "all", "--verify"], 150),
)

MARKER = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "undervolt-active.json")
CLEAN_SHUTDOWN = ("Reached target shutdown.target", "systemd-shutdown", "reboot: Power down",
                  "reboot: Restarting")


def ryzenadj():
    return shutil.which("ryzenadj") or ("/usr/bin/ryzenadj" if os.path.exists("/usr/bin/ryzenadj") else None)


def encode(value):
    value = max(CPU_MIN, min(0, int(value)))
    return hex(BASELINE + value)


def _run(args, timeout=10):
    exe = ryzenadj()
    if not exe:
        return False, "ryzenadj non trovato"
    env = dict(os.environ, LD_LIBRARY_PATH="")
    try:
        r = subprocess.run([exe, *args], capture_output=True, text=True, timeout=timeout, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)
    out = (r.stdout + r.stderr).strip()
    bad = any(w in out.lower() for w in ("fail", "not supported", "unsupported", "error"))
    return r.returncode == 0 and not bad, out


def set_cpu(value):
    ok, out = _run([f"--set-coall={encode(value)}"])
    decky.logger.info(f"Undervolt CPU {value}: ok={ok} {out[-160:]}")
    return ok, out


def set_gpu(value):
    ok, out = _run([f"--set-cogfx={encode(value)}"])
    decky.logger.info(f"Undervolt GPU {value}: ok={ok} {out[-160:]}")
    return ok, out


def check_support():
    """Phase 0: write offset 0 (no change) and see whether the firmware accepts it."""
    cpu_ok, cpu_out = set_cpu(0)
    gpu_ok, gpu_out = set_gpu(0)
    return {"cpu": cpu_ok, "gpu": gpu_ok, "cpu_msg": cpu_out[-200:], "gpu_msg": gpu_out[-200:],
            "ryzenadj": ryzenadj(), "checked": time.time()}


# ------------------------------------------------------------------ crash guard
def boot_id():
    try:
        with open("/proc/sys/kernel/random/boot_id") as f:
            return f.read().strip()
    except OSError:
        return None


def previous_boot_was_clean():
    try:
        r = subprocess.run(["journalctl", "-b", "-1", "-o", "cat", "-n", "400", "--no-pager"],
                           capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0 or not r.stdout.strip():
        return None
    return any(m in r.stdout for m in CLEAN_SHUTDOWN)


def write_marker(value):
    os.makedirs(os.path.dirname(MARKER), exist_ok=True)
    with open(MARKER, "w") as f:
        json.dump({"boot_id": boot_id(), "value": value, "time": time.time()}, f)


def clear_marker():
    try:
        os.remove(MARKER)
    except OSError:
        pass


def crash_suspected():
    """The value from the marker if the last boot with an active undervolt ended
    without a clean shutdown, else None."""
    try:
        with open(MARKER) as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    if m.get("boot_id") == boot_id():
        return None  # same boot: the plugin was just restarted
    clean = previous_boot_was_clean()
    return None if clean else m.get("value")


# ------------------------------------------------------------------ stability test
class StabilityTest:
    def __init__(self):
        self.proc = None
        self.task = None
        self.running = False
        self.value = None
        self.started = 0.0
        self.phase = ""
        self.total = sum(p[2] for p in TEST_PHASES)
        self.cancelled = False

    def progress(self):
        if not self.running:
            return None
        return {"value": self.value, "phase": self.phase,
                "elapsed": round(time.monotonic() - self.started), "total": self.total}

    async def run(self, value):
        """Run all phases; returns {"passed": bool, "details": str}."""
        exe = shutil.which("stress-ng")
        if not exe:
            return {"passed": False, "details": "stress-ng non trovato"}
        self.running, self.value, self.cancelled = True, value, False
        self.started = time.monotonic()
        details = []
        passed = True
        try:
            for label, args, secs in TEST_PHASES:
                self.phase = label
                self.proc = await asyncio.create_subprocess_exec(
                    exe, *args, "--timeout", f"{secs}s", "--metrics-brief",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
                out, _ = await self.proc.communicate()
                text = out.decode(errors="replace")
                failed_line = next((ln for ln in text.splitlines() if "failed:" in ln), "")
                ok = self.proc.returncode == 0 and failed_line.strip().endswith("failed: 0")
                if self.cancelled:
                    return {"passed": False, "details": "interrotto", "cancelled": True}
                details.append(f"{label}: {'ok' if ok else 'ERRORE'}")
                if not ok:
                    passed = False
                    details.append(text.strip().splitlines()[-1] if text.strip() else f"exit {self.proc.returncode}")
                    break
        finally:
            self.running = False
            self.proc = None
        return {"passed": passed, "details": " · ".join(details)}

    def cancel(self):
        self.cancelled = True
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.terminate()
            except ProcessLookupError:
                pass
