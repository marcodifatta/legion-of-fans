#!/usr/bin/env bash
# Thermal logger for Legion Go (Bazzite). Runs as a user service, no root needed.
# Writes one CSV line every INTERVAL seconds to ~/thermal-log/YYYY-MM-DD.csv,
# flushing each line to disk so the last seconds before a hard power-off survive.

INTERVAL="${INTERVAL:-5}"
KEEP_DAYS="${KEEP_DAYS:-7}"
LOG_DIR="$HOME/thermal-log"
mkdir -p "$LOG_DIR"

hwmon() { for h in /sys/class/hwmon/hwmon*; do [ "$(cat "$h/name" 2>/dev/null)" = "$1" ] && { echo "$h"; return; }; done; }
rd() { cat "$1" 2>/dev/null || echo ""; }
# milli-units -> units with 1 decimal
m1() { local v; v=$(rd "$1"); [ -n "$v" ] && awk -v v="$v" 'BEGIN{printf "%.1f", v/1000}'; }
# micro-units -> units with 1 decimal
u1() { local v; v=$(rd "$1"); [ -n "$v" ] && awk -v v="$v" 'BEGIN{printf "%.1f", v/1000000}'; }

CPU=$(hwmon k10temp); GPU=$(hwmon amdgpu); ACPI=$(hwmon acpitz); NVME=$(hwmon nvme); BATH=$(hwmon BATT)
BAT=/sys/class/power_supply/BATT
AC=/sys/class/power_supply/ACAD
PPT=/sys/class/firmware-attributes/lenovo-wmi-other-0/attributes
PROF=$(for p in /sys/class/platform-profile/*; do [ "$(cat "$p/name")" = "lenovo-wmi-gamezone" ] && echo "$p"; done)
GPUBUSY=$(ls /sys/class/drm/card*/device/gpu_busy_percent 2>/dev/null | head -1)

HEADER="time,cpu_c,gpu_c,acpi_c,nvme_c,gpu_w,gpu_avg_w,gpu_busy_pct,gpu_mhz,bat_w,bat_pct,bat_status,ac_online,tdp_spl,tdp_sppt,tdp_fppt,profile,load1,fan_rpm,cpu_mhz"

last_cleanup=0
while true; do
  f="$LOG_DIR/$(date +%F).csv"
  [ -s "$f" ] || echo "$HEADER" > "$f"
  # fan hwmon only appears once a tool (e.g. Panel de Control) exposes it, so look it up each time
  FAN=$(hwmon lenovo_wmi_other)
  gmhz=$(rd "$GPU/freq1_input"); [ -n "$gmhz" ] && gmhz=$((gmhz / 1000000))
  line="$(date +%FT%T),$(m1 "$CPU/temp1_input"),$(m1 "$GPU/temp1_input"),$(m1 "$ACPI/temp1_input"),$(m1 "$NVME/temp1_input"),$(u1 "$GPU/power1_input"),$(u1 "$GPU/power1_average"),$(rd "$GPUBUSY"),$gmhz,$(u1 "$BATH/power1_input"),$(rd "$BAT/capacity"),$(rd "$BAT/status"),$(rd "$AC/online"),$(rd "$PPT/ppt_pl1_spl/current_value"),$(rd "$PPT/ppt_pl2_sppt/current_value"),$(rd "$PPT/ppt_pl3_fppt/current_value"),$(rd "$PROF/profile"),$(cut -d' ' -f1 /proc/loadavg),$([ -n "$FAN" ] && rd "$FAN/fan1_input"),$(cat /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq 2>/dev/null | awk '{s+=$1;n++} END{if(n) printf "%d", s/n/1000}')"
  echo "$line" >> "$f"
  sync "$f" 2>/dev/null

  now=$(date +%s)
  if (( now - last_cleanup > 3600 )); then
    find "$LOG_DIR" -name '*.csv' -mtime +"$KEEP_DAYS" -delete 2>/dev/null
    last_cleanup=$now
  fi
  sleep "$INTERVAL"
done
