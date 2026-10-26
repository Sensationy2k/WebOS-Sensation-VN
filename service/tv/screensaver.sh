#!/bin/sh
# Replaces LG's screensaver with screensaver.qml (Bing and phone pictures) on a rooted TV.
# Homebrew Channel runs /var/lib/webosbrew/init.d at boot; the service puts this there and the QML
# in $QML when the screensaver is turned on in the launcher. A bind mount changes nothing on disk:
# turning it off unmounts $TARGET and removes this file.
QML=/media/developer/tvhome-screensaver/main.qml
TARGET=/usr/palm/applications/com.webos.app.screensaver/qml/main.qml

[ -f "$QML" ] || exit 0
grep -q " $TARGET " /proc/mounts && exit 0   # already in place
mount --bind "$QML" "$TARGET"
