/**
 * Shared Raspberry Pi SSH Kiosk & Watchdog Provisioning Scripts
 *
 * Supports:
 *  - Official DAKboard OS (DAKOS: /home/dakboard/startup/*, Openbox/LXDE/Wayland, pi/dakboard users)
 *  - Raspberry Pi OS Bookworm / Trixie (Wayland: labwc & wayfire)
 *  - Raspberry Pi OS Bullseye / Buster (X11: LXDE-pi & Openbox autostart)
 *  - FullPageOS (/boot/firmware/fullpageos.txt & /boot/fullpageos.txt)
 *
 * All generated shell scripts normalize line endings to LF (\n) so they execute
 * cleanly over SSH from Windows, macOS, or Linux hosts.
 */

function normalizeLf(script: string): string {
  return script.replace(/\r\n/g, "\n");
}

function escapeBashDoubleQuoted(val: string): string {
  return String(val || "").replace(/[\\"$`]/g, "\\$&");
}

/**
 * Read-only diagnostic script (`--inspect`) that safely inventories a Raspberry Pi
 * (OS, hardware model, active user, display stack, DAKboard startup scripts, and
 * currently open Chromium URL) without modifying anything on disk.
 */
export function generateRaspberryPiInspectScript(): string {
  const raw = `#!/usr/bin/env bash
set -u

echo "=================================================================="
echo " FLEET TV — RASPBERRY PI READ-ONLY DIAGNOSTIC (--inspect)"
echo "=================================================================="
echo "Hostname       : $(hostname)"
echo "Local IP(s)    : $(hostname -I 2>/dev/null || echo 'unknown')"
if [ -f /proc/device-tree/model ]; then
  echo "Hardware Model : $(tr -d '\\0' < /proc/device-tree/model)"
fi
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "OS Release     : \${PRETTY_NAME:-unknown}"
fi
echo "Kernel / Arch  : $(uname -sr) ($(uname -m))"
echo "Uptime         : $(uptime -p 2>/dev/null || uptime)"

if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
  RAW_T=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)
  awk "BEGIN {printf \\"CPU Temp       : %.1f C\\\\n\\", $RAW_T/1000}"
fi

echo ""
echo "--- Desktop / Kiosk Users & Display Stack ---"
echo "SSH User       : $(whoami) (SUDO_USER=\${SUDO_USER:-none})"
echo "Logged-in GUI  : $(who 2>/dev/null | tr '\\n' '; ' || echo 'none')"

for bin in chromium chromium-browser; do
  if command -v "$bin" >/dev/null 2>&1; then
    echo "Chromium Bin   : $(command -v "$bin") ($("$bin" --version 2>/dev/null | head -n 1))"
  fi
done

if pgrep -x labwc >/dev/null 2>&1; then
  echo "Compositor     : Wayland (labwc)"
elif pgrep -x wayfire >/dev/null 2>&1; then
  echo "Compositor     : Wayland (wayfire)"
elif pgrep -x lxsession >/dev/null 2>&1; then
  echo "Compositor     : X11 (LXDE)"
elif pgrep -x openbox >/dev/null 2>&1; then
  echo "Compositor     : X11 (Openbox)"
elif pgrep -x Xorg >/dev/null 2>&1; then
  echo "Compositor     : X11 (Xorg)"
else
  echo "Compositor     : Headless / Custom"
fi

echo ""
echo "--- Active Browser Command Line (Current Kiosk / DAKboard URL) ---"
ps -eo user,pid,args | grep -E "[c]hromium" | grep -v "type=renderer" | grep -v "type=gpu" | grep -v "type=utility" | head -n 5 || echo "(No Chromium process currently running)"

echo ""
echo "--- Detected Startup / DAKboard Config Files ---"
FOUND_ANY=0
for f in \\
  /home/dakboard/startup/* \\
  /home/pi/startup/* \\
  /home/*/kiosk*.sh \\
  /etc/xdg/lxsession/LXDE-pi/autostart \\
  /home/*/.config/lxsession/LXDE-pi/autostart \\
  /etc/xdg/openbox/autostart \\
  /home/*/.config/openbox/autostart \\
  /home/*/.xinitrc \\
  /home/*/.xsession \\
  /home/*/.config/wayfire.ini \\
  /home/*/.config/labwc/autostart \\
  /home/*/.config/autostart/*.desktop \\
  /boot/firmware/fullpageos.txt \\
  /boot/fullpageos.txt \\
  /etc/rc.local \\
  /etc/fleet-tv-kiosk.env; do
  if [ -e "$f" ]; then
    echo "  [FOUND] $f"
    FOUND_ANY=1
  fi
done
if [ "$FOUND_ANY" = "0" ]; then
  echo "  (No standard autostart files found)"
fi

echo ""
echo "--- Kiosk / Watchdog Systemd Services ---"
systemctl list-unit-files --type=service --no-pager 2>/dev/null | grep -Ei "dakboard|kiosk|tv-display|fullpage" || echo "  (No matching systemd services)"
echo "=================================================================="
`;
  return normalizeLf(raw);
}

/**
 * Generates the idempotent Raspberry Pi Kiosk + HDMI-CEC Watchdog installer script.
 * Safely backs up any existing DAKboard / autostart configuration on first run,
 * creates `/usr/local/bin/fleet-tv-restore-dakboard.sh` for 1-command rollback,
 * switches Chromium fullscreen kiosk to the Fleet TV URL immediately, and installs
 * `tv-display-watchdog.service`.
 */
export function generateRaspberryPiKioskScript(
  serverOrigin: string,
  displayId: string,
  deviceToken = "",
): string {
  const cleanOrigin = serverOrigin.replace(/\/+$/, "");
  const safeDisplayId = displayId.replace(/[^a-zA-Z0-9_-]/g, "") || "breakroom";
  const safeToken = escapeBashDoubleQuoted(deviceToken.trim());
  const safeOrigin = escapeBashDoubleQuoted(cleanOrigin);

  const raw = `#!/usr/bin/env bash
# ==============================================================================
# Fleet & TV Display — Remote SSH Kiosk & HDMI-CEC Watchdog Provisioner
# Display ID : ${safeDisplayId}
# Server URL : ${safeOrigin}
# ==============================================================================
set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Please run this installer as root (e.g. sudo bash)." >&2
  exit 1
fi

DISPLAY_ID="${safeDisplayId}"
DISPLAY_TOKEN="${safeToken}"
SERVER_URL="${safeOrigin}"

if [ -n "$DISPLAY_TOKEN" ]; then
  KIOSK_URL="\${SERVER_URL}/display?display=\${DISPLAY_ID}&token=\${DISPLAY_TOKEN}"
else
  KIOSK_URL="\${SERVER_URL}/display?display=\${DISPLAY_ID}"
fi

ENV_FILE="/etc/fleet-tv-kiosk.env"
LAUNCH_SCRIPT="/usr/local/bin/fleet-tv-launch.sh"
RESTORE_SCRIPT="/usr/local/bin/fleet-tv-restore-dakboard.sh"
AGENT_PATH="/usr/local/bin/tv-display-watchdog.sh"
SERVICE_PATH="/etc/systemd/system/tv-display-watchdog.service"
BACKUP_ROOT="/var/backups/fleet-tv-kiosk"
ORIG_BACKUP_DIR="\${BACKUP_ROOT}/original-dakboard-state"

echo "=================================================================="
echo " Deploying Fleet TV Kiosk -> Display: \${DISPLAY_ID}"
echo " Target Server : \${SERVER_URL}"
echo " Auth Mode     : $([ -n "$DISPLAY_TOKEN" ] && echo 'Pre-Authenticated Device Token' || echo '6-Digit Screen Pairing')"
echo "=================================================================="

# 1. Auto-detect active desktop user (DAKboard OS uses 'dakboard' or 'pi'; Bookworm uses UID 1000)
detect_kiosk_user() {
  local proc_user=""
  proc_user=$(ps -eo user,comm 2>/dev/null | awk '$2 ~ /^(labwc|wayfire|lxsession|openbox|matchbox-window|chromium|chromium-browse)$/ && $1 != "root" {print $1; exit}')
  if [ -n "$proc_user" ] && id "$proc_user" >/dev/null 2>&1; then
    echo "$proc_user"
    return
  fi
  if [ -d /home/dakboard ] && id dakboard >/dev/null 2>&1; then
    echo "dakboard"
    return
  fi
  if [ -n "\${SUDO_USER:-}" ] && [ "\${SUDO_USER}" != "root" ] && id "\${SUDO_USER}" >/dev/null 2>&1; then
    echo "\${SUDO_USER}"
    return
  fi
  if id pi >/dev/null 2>&1; then
    echo "pi"
    return
  fi
  local uid1000=""
  uid1000=$(awk -F: '$3 == 1000 {print $1; exit}' /etc/passwd)
  if [ -n "$uid1000" ]; then
    echo "$uid1000"
    return
  fi
  echo "root"
}

KIOSK_USER=$(detect_kiosk_user)
KIOSK_GROUP=$(id -gn "$KIOSK_USER" 2>/dev/null || echo "$KIOSK_USER")
KIOSK_UID=$(id -u "$KIOSK_USER" 2>/dev/null || echo "1000")
KIOSK_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
if [ -z "$KIOSK_HOME" ]; then
  KIOSK_HOME="/home/$KIOSK_USER"
fi

echo "[1/6] Detected desktop user: \${KIOSK_USER} (UID \${KIOSK_UID}, Home \${KIOSK_HOME})"

# 2. Install lightweight utilities if missing (non-fatal if apt is locked/offline)
echo "[2/6] Checking helper utilities (v4l-utils/cec-ctl, cec-utils, jq, curl, unclutter)..."
NEED_APT=0
for pkg_bin in cec-ctl cec-client jq curl; do
  if ! command -v "$pkg_bin" >/dev/null 2>&1; then
    NEED_APT=1
  fi
done
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  NEED_APT=1
fi

if [ "$NEED_APT" = "1" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq v4l-utils cec-utils curl jq unclutter psmisc x11-xserver-utils >/dev/null 2>&1 || true
  if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    apt-get install -y -qq chromium >/dev/null 2>&1 || apt-get install -y -qq chromium-browser >/dev/null 2>&1 || true
  fi
fi

# Reduce SD-card swap thrashing on 1GB-2GB Raspberry Pis so sshd never starves
sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true

# 3. Preserve original pre-Fleet DAKboard configuration (once, never overwritten)
mkdir -p "$BACKUP_ROOT"
if [ ! -d "$ORIG_BACKUP_DIR" ]; then
  echo "[3/6] Saving permanent backup of original DAKboard / Pi startup state to \${ORIG_BACKUP_DIR}..."
  mkdir -p "$ORIG_BACKUP_DIR/files"
  ps -eo user,pid,args | grep -E "[c]hromium" > "$ORIG_BACKUP_DIR/original-chromium-cmdline.txt" 2>/dev/null || true

  for target_file in \\
    "$KIOSK_HOME/startup/browser.sh" \\
    "/home/dakboard/startup/browser.sh" \\
    "/home/pi/startup/browser.sh" \\
    "$KIOSK_HOME/startup/chromium.sh" \\
    "/home/dakboard/startup/chromium.sh" \\
    "/home/pi/startup/chromium.sh" \\
    "/etc/xdg/lxsession/LXDE-pi/autostart" \\
    "$KIOSK_HOME/.config/lxsession/LXDE-pi/autostart" \\
    "/etc/xdg/openbox/autostart" \\
    "$KIOSK_HOME/.config/openbox/autostart" \\
    "$KIOSK_HOME/.xinitrc" \\
    "$KIOSK_HOME/.xsession" \\
    "$KIOSK_HOME/.config/wayfire.ini" \\
    "$KIOSK_HOME/.config/labwc/autostart" \\
    "/boot/firmware/fullpageos.txt" \\
    "/boot/fullpageos.txt"; do
    if [ -f "$target_file" ]; then
      dest_path="$ORIG_BACKUP_DIR/files$target_file"
      mkdir -p "$(dirname "$dest_path")"
      cp -a "$target_file" "$dest_path"
    fi
  done
  systemctl list-unit-files --state=enabled --type=service,timer --no-pager > "$ORIG_BACKUP_DIR/enabled-services.txt" 2>/dev/null || true
else
  echo "[3/6] Original DAKboard backup already preserved at \${ORIG_BACKUP_DIR}"
fi

# Create 1-command rollback script so returning to DAKboard is effortless if ever needed
cat << 'EOF_RESTORE' > "$RESTORE_SCRIPT"
#!/usr/bin/env bash
set -e
ORIG_BACKUP_DIR="/var/backups/fleet-tv-kiosk/original-dakboard-state"
if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo /usr/local/bin/fleet-tv-restore-dakboard.sh" >&2
  exit 1
fi
if [ ! -d "$ORIG_BACKUP_DIR/files" ]; then
  echo "No original backup directory found at $ORIG_BACKUP_DIR" >&2
  exit 1
fi
touch /tmp/fleet-tv-stop
systemctl disable --now tv-display-watchdog.service 2>/dev/null || true
rm -f /etc/systemd/system/tv-display-watchdog.service
rm -f /home/*/.config/autostart/fleet-tv-kiosk.desktop /root/.config/autostart/fleet-tv-kiosk.desktop 2>/dev/null || true

# Restore backed-up files to their exact original paths
(
  cd "$ORIG_BACKUP_DIR/files"
  find . -type f | while read -r rel; do
    dest="/\${rel#./}"
    cp -a "$rel" "$dest"
    echo "Restored $dest"
  done
)

if [ -f "$ORIG_BACKUP_DIR/stopped-kiosk-services.txt" ]; then
  while read -r svc; do
    [ -n "$svc" ] && systemctl enable --now "$svc" 2>/dev/null || true
  done < "$ORIG_BACKUP_DIR/stopped-kiosk-services.txt"
fi

systemctl daemon-reload
pkill -f "fleet-tv-launch.sh" 2>/dev/null || true
pkill -f chromium 2>/dev/null || true
echo "Original DAKboard configuration restored. Rebooting Pi in 3 seconds..."
( sleep 3 && reboot ) </dev/null >/dev/null 2>&1 &
EOF_RESTORE
chmod 755 "$RESTORE_SCRIPT"

# 4. Write protected Kiosk Environment + Self-Healing Chromium Kiosk Launcher
echo "[4/6] Writing Kiosk configuration & fullscreen Chromium launcher..."
cat << EOF > "$ENV_FILE"
DISPLAY_ID="$DISPLAY_ID"
DISPLAY_TOKEN="$DISPLAY_TOKEN"
SERVER_URL="$SERVER_URL"
KIOSK_URL="$KIOSK_URL"
KIOSK_USER="$KIOSK_USER"
KIOSK_UID="$KIOSK_UID"
KIOSK_HOME="$KIOSK_HOME"
EOF
chown root:"$KIOSK_GROUP" "$ENV_FILE" 2>/dev/null || true
chmod 640 "$ENV_FILE"

cat << 'EOF_LAUNCH' > "$LAUNCH_SCRIPT"
#!/usr/bin/env bash
# Fleet TV Fullscreen Chromium Launcher (Single-instance guarded via flock)
rm -f /tmp/fleet-tv-stop

if [ -f /etc/fleet-tv-kiosk.env ]; then
  . /etc/fleet-tv-kiosk.env
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/fleet-tv-kiosk.lock
  if ! flock -n 9; then
    exit 0
  fi
fi

# Detect Chromium executable — prefer direct binary /usr/lib/chromium/chromium on Pi OS Bookworm
# so /etc/chromium.d/00-rpi-vars does not inject --force-renderer-accessibility (prevents 2GB RAM leak)
CHROME_BIN=""
for candidate in /usr/lib/chromium/chromium /usr/lib/chromium-browser/chromium-browser /usr/bin/chromium /usr/bin/chromium-browser chromium chromium-browser; do
  if [ -x "$candidate" ]; then
    CHROME_BIN="$candidate"
    break
  elif command -v "$candidate" >/dev/null 2>&1; then
    CHROME_BIN=$(command -v "$candidate")
    break
  fi
done

if [ -z "$CHROME_BIN" ]; then
  echo "ERROR: Chromium browser binary not found!" >&2
  exit 1
fi

UID_NOW=$(id -u)
export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/\${UID_NOW}}"

# Auto-detect Wayland vs X11 session when launched from SSH or autostart
EXTRA_DISPLAY_FLAGS=""
if [ -z "\${WAYLAND_DISPLAY:-}" ]; then
  for sock in "\${XDG_RUNTIME_DIR}"/wayland-*; do
    if [ -S "$sock" ]; then
      export WAYLAND_DISPLAY=$(basename "$sock")
      break
    fi
  done
fi

if [ -n "\${WAYLAND_DISPLAY:-}" ] && (pgrep -x labwc >/dev/null 2>&1 || pgrep -x wayfire >/dev/null 2>&1); then
  EXTRA_DISPLAY_FLAGS="--ozone-platform=wayland"
else
  export DISPLAY="\${DISPLAY:-:0}"
  if [ -z "\${XAUTHORITY:-}" ] && [ -f "$HOME/.Xauthority" ]; then
    export XAUTHORITY="$HOME/.Xauthority"
  fi
  if command -v xset >/dev/null 2>&1; then
    xset s off 2>/dev/null || true
    xset s noblank 2>/dev/null || true
    xset -dpms 2>/dev/null || true
  fi
  if command -v unclutter >/dev/null 2>&1 && ! pgrep -x unclutter >/dev/null 2>&1; then
    unclutter -idle 1 -root </dev/null >/dev/null 2>&1 &
  fi
fi

PROFILE_DIR="$HOME/.config/chromium-fleet-kiosk"
mkdir -p "$PROFILE_DIR/Default"

while [ ! -f /tmp/fleet-tv-stop ]; do
  # Reload /etc/fleet-tv-kiosk.env on every loop so URL/token updates apply without reboot
  if [ -f /etc/fleet-tv-kiosk.env ]; then
    . /etc/fleet-tv-kiosk.env
  fi

  # Cap 4K UHD TVs at 1920x1080@60Hz on X11 so 1GB-2GB Raspberry Pis never exhaust V3D GPU dma_buf planes
  if [ -z "\${EXTRA_DISPLAY_FLAGS:-}" ] && command -v xrandr >/dev/null 2>&1; then
    if xrandr 2>/dev/null | grep -Eq '(3840|4096)x2160.*\*'; then
      HDMI_OUT=$(xrandr 2>/dev/null | awk '/ connected/{print $1; exit}')
      if [ -n "$HDMI_OUT" ]; then
        xrandr --output "$HDMI_OUT" --mode 1920x1080 --rate 60 2>/dev/null || xrandr --output "$HDMI_OUT" --mode 1920x1080 2>/dev/null || true
      fi
    fi
  fi

  # Clear Chromium crash flags so "Restore pages?" popup never blocks the TV
  for pref in "$PROFILE_DIR/Default/Preferences" "$HOME/.config/chromium/Default/Preferences"; do
    if [ -f "$pref" ]; then
      sed -i 's/"exited_cleanly":false/"exited_cleanly":true/g' "$pref" 2>/dev/null || true
      sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$pref" 2>/dev/null || true
    fi
  done
  rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonCookie" "$PROFILE_DIR/SingletonSocket" 2>/dev/null || true

  "$CHROME_BIN" \\
    --kiosk \\
    --user-data-dir="$PROFILE_DIR" \\
    --noerrdialogs \\
    --disable-infobars \\
    --disable-session-crashed-bubble \\
    --disable-restore-session-state \\
    --no-first-run \\
    --check-for-update-interval=31536000 \\
    --overscroll-history-navigation=0 \\
    --autoplay-policy=no-user-gesture-required \\
    --disable-features=TranslateUI \\
    --disable-extensions \\
    --disable-component-extensions-with-background-pages \\
    --disable-background-networking \\
    --disable-pings \\
    --media-router=0 \\
    --disk-cache-size=50331648 \\
    --media-cache-size=25165824 \\
    --renderer-process-limit=2 \\
    --js-flags="--max-old-space-size=384" \\
    --enable-gpu-rasterization \\
    --enable-zero-copy \\
    --ignore-gpu-blocklist \\
    --enable-accelerated-2d-canvas \\
    --num-raster-threads=2 \\
    --password-store=basic \\
    $EXTRA_DISPLAY_FLAGS \\
    "\${KIOSK_URL}" </dev/null >/dev/null 2>&1 || true

  if [ -f /tmp/fleet-tv-stop ]; then
    break
  fi
  sleep 3
done
EOF_LAUNCH
chmod 755 "$LAUNCH_SCRIPT"

# 5. Neutralize old DAKboard browser autostarts & wire Fleet TV autostart cleanly
echo "[5/6] Wiring desktop autostart (DAKboard OS / Wayland / X11 / Openbox / FullPageOS)..."

# 5A. Any custom systemd service that directly launches chromium, PLUS DAKboard OS sleep/HDMI schedule timers
for unit_file in /etc/systemd/system/*.service; do
  [ -f "$unit_file" ] || continue
  unit_name=$(basename "$unit_file")
  [ "$unit_name" = "tv-display-watchdog.service" ] && continue
  if grep -Eqi "ExecStart=.*(chromium|dakboard.*kiosk)" "$unit_file" 2>/dev/null; then
    if systemctl is-enabled --quiet "$unit_name" 2>/dev/null || systemctl is-active --quiet "$unit_name" 2>/dev/null; then
      echo "$unit_name" >> "$ORIG_BACKUP_DIR/stopped-kiosk-services.txt"
      systemctl disable --now "$unit_name" 2>/dev/null || true
      echo "  -> Disabled conflicting browser systemd unit: $unit_name"
    fi
  fi
done

# Stop DAKboard OS's 60-second HDMI sleep/wake timer (dakos-sleep.timer / dakos-sleep.service -> rpi-hdmi.sh)
for dak_unit in dakos-sleep.timer dakos-sleep.service; do
  if systemctl list-unit-files "$dak_unit" >/dev/null 2>&1; then
    if systemctl is-enabled --quiet "$dak_unit" 2>/dev/null; then
      echo "$dak_unit" >> "$ORIG_BACKUP_DIR/stopped-kiosk-services.txt"
      systemctl disable --now "$dak_unit" 2>/dev/null || true
      echo "  -> Disabled conflicting DAKboard HDMI sleep timer: $dak_unit"
    elif systemctl is-active --quiet "$dak_unit" 2>/dev/null; then
      systemctl stop "$dak_unit" 2>/dev/null || true
    fi
  fi
done

# 5B. Official DAKboard OS (/home/dakboard/startup/browser.sh on Bookworm 4.x, or legacy startup/chromium.sh)
for dak_script in \\
  "/home/dakboard/startup/browser.sh" \\
  "/home/pi/startup/browser.sh" \\
  "$KIOSK_HOME/startup/browser.sh" \\
  "/home/dakboard/startup/chromium.sh" \\
  "/home/pi/startup/chromium.sh" \\
  "$KIOSK_HOME/startup/chromium.sh"; do
  if [ -f "$dak_script" ]; then
    cat << 'EOF_DAK' > "$dak_script"
#!/usr/bin/env bash
exec /usr/local/bin/fleet-tv-launch.sh
EOF_DAK
    chmod 755 "$dak_script"
    chown "$KIOSK_USER":"$KIOSK_GROUP" "$dak_script" 2>/dev/null || true
    echo "  -> Hooked DAKboard OS startup script: $dak_script"
  fi
done

# 5C. FullPageOS (/boot/firmware/fullpageos.txt or /boot/fullpageos.txt)
for fpos in /boot/firmware/fullpageos.txt /boot/fullpageos.txt; do
  if [ -f "$fpos" ]; then
    echo "$KIOSK_URL" > "$fpos"
    echo "  -> Updated FullPageOS boot URL: $fpos"
  fi
done

# 5D. Comment out legacy @chromium / dakboard lines in LXDE & Openbox X11 autostart files
for lx_auto in \\
  "/etc/xdg/lxsession/LXDE-pi/autostart" \\
  "$KIOSK_HOME/.config/lxsession/LXDE-pi/autostart" \\
  "/etc/xdg/openbox/autostart" \\
  "$KIOSK_HOME/.config/openbox/autostart" \\
  "$KIOSK_HOME/.xinitrc" \\
  "$KIOSK_HOME/.xsession"; do
  if [ -f "$lx_auto" ]; then
    sed -i -E 's|^([[:space:]]*@?[^#]*chromium.*)|# [disabled-by-fleet-tv] \\1|g' "$lx_auto"
  fi
done

# If standalone Openbox is active, also hook Openbox autostart directly (since Openbox ignores XDG .desktop by default)
if [ -d "$KIOSK_HOME/.config/openbox" ] || [ -f "/etc/xdg/openbox/autostart" ] || pgrep -x openbox >/dev/null 2>&1; then
  mkdir -p "$KIOSK_HOME/.config/openbox"
  OB_AUTO="$KIOSK_HOME/.config/openbox/autostart"
  if [ ! -f "$OB_AUTO" ] && [ -f "/etc/xdg/openbox/autostart" ]; then
    cp -a "/etc/xdg/openbox/autostart" "$OB_AUTO"
    sed -i -E 's|^([[:space:]]*@?[^#]*chromium.*)|# [disabled-by-fleet-tv] \\1|g' "$OB_AUTO"
  else
    touch "$OB_AUTO"
  fi
  if ! grep -Fq "/usr/local/bin/fleet-tv-launch.sh" "$OB_AUTO"; then
    printf "\\n/usr/local/bin/fleet-tv-launch.sh &\\n" >> "$OB_AUTO"
  fi
  chown -R "$KIOSK_USER":"$KIOSK_GROUP" "$KIOSK_HOME/.config/openbox" 2>/dev/null || true
  chmod +x "$OB_AUTO" 2>/dev/null || true
  echo "  -> Configured X11 Openbox autostart"
fi

# 5E. Wayland labwc (~/.config/labwc/autostart)
if [ -d "$KIOSK_HOME/.config/labwc" ] || pgrep -x labwc >/dev/null 2>&1; then
  mkdir -p "$KIOSK_HOME/.config/labwc"
  LABWC_AUTO="$KIOSK_HOME/.config/labwc/autostart"
  touch "$LABWC_AUTO"
  sed -i -E 's|^([[:space:]]*[^#]*chromium.*)|# [disabled-by-fleet-tv] \\1|g' "$LABWC_AUTO"
  if ! grep -Fq "/usr/local/bin/fleet-tv-launch.sh" "$LABWC_AUTO"; then
    printf "\\n/usr/local/bin/fleet-tv-launch.sh &\\n" >> "$LABWC_AUTO"
  fi
  chown -R "$KIOSK_USER":"$KIOSK_GROUP" "$KIOSK_HOME/.config/labwc" 2>/dev/null || true
  chmod +x "$LABWC_AUTO" 2>/dev/null || true
  echo "  -> Configured Wayland labwc autostart"
fi

# 5F. Wayland wayfire (~/.config/wayfire.ini)
if [ -f "$KIOSK_HOME/.config/wayfire.ini" ]; then
  WF_INI="$KIOSK_HOME/.config/wayfire.ini"
  sed -i -E 's|^([[:space:]]*[^#]+=.*chromium.*)|# [disabled-by-fleet-tv] \\1|g' "$WF_INI"
  if ! grep -Fq "/usr/local/bin/fleet-tv-launch.sh" "$WF_INI"; then
    if grep -Fq "[autostart]" "$WF_INI"; then
      sed -i '/^\\[autostart\\]/a fleet_tv_kiosk = /usr/local/bin/fleet-tv-launch.sh' "$WF_INI"
    else
      printf "\\n[autostart]\\nfleet_tv_kiosk = /usr/local/bin/fleet-tv-launch.sh\\n" >> "$WF_INI"
    fi
  fi
  chown "$KIOSK_USER":"$KIOSK_GROUP" "$WF_INI" 2>/dev/null || true
  echo "  -> Configured Wayland wayfire.ini autostart"
fi

# 5G. Universal XDG Desktop Autostart (~/.config/autostart/fleet-tv-kiosk.desktop)
# Works across X11 LXDE, Wayfire, and labwc; flock in fleet-tv-launch.sh prevents duplicate launches.
mkdir -p "$KIOSK_HOME/.config/autostart"
cat << EOF_DESK > "$KIOSK_HOME/.config/autostart/fleet-tv-kiosk.desktop"
[Desktop Entry]
Type=Application
Name=Fleet TV Display Kiosk
Comment=Launches Fleet & TV Display in fullscreen Chromium kiosk mode
Exec=/usr/local/bin/fleet-tv-launch.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF_DESK
chown -R "$KIOSK_USER":"$KIOSK_GROUP" "$KIOSK_HOME/.config" 2>/dev/null || true

# 6. Install HDMI-CEC & System Health Telemetry Watchdog Service
echo "[6/6] Installing HDMI-CEC & Health Watchdog systemd service..."
cat << 'EOF_WATCHDOG' > "$AGENT_PATH"
#!/usr/bin/env bash

launch_kiosk_detached() {
  if [ -z "\${KIOSK_USER:-}" ] || [ "$KIOSK_USER" = "root" ]; then
    setsid /usr/local/bin/fleet-tv-launch.sh </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u "$KIOSK_USER" -- setsid /usr/local/bin/fleet-tv-launch.sh </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &
  else
    su - "$KIOSK_USER" -c "nohup /usr/local/bin/fleet-tv-launch.sh </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &"
  fi
}

run_as_kiosk_user() {
  if [ -z "\${KIOSK_USER:-}" ] || [ "$KIOSK_USER" = "root" ]; then
    "$@"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u "$KIOSK_USER" -- "$@"
  else
    su - "$KIOSK_USER" -c "$*"
  fi
}

set_display_power() {
  TARGET_MODE="$1" # "on" or "standby"
  RuntimeDir="/run/user/\${KIOSK_UID:-1000}"

  if [ "$TARGET_MODE" = "on" ]; then
    rm -f /tmp/fleet-tv-standby
    if command -v cec-ctl >/dev/null 2>&1; then
      for cec_dev in /dev/cec0 /dev/cec1; do
        [ -e "$cec_dev" ] || continue
        cec-ctl -d "$cec_dev" --playback >/dev/null 2>&1 || true
        cec-ctl -d "$cec_dev" --to 0 --image-view-on >/dev/null 2>&1 || true
        PHYS_ADDR=$(cec-ctl -d "$cec_dev" -S 2>/dev/null | awk '/Physical Address[[:space:]]*:/ {print $NF; exit}')
        if [ -n "$PHYS_ADDR" ] && [ "$PHYS_ADDR" != "f.f.f.f" ]; then
          cec-ctl -d "$cec_dev" --to 0 --active-source phys-addr="$PHYS_ADDR" >/dev/null 2>&1 || true
        fi
      done
    fi
    if command -v cec-client >/dev/null 2>&1; then
      printf "on 0\nas\n" | timeout 5 cec-client -s -d 1 >/dev/null 2>&1 || true
    fi
    if command -v wlr-randr >/dev/null 2>&1 && [ -d "$RuntimeDir" ]; then
      for sock in "$RuntimeDir"/wayland-*; do
        [ -S "$sock" ] || continue
        W_DISP=$(basename "$sock")
        OUTS=$(run_as_kiosk_user env XDG_RUNTIME_DIR="$RuntimeDir" WAYLAND_DISPLAY="$W_DISP" wlr-randr 2>/dev/null | awk '/^[A-Za-z0-9-]+/{print $1}' || true)
        for out in $OUTS; do
          run_as_kiosk_user env XDG_RUNTIME_DIR="$RuntimeDir" WAYLAND_DISPLAY="$W_DISP" wlr-randr --output "$out" --on >/dev/null 2>&1 || true
        done
      done
    fi
    if command -v xset >/dev/null 2>&1 && [ -S /tmp/.X11-unix/X0 ]; then
      run_as_kiosk_user env DISPLAY=:0 XAUTHORITY="\${KIOSK_HOME:-/home/pi}/.Xauthority" xset dpms force on >/dev/null 2>&1 || true
      run_as_kiosk_user env DISPLAY=:0 XAUTHORITY="\${KIOSK_HOME:-/home/pi}/.Xauthority" xset s reset >/dev/null 2>&1 || true
    fi
    if command -v vcgencmd >/dev/null 2>&1; then
      vcgencmd display_power 1 >/dev/null 2>&1 || true
    fi
  else
    touch /tmp/fleet-tv-standby
    if command -v cec-ctl >/dev/null 2>&1; then
      for cec_dev in /dev/cec0 /dev/cec1; do
        [ -e "$cec_dev" ] || continue
        cec-ctl -d "$cec_dev" --playback >/dev/null 2>&1 || true
        cec-ctl -d "$cec_dev" --to 0 --standby >/dev/null 2>&1 || true
      done
    fi
    if command -v cec-client >/dev/null 2>&1; then
      echo "standby 0" | timeout 4 cec-client -s -d 1 >/dev/null 2>&1 || true
    fi
    if command -v wlr-randr >/dev/null 2>&1 && [ -d "$RuntimeDir" ]; then
      for sock in "$RuntimeDir"/wayland-*; do
        [ -S "$sock" ] || continue
        W_DISP=$(basename "$sock")
        OUTS=$(run_as_kiosk_user env XDG_RUNTIME_DIR="$RuntimeDir" WAYLAND_DISPLAY="$W_DISP" wlr-randr 2>/dev/null | awk '/^[A-Za-z0-9-]+/{print $1}' || true)
        for out in $OUTS; do
          run_as_kiosk_user env XDG_RUNTIME_DIR="$RuntimeDir" WAYLAND_DISPLAY="$W_DISP" wlr-randr --output "$out" --off >/dev/null 2>&1 || true
        done
      done
    fi
    if command -v xset >/dev/null 2>&1 && [ -S /tmp/.X11-unix/X0 ]; then
      run_as_kiosk_user env DISPLAY=:0 XAUTHORITY="\${KIOSK_HOME:-/home/pi}/.Xauthority" xset dpms force off >/dev/null 2>&1 || true
    fi
    if command -v vcgencmd >/dev/null 2>&1; then
      vcgencmd display_power 0 >/dev/null 2>&1 || true
    fi
  fi
}

while true; do
  if [ -f /etc/fleet-tv-kiosk.env ]; then
    . /etc/fleet-tv-kiosk.env
  fi

  # 1. Detect TV Power State via HDMI-CEC (Bookworm cec-ctl first, then cec-client, then DPMS/DRM fallback)
  TV_STATE="unknown"
  if command -v cec-ctl >/dev/null 2>&1; then
    for cec_dev in /dev/cec0 /dev/cec1; do
      [ -e "$cec_dev" ] || continue
      cec-ctl -d "$cec_dev" --playback >/dev/null 2>&1 || true
      CEC_CTL_OUT=$(timeout 3 cec-ctl -d "$cec_dev" --to 0 --give-device-power-status 2>/dev/null || true)
      if echo "$CEC_CTL_OUT" | grep -Eqi "pwr-state:[[:space:]]*on"; then
        TV_STATE="on"
        break
      elif echo "$CEC_CTL_OUT" | grep -Eqi "pwr-state:[[:space:]]*standby"; then
        TV_STATE="standby"
        break
      fi
    done
  fi
  if [ "$TV_STATE" = "unknown" ] && command -v cec-client >/dev/null 2>&1; then
    CEC_OUT=$(echo "pow 0" | timeout 3 cec-client -s -d 1 2>/dev/null || true)
    if echo "$CEC_OUT" | grep -qi "power status: on"; then
      TV_STATE="on"
    elif echo "$CEC_OUT" | grep -qi "standby"; then
      TV_STATE="standby"
    fi
  fi

  if [ "$TV_STATE" = "unknown" ] && [ -f /tmp/fleet-tv-standby ]; then
    TV_STATE="standby"
  fi

  if [ "$TV_STATE" = "unknown" ]; then
    for status_file in /sys/class/drm/card*-HDMI-A-*/status; do
      if [ -f "$status_file" ]; then
        DRM_STAT=$(cat "$status_file" 2>/dev/null || true)
        if [ "$DRM_STAT" = "disconnected" ]; then
          TV_STATE="disconnected"
        elif [ "$DRM_STAT" = "connected" ]; then
          TV_STATE="on"
        fi
        break
      fi
    done
  fi

  # 2. Collect Pi CPU Temp, Load, RAM, Uptime, IP & Chromium status
  CPU_TEMP="null"
  if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
    RAW_T=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)
    CPU_TEMP=$(awk "BEGIN {printf \\"%.1f\\", $RAW_T/1000}")
  fi

  LOAD_AVG=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo "0")
  MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", ($3/$2)*100}' 2>/dev/null || echo "0")
  UPTIME_SEC=$(awk '{printf "%.0f", $1}' /proc/uptime 2>/dev/null || echo "0")
  IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')

  # Keep 4K UHD TVs locked to 1920x1080@60Hz across HDMI hotplugs / TV power cycles
  if [ "$TV_STATE" != "standby" ] && [ ! -f /tmp/fleet-tv-standby ] && command -v xrandr >/dev/null 2>&1 && [ -S /tmp/.X11-unix/X0 ]; then
    XR_OUT=$(run_as_kiosk_user env DISPLAY=:0 XAUTHORITY="\${KIOSK_HOME:-/home/pi}/.Xauthority" xrandr 2>/dev/null || true)
    if echo "$XR_OUT" | grep -Eq '(3840|4096)x2160.*\*'; then
      HDMI_OUT=$(echo "$XR_OUT" | awk '/ connected/{print $1; exit}')
      if [ -n "$HDMI_OUT" ]; then
        run_as_kiosk_user env DISPLAY=:0 XAUTHORITY="\${KIOSK_HOME:-/home/pi}/.Xauthority" xrandr --output "$HDMI_OUT" --mode 1920x1080 --rate 60 >/dev/null 2>&1 || \\
        run_as_kiosk_user env DISPLAY=:0 XAUTHORITY="\${KIOSK_HOME:-/home/pi}/.Xauthority" xrandr --output "$HDMI_OUT" --mode 1920x1080 >/dev/null 2>&1 || true
      fi
    fi
  fi

  # If an unhooked DAKboard script opened dakboard/browser-init while Fleet TV is active, reclaim the screen
  if [ ! -f /tmp/fleet-tv-stop ] && ps -eo args 2>/dev/null | grep -E "[c]hromium.*(dakboard|browser-init)" >/dev/null 2>&1; then
    pkill -f "startup/browser.sh" 2>/dev/null || true
    pkill -f "startup/chromium.sh" 2>/dev/null || true
    pkill -f chromium 2>/dev/null || true
    sleep 1
  fi

  if pgrep -f "chromium" >/dev/null 2>&1; then
    CHROMIUM_RUN="true"
  else
    CHROMIUM_RUN="false"
    # Self-heal: if GUI session is running and /tmp/fleet-tv-stop is absent, relaunch kiosk
    if [ ! -f /tmp/fleet-tv-stop ]; then
      launch_kiosk_detached
    fi
  fi

  if [ -n "\${DISPLAY_TOKEN:-}" ]; then
    PAYLOAD=$(printf '{"displayId":"%s","tvPowerState":"%s","cpuTempC":%s,"loadAvg":%s,"memUsedPct":%s,"piUptimeSec":%s,"ipAddress":"%s","chromiumRunning":%s}' \\
      "$DISPLAY_ID" "$TV_STATE" "$CPU_TEMP" "$LOAD_AVG" "$MEM_PCT" "$UPTIME_SEC" "$IP_ADDR" "$CHROMIUM_RUN")

    RESP=$(curl -fsS -m 6 -X POST "$SERVER_URL/api/display/pi-telemetry" \\
      -H "Content-Type: application/json" \\
      -H "X-Display-Token: $DISPLAY_TOKEN" \\
      -d "$PAYLOAD" 2>/dev/null || echo "{}")

    CMD=$(echo "$RESP" | jq -r '.command // empty' 2>/dev/null || true)
    if [ "$CMD" = "tv_on" ]; then
      set_display_power "on"
    elif [ "$CMD" = "tv_standby" ]; then
      set_display_power "standby"
    elif [ "$CMD" = "restart_browser" ]; then
      pkill -f chromium || true
    elif [ "$CMD" = "reboot_pi" ]; then
      reboot
    fi
  fi

  sleep 12
done
EOF_WATCHDOG
chmod 700 "$AGENT_PATH"

cat << EOF_SVC > "$SERVICE_PATH"
[Unit]
Description=Fleet TV Display Watchdog & HDMI-CEC Pingback ($DISPLAY_ID)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$AGENT_PATH
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF_SVC

touch /var/log/fleet-tv-kiosk.log
chown "$KIOSK_USER":"$KIOSK_GROUP" /var/log/fleet-tv-kiosk.log 2>/dev/null || true

systemctl daemon-reload
systemctl enable --now tv-display-watchdog.service

# Immediately switch the live TV screen from DAKboard/old browser to Fleet TV without needing a reboot!
echo "Switching live TV screen to Fleet Display now..."
touch /tmp/fleet-tv-stop
pkill -f "fleet-tv-launch.sh" 2>/dev/null || true
pkill -f "startup/browser.sh" 2>/dev/null || true
pkill -f "startup/chromium.sh" 2>/dev/null || true
pkill -9 -f chromium 2>/dev/null || true
sleep 1
rm -f /tmp/fleet-tv-stop /tmp/fleet-tv-kiosk.lock

if [ "$KIOSK_USER" = "root" ]; then
  setsid "$LAUNCH_SCRIPT" </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &
elif command -v runuser >/dev/null 2>&1; then
  runuser -u "$KIOSK_USER" -- setsid "$LAUNCH_SCRIPT" </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &
else
  su - "$KIOSK_USER" -c "nohup /usr/local/bin/fleet-tv-launch.sh </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &"
fi

sleep 3
echo "=================================================================="
if pgrep -f chromium >/dev/null 2>&1; then
  echo " SUCCESS: Chromium Kiosk is LIVE on TV (\${DISPLAY_ID})"
else
  echo " NOTE: Kiosk installed; Chromium will start automatically with GUI session (try --reboot if TV was asleep)."
fi
echo " Rollback anytime : sudo /usr/local/bin/fleet-tv-restore-dakboard.sh"
echo "=================================================================="
`;

  return normalizeLf(raw);
}

/**
 * Generates a quick live health & kiosk status script (`pi:status`) for a provisioned Pi.
 */
export function generateRaspberryPiStatusScript(): string {
  const raw = `#!/usr/bin/env bash
set -u
echo "=================================================================="
echo " FLEET TV — LIVE PI KIOSK & WATCHDOG STATUS"
echo "=================================================================="
echo "Hostname / IP  : $(hostname) ($(hostname -I 2>/dev/null || echo 'unknown'))"
echo "Uptime / Load  : $(uptime)"
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
  RAW_T=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)
  awk "BEGIN {printf \\"CPU Temp       : %.1f C\\\\n\\", $RAW_T/1000}"
fi
if [ -f /etc/fleet-tv-kiosk.env ]; then
  echo "Configured ID  : $(grep -E '^DISPLAY_ID=' /etc/fleet-tv-kiosk.env | cut -d= -f2- | tr -d '\"')"
  echo "Configured Srv : $(grep -E '^SERVER_URL=' /etc/fleet-tv-kiosk.env | cut -d= -f2- | tr -d '\"')"
else
  echo "Configured Env : (Not provisioned yet — /etc/fleet-tv-kiosk.env not found)"
fi
echo "Watchdog Svc   : $(systemctl is-active tv-display-watchdog.service 2>/dev/null || echo 'not-installed')"
if command -v cec-client >/dev/null 2>&1; then
  CEC_S=$(echo "pow 0" | timeout 3 cec-client -s -d 1 2>/dev/null | grep -i "power status" | head -n 1 || true)
  echo "HDMI-CEC Power : \${CEC_S:-unavailable}"
fi
echo ""
echo "--- Running Chromium Process ---"
ps -eo user,pid,etime,args | grep -E "[c]hromium" | grep -v "type=renderer" | grep -v "type=gpu" | grep -v "type=utility" | head -n 5 || echo "  (Chromium is NOT running)"
echo "=================================================================="
`;
  return normalizeLf(raw);
}

