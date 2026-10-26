#!/bin/sh
# Replaces LG's screensaver with screensaver/main.qml (Bing and phone pictures) on a rooted TV.
# Homebrew Channel runs /var/lib/webosbrew/init.d at boot; install-root.sh with SCREENSAVER=1 puts
# this there and the QML in $QML. A bind mount changes nothing on disk: remove this file and reboot
# (or umount $TARGET) to get LG's screensaver back.
QML=/media/developer/tvhome-screensaver/main.qml
TARGET=/usr/palm/applications/com.webos.app.screensaver/qml/main.qml

[ -f "$QML" ] || exit 0
grep -q " $TARGET " /proc/mounts && exit 0   # already in place
mount --bind "$QML" "$TARGET"
