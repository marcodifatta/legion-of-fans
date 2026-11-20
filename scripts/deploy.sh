#!/usr/bin/env bash
# Install Legion of Fans on the Legion Go (run on the device with sudo).
# Usage: sudo bash deploy.sh <staging-dir-containing-"Legion of Fans"> [--disable-panel]
set -euo pipefail
STAGE="$1"
HOME_DIR="$(getent passwd "${SUDO_USER:-$USER}" | cut -d: -f6)"
PLUGINS="$HOME_DIR/homebrew/plugins"
PARKED="$HOME_DIR/homebrew/plugins-disabled"

systemctl stop plugin_loader.service
trap 'systemctl start plugin_loader.service' EXIT

if [[ "${2:-}" == "--disable-panel" && -d "$PLUGINS/Panel de Control" ]]; then
  mkdir -p "$PARKED"
  rm -rf "$PARKED/Panel de Control"
  mv "$PLUGINS/Panel de Control" "$PARKED/"
  echo "Panel de Control messo da parte in $PARKED (non cancellato)"
fi

if [[ "${2:-}" == "--remove-panel" ]]; then
  # Panel de Control (already parked) and Fantastic leftovers: plugin, settings, data, logs.
  for d in "$PARKED/Panel de Control" "$PLUGINS/Panel de Control" \
           "$HOME_DIR/homebrew/settings/Panel de Control" "$HOME_DIR/homebrew/data/Panel de Control" \
           "$HOME_DIR/homebrew/logs/Panel de Control" \
           "$HOME_DIR/homebrew/settings/Fantastic" "$HOME_DIR/homebrew/logs/Fantastic"; do
    [[ -e "$d" ]] && rm -rf "$d" && echo "rimosso: $d"
  done
  rmdir "$PARKED" 2>/dev/null || true
  # Keep the fan sensor visible (the thermal logger reads it), under our own name.
  if [[ -f /etc/modprobe.d/panel-de-control-legion-fan.conf ]]; then
    printf '# Legion of Fans: expose the Legion Go fan sensor (lenovo_wmi_other)\noptions lenovo_wmi_other expose_all_fans=Y\n' \
      > /etc/modprobe.d/legion-of-fans.conf
    rm -f /etc/modprobe.d/panel-de-control-legion-fan.conf
    echo "modprobe: panel-de-control-legion-fan.conf -> legion-of-fans.conf"
  fi
fi

rm -rf "$PLUGINS/Legion Fan" "$PLUGINS/Legion of Fans"
cp -R "$STAGE/Legion of Fans" "$PLUGINS/Legion of Fans"
chown -R root:root "$PLUGINS/Legion of Fans"
echo "Legion of Fans installato in $PLUGINS/Legion of Fans"
