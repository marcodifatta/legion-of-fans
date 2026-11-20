#!/usr/bin/env python3
"""SimpleDeckyTDP: Home 10 W (GPU BALANCE), every game profile 25 W (GPU BALANCE).
Run with sudo: stops Decky while editing so the plugin can't overwrite, keeps a backup."""
import json, os, shutil, subprocess, sys, time

import pwd
# Home of the user who ran sudo (falls back to the current user).
HOME = pwd.getpwnam(os.environ.get("SUDO_USER") or pwd.getpwuid(os.getuid()).pw_name).pw_dir
P = os.path.join(HOME, "homebrew/settings/SimpleDeckyTDP/settings.json")
if os.geteuid() != 0:
    sys.exit("Va eseguito con sudo.")

print("Fermo Decky...")
subprocess.run(["systemctl", "stop", "plugin_loader.service"], check=True)
time.sleep(2)
try:
    st = os.stat(P)
    shutil.copy2(P, P + ".bak-" + time.strftime("%Y%m%d-%H%M%S"))
    with open(P) as f:
        d = json.load(f)
    changed = 0
    for key, prof in d["tdpProfiles"].items():
        if key in ("default", "default-ac-power"):
            prof["tdp"], prof["gpuMode"] = 10, "BALANCE"
        else:
            if prof.get("tdp") != 25 or prof.get("gpuMode") != "BALANCE":
                changed += 1
            prof["tdp"], prof["gpuMode"] = 25, "BALANCE"
    tmp = P + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=4)
        f.flush(); os.fsync(f.fileno())
    os.chown(tmp, st.st_uid, st.st_gid)
    os.chmod(tmp, st.st_mode & 0o777)
    os.replace(tmp, P)
    print(f"Home: 10 W BALANCE. Profili gioco modificati: {changed} (tutti ora 25 W BALANCE)")
finally:
    print("Riavvio Decky...")
    subprocess.run(["systemctl", "start", "plugin_loader.service"], check=False)
print("Fatto.")
