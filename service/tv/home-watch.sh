#!/bin/sh
# home-watch.py for a rooted TV, running on the TV itself: no other device needed.
# The service puts it in /var/lib/webosbrew/init.d (run by Homebrew Channel at boot) as
# tvhome-homewatch when "Home always opens the launcher" is turned on in the launcher, and removes
# it (pkill -f tvhome-homewatch) when it is turned off.
#
# Home always comes back to the launcher. For LG's home and its menus, use the launcher's LG home
# button: it leaves a fresh $LG_HOME_FLAG (through the service), and the watcher then lets LG's
# home stay until another app comes up.
# Turning the TV on (boot, or out of standby) also opens the launcher when the TV would come up on
# Live TV or an HDMI input: with no signal those show LG's own "no signal" slideshow.
# Log: /tmp/tvhome-homewatch.log
LAUNCHER=com.gathin.tvhome
LG_HOME=com.webos.app.home
LG_HOME_FLAG=/media/internal/.tvhome-lghome   # written by service/service.js (allowLgHome)
# After the switch LG's home can take the screen back by itself, up to a second or two later: any
# LG home within this many centiseconds of a switch gets switched again.
BOUNCE=400
BOOTING=30000   # centiseconds of uptime: early launches can be dropped while the TV starts

case "$1" in
  run) ;;
  *)
    # Start (or restart) in the background. luna-send does nothing without a terminal on this
    # firmware, so the watcher runs inside one from script(1).
    pkill -f "$0 run" 2>/dev/null
    nohup script -q -c "$0 run" /dev/null >/dev/null 2>&1 &
    exit 0
    ;;
esac

exec >>/tmp/tvhome-homewatch.log 2>&1
log() { echo "$(date '+%F %T') $*"; }
uptime_cs() { cut -d' ' -f1 /proc/uptime | tr -d .; }
app_of() { sed -n 's/.*"appId":"\([^"]*\)".*/\1/p'; }
foreground() { luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' | app_of; }
launch() {
  res=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$LAUNCHER\"}")
  case "$res" in *'"returnValue":true'*) ;; *) log "launch failed: $res" ;; esac
}

# The launcher's LG home button was pressed in the last 15 seconds.
lg_home_asked() {
  [ -f "$LG_HOME_FLAG" ] || return 1
  [ $(($(date +%s) - $(stat -c %Y "$LG_HOME_FLAG"))) -lt 15 ]
}

is_input() {
  case "$1" in com.webos.app.livetv|com.webos.app.hdmi*|com.webos.app.inputcommon|com.webos.app.externalinput*) return 0 ;; esac
  return 1
}

# Just turned on: from LG's home or an input to the launcher, retrying while the TV settles. Any
# other app (one opened on purpose) is left alone.
power_on() {
  for i in 1 2 3 4 5 6 7 8 9 10; do
    fg=$(foreground)
    [ "$fg" = "$LAUNCHER" ] && return
    if [ -z "$fg" ] || [ "$fg" = "$LG_HOME" ] || is_input "$fg"; then
      log "turned on to ${fg:-nothing} -> launcher"
      launch
    else
      return
    fi
    sleep 3
  done
}

# Out of standby: the power state goes back to Active. ("Screen Off" is the picture-off mode
# while something plays: coming back from it is not turning on.)
watch_power() {
  while true; do
    state=
    luna-send -i luna://com.webos.service.tvpower/power/getPowerState '{"subscribe":true}' |
    while read -r line; do
      s=$(echo "$line" | sed -n 's/.*"state" *: *"\([^"]*\)".*/\1/p')
      [ -n "$s" ] || continue
      if [ "$s" = Active ] && [ -n "$state" ] && [ "$state" != Active ] && [ "$state" != "Screen Off" ]; then
        log "power: $state -> Active"
        sleep 2
        power_on
      fi
      state=$s
    done
    sleep 3
  done
}

log "started"
[ "$(uptime_cs)" -lt $BOOTING ] && power_on
watch_power &
while true; do
  last=0 prev= bounces=0 stay=   # last: when we last switched; stay: LG home asked for
  luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true}' |
  while read -r line; do
    app=$(echo "$line" | app_of)
    [ -n "$app" ] || continue
    # LG's home reports itself more than once per press: act only on arriving there.
    [ "$app" = "$prev" ] && continue
    prev=$app
    if [ "$app" != "$LG_HOME" ]; then
      stay=   # left LG's home: the next time it comes up is a Home press again
      continue
    fi
    [ -n "$stay" ] && continue
    if lg_home_asked; then
      rm -f "$LG_HOME_FLAG"
      stay=1
      log "LG home from the launcher's button: staying"
      continue
    fi
    now=$(uptime_cs)
    if [ $((now - last)) -lt $BOUNCE ]; then
      # LG's home took the screen back by itself: switch again, a few times at most.
      bounces=$((bounces + 1))
      if [ $bounces -gt 5 ]; then
        log "LG home keeps coming back: leaving it"
        continue
      fi
      last=$now
      launch
      log "LG home came back -> launcher"
      continue
    fi
    last=$now bounces=0
    launch
    log "LG home -> launcher"
  done
  log "subscription ended, restarting"
  sleep 3
done
