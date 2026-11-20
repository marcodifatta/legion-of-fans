#!/usr/bin/env python3
"""Legion Go tuning (run with sudo):
1. Panel de Control fan curve: quiet at idle, 100% from 70 C; every game follows it.
2. Battery charge limit 80% (Panel setting + firmware Long_Life right away).
3. Hardware clock in UTC (no Windows on the device any more).
Decky is stopped while Panel's files are edited; backups are kept."""
import json, os, shutil, subprocess, sys, time

import pwd
# Home of the user who ran sudo (falls back to the current user).
HOME = pwd.getpwnam(os.environ.get("SUDO_USER") or pwd.getpwuid(os.getuid()).pw_name).pw_dir
D = os.path.join(HOME, "homebrew/settings/Panel de Control")
STATE = os.path.join(D, "state.json")
FANS = os.path.join(D, "fan_curves.json")
CHARGE = "/sys/class/power_supply/BATT/charge_types"
# [temp C, pwm 0-255] -> 20%, 35%, 45%, 60%, 80%, 100%, 100%, 100%
CURVE = [[40, 51], [50, 89], [55, 115], [60, 153], [65, 204], [70, 255], [80, 255], [90, 255]]

if os.geteuid() != 0:
    sys.exit("Va eseguito con sudo.")

def load(p):
    with open(p) as f:
        return json.load(f)

def save(p, data):
    st = os.stat(p)
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.flush(); os.fsync(f.fileno())
    os.chown(tmp, st.st_uid, st.st_gid)
    os.chmod(tmp, st.st_mode & 0o777)
    os.replace(tmp, p)

print("Fermo Decky...")
subprocess.run(["systemctl", "stop", "plugin_loader.service"], check=True)
time.sleep(2)
try:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for p in (STATE, FANS):
        shutil.copy2(p, f"{p}.bak-{stamp}")

    fans = load(FANS)
    fans["global"] = {"preset": "custom", "points": CURVE}
    games = fans.get("games") or {}
    for prof in games.values():
        prof["follow_global"] = True
    fans["games"] = games
    save(FANS, fans)
    print("1) Curva ventola globale:", CURVE)
    print("   Profili per gioco ora su 'segui globale':", list(games) or "nessuno")

    state = load(STATE)
    state["charge_limit_enabled"] = True
    state["charge_limit_percent"] = 80
    save(STATE, state)
    with open(CHARGE, "w") as f:
        f.write("Long_Life")
    with open(CHARGE) as f:
        print("2) Limite di carica 80%. charge_types ora:", f.read().strip())
finally:
    print("Riavvio Decky...")
    subprocess.run(["systemctl", "start", "plugin_loader.service"], check=False)

subprocess.run(["timedatectl", "set-local-rtc", "0"], check=False)
out = subprocess.run(["timedatectl"], capture_output=True, text=True).stdout
print("3) Orologio:", " | ".join(l.strip() for l in out.splitlines() if "RTC" in l or "Local time" in l))
print("Fatto.")
