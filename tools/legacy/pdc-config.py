#!/usr/bin/env python3
"""Configure Panel de Control on the Legion Go (run as root):
- hand TDP back to SimpleDeckyTDP (tdp_control_enabled = False)
- set the global fan curve: gradual below 60 C, 100% from 60 C up.
Stops Decky while editing so Panel cannot overwrite the files, backs them up first.
"""
import json, os, shutil, subprocess, sys, time

import pwd
# Home of the user who ran sudo (falls back to the current user).
HOME = pwd.getpwnam(os.environ.get("SUDO_USER") or pwd.getpwuid(os.getuid()).pw_name).pw_dir
D = os.path.join(HOME, "homebrew/settings/Panel de Control")
STATE = os.path.join(D, "state.json")
FANS = os.path.join(D, "fan_curves.json")

# [temp C, pwm 0-255]  ->  16%, 25%, 35%, 50%, 70%, 86%, 100%, 100%
CURVE = [[35, 40], [40, 64], [45, 90], [50, 128], [55, 180], [58, 220], [60, 255], [70, 255]]

if os.geteuid() != 0:
    sys.exit("Va eseguito con sudo.")

def load(p):
    with open(p) as f:
        return json.load(f)

def save(p, data):
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.flush(); os.fsync(f.fileno())
    shutil.copymode(p, tmp)
    os.chown(tmp, 0, 0)
    os.replace(tmp, p)

print("Fermo Decky...")
subprocess.run(["systemctl", "stop", "plugin_loader.service"], check=True)
time.sleep(2)
try:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for p in (STATE, FANS):
        shutil.copy2(p, f"{p}.bak-{stamp}")

    state = load(STATE)
    print("TDP Panel prima:", state.get("tdp_control_enabled"))
    state["tdp_control_enabled"] = False
    save(STATE, state)

    fans = load(FANS)
    print("Curva globale prima:", json.dumps(fans.get("global")))
    fans["global"] = {"preset": "custom", "points": CURVE}
    games = fans.get("games") or {}
    for appid, prof in games.items():
        # make every per-game profile follow the global curve
        prof["follow_global"] = True
    fans["games"] = games
    save(FANS, fans)
    print("Curva globale ora:", json.dumps(fans["global"]))
    print("Profili per gioco messi su 'segui globale':", list(games.keys()) or "nessuno")
finally:
    print("Riavvio Decky...")
    subprocess.run(["systemctl", "start", "plugin_loader.service"], check=False)
print("Fatto.")
