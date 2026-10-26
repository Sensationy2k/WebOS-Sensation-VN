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
# The service uninstalls apps for the hold-OK menu, which needs root: Homebrew Channel's
# elevate-service grants it (again after every install, which resets it).
"${SSH[@]}" "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service $APP_ID.service" >/dev/null
"${SSH[@]}" "luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$APP_ID\"}'" >/dev/null

# HOME_WATCH=1: the Home button opens the launcher, by a watcher on the TV that starts at boot.
if [ "${HOME_WATCH:-}" = 1 ]; then
  scp -q -i "$TV_SSH_KEY" -o BatchMode=yes home-watch-tv.sh "root@$TV_HOST:/var/lib/webosbrew/init.d/tvhome-homewatch"
  "${SSH[@]}" "chmod +x /var/lib/webosbrew/init.d/tvhome-homewatch && /var/lib/webosbrew/init.d/tvhome-homewatch"
  echo "Home button watcher installed."
fi

# SCREENSAVER=1: LG's screensaver shows Bing's pictures and the ones sent from a phone instead.
if [ "${SCREENSAVER:-}" = 1 ]; then
  "${SSH[@]}" "mkdir -p /media/developer/tvhome-screensaver"
  # Written in place: a bind mount follows the file, so the new copy is live at once.
  scp -q -i "$TV_SSH_KEY" -o BatchMode=yes screensaver/main.qml "root@$TV_HOST:/media/developer/tvhome-screensaver/main.qml"
  scp -q -i "$TV_SSH_KEY" -o BatchMode=yes screensaver-tv.sh "root@$TV_HOST:/var/lib/webosbrew/init.d/tvhome-screensaver"
  "${SSH[@]}" "chmod +x /var/lib/webosbrew/init.d/tvhome-screensaver && /var/lib/webosbrew/init.d/tvhome-screensaver"
  echo "Screensaver installed."
fi

# NO_ASSISTANT=1: Google Assistant stops being kept in memory (about 40 MB), from every boot.
if [ "${NO_ASSISTANT:-}" = 1 ]; then
  scp -q -i "$TV_SSH_KEY" -o BatchMode=yes no-assistant-tv.sh "root@$TV_HOST:/var/lib/webosbrew/init.d/tvhome-noassistant"
  "${SSH[@]}" "chmod +x /var/lib/webosbrew/init.d/tvhome-noassistant && /var/lib/webosbrew/init.d/tvhome-noassistant"
  echo "Google Assistant preload off."
fi
echo "Installed."
