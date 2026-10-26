#!/usr/bin/env bash
# Like install.sh, for a rooted TV (Homebrew Channel): installs over root SSH, no Developer Mode.
#   TV_HOST=192.168.1.50 TV_SSH_KEY=~/.ssh/tvkey ./install-root.sh
# TV_SSH_KEY also lets sync-apps.py fetch the TV's 192px icons.
set -euo pipefail
cd "$(dirname "$0")"
: "${TV_HOST:?set TV_HOST to the TV IP address, e.g. TV_HOST=192.168.1.50 $0}"
: "${TV_SSH_KEY:?set TV_SSH_KEY to an SSH key for root on the TV}"
export TV_SSH_KEY
APP_ID=com.gathin.tvhome
SSH=(ssh -i "$TV_SSH_KEY" -o BatchMode=yes "root@$TV_HOST")

PY="${PY:-python3}"
[ -x venv/bin/python ] && PY=venv/bin/python
[ -x venv/Scripts/python ] && PY=venv/Scripts/python
"$PY" sync-apps.py "$TV_HOST"

if [ ! -f app/icon.png ]; then
  # The webOS app list wants PNG icons: 80px and 130px.
  "$PY" -c "
from PIL import Image
im = Image.open('assets/icon.jpg').convert('RGB')
im.resize((80, 80), Image.LANCZOS).save('app/icon.png')
im.resize((130, 130), Image.LANCZOS).save('app/largeIcon.png')"
fi

rm -rf build && mkdir build
npx -y -p @webos-tools/cli ares-package app service -o build
scp -q -i "$TV_SSH_KEY" -o BatchMode=yes build/${APP_ID}_*.ipk "root@$TV_HOST:/tmp/$APP_ID.ipk"

# appInstallService reports progress on a subscription: wait for it to finish.
"${SSH[@]}" "
  luna-send -i luna://com.webos.appInstallService/dev/install \
    '{\"id\":\"$APP_ID\",\"ipkUrl\":\"/tmp/$APP_ID.ipk\",\"subscribe\":true}' > /tmp/$APP_ID.log 2>&1 &
  for i in \$(seq 1 60); do grep -qE '\"state\":\"(installed|install failed)\"|errorText' /tmp/$APP_ID.log && break; sleep 2; done
  kill %1 2>/dev/null
  grep -q '\"state\":\"installed\"' /tmp/$APP_ID.log; ok=\$?
  [ \$ok = 0 ] || cat /tmp/$APP_ID.log
  rm -f /tmp/$APP_ID.ipk /tmp/$APP_ID.log
  exit \$ok"
# The service needs root (uninstalling, the TV's app list, the advanced features): Homebrew
# Channel's elevate-service grants it, again after every install, which resets it. The launcher
# does the same by itself when it finds the service without root.
"${SSH[@]}" "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service $APP_ID.service" >/dev/null
"${SSH[@]}" 'pkill -f "com.gathin.tvhome[.]service"' || true   # restart it as root

# luna-send does nothing without a terminal on this firmware: ssh -tt gives it one.
luna() { ssh -tt -i "$TV_SSH_KEY" -o BatchMode=yes "root@$TV_HOST" "luna-send -n 1 $1 '$2'" 2>/dev/null | tr -d '\r'; }

# The advanced features, the same switches as in the launcher's Settings menu:
#   HOME_WATCH=1    the Home button always opens the launcher
#   SCREENSAVER=1   LG's screensaver shows Bing's pictures and the ones sent from a phone
#   NO_ASSISTANT=1  Google Assistant is no longer kept in memory (about 40 MB)
feature() { echo "$1: $(luna luna://com.gathin.tvhome.service/setFeature "{\"name\":\"$1\",\"on\":true}")"; }
if [ "${HOME_WATCH:-}" = 1 ]; then feature homeWatch; fi
if [ "${SCREENSAVER:-}" = 1 ]; then feature screensaver; fi
if [ "${NO_ASSISTANT:-}" = 1 ]; then feature noAssistant; fi

luna luna://com.webos.applicationManager/launch "{\"id\":\"$APP_ID\"}" >/dev/null
echo "Installed."
