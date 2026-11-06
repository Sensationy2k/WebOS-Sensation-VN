#!/bin/sh
# home-watch.py for a rooted TV, running on the TV itself: no other device needed.
# The service puts it in /var/lib/webosbrew/init.d (run by Homebrew Channel at boot) as
# tvhome-homewatch when "Home always opens the launcher" is turned on in the launcher, and runs
# "home-watch.sh off" when it is turned off.
#
# Home opens the launcher straight away, in two parts:
# - $HOME_KEY, a surface-manager key filter (tv/home-key.js, copied there by the service), sends the
#   Home key to the launcher instead of LG's home. It goes into com.webos.surfacemanager.keyFilters
#   in memory only: surface-manager reloads its filters when that changes.
# - $MEM_CONF puts the launcher in memchute's home group, in LG's home's place (whose preloading is
#   turned off too, in memory only, so it stops holding memory): launching the launcher then no
#   longer waits for the app in front to be closed for memory (two seconds for YouTube). That app
#   is closed here instead, once the launcher is up (close_soon). memchute reads this file before
#   /etc/palm's.
# LG's home, when something else opens it (turning the TV on, an app), is still switched back to
# the launcher here. For LG's home and its menus, use the launcher's LG home button: it leaves a
# fresh $LG_HOME_FLAG (through the service), and the watcher then lets LG's home stay until another
# app comes up.
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
HOME_KEY=/media/developer/tvhome-homekey.js
MEM_CONF=/home/root/memorymanager-conf.json

# home_key add|remove: our filter in surface-manager's list, right after its screensaver filter
# (any key still wakes the screensaver first). luna-send needs a terminal: script(1).
home_key() {
  node - "$1" "$HOME_KEY" <<'EOF'
var cp = require('child_process'), mode = process.argv[2], file = process.argv[3];
var NAME = 'com.webos.surfacemanager.keyFilters';
function luna(uri, p) {
  var out = cp.execFileSync('script', ['-q', '-c', 'luna-send -n 1 ' + uri + " '" + JSON.stringify(p) + "'", '/dev/null']).toString();
  return JSON.parse(out.slice(out.indexOf('{')));
}
var list = luna('luna://com.webos.service.config/getConfigs', { configNames: [NAME] }).configs[NAME];
var had = list.some(function (f) { return f.file === file; });
if ((mode === 'add') === had) process.exit(0);   // already so: a change would reload every filter
list = list.filter(function (f) { return f.file !== file; });
if (mode === 'add') {
  var at = list.findIndex(function (f) { return f.handler === 'handleScreenSaver'; }) + 1;
  list.splice(at, 0, { handler: 'handleHomeToLauncher', file: file });
}
var c = {}; c[NAME] = list;
luna('luna://com.webos.service.config/setConfigs', { configs: c });
console.log('key filters: home key ' + mode);
EOF
}

# The launcher in memchute's home group; prints "changed" when the file had to be (re)written.
home_group() {
  node - "$MEM_CONF" <<'EOF'
// HomeGroup: launching it does not wait for memory; KeepOnLaunchEx: not closed while an app runs.
var fs = require('fs'), out = process.argv[2], add = ['HomeGroup', 'KeepOnLaunchEx'];
var c = JSON.parse(fs.readFileSync('/etc/palm/memorymanager-conf.json', 'utf8'));
// The launcher takes LG's home's place there: two homes held in memory leave too little for apps.
add.forEach(function (k) {
  c[k] = c[k].filter(function (a) { return a !== 'com.webos.app.home'; });
  c[k].push('com.gathin.tvhome');
});
var text = JSON.stringify(c, null, 4);
try { if (fs.readFileSync(out, 'utf8') === text) process.exit(0); } catch (e) { /* none yet */ }
fs.writeFileSync(out, text);
console.log('changed');
EOF
}

# lg_home_preload off|on: LG's home on preloadmanager's list (configd memory only, back at a reboot).
# Off, with the launcher as the home, so LG's home stops holding memory; it still opens on demand.
lg_home_preload() {
  node - "$1" "$LG_HOME" <<'NODE'
var cp = require('child_process'), on = process.argv[2] === 'on', id = process.argv[3];
var KEY = 'com.webos.service.preloadmanager.supportAppList';
function luna(uri, p) {
  var out = cp.execFileSync('script', ['-q', '-c', 'luna-send -n 1 ' + uri + " '" + JSON.stringify(p) + "'", '/dev/null']).toString();
  return JSON.parse(out.slice(out.indexOf('{')));
}
var list;
for (var i = 0; i < 30 && !list; i++) {   // preloadmanager may not be up yet this early in the boot
  list = (luna('luna://com.webos.service.config/getConfigs', { configNames: [KEY] }).configs || {})[KEY];
  if (!list) cp.execFileSync('sleep', ['2']);
}
var app = (list || []).filter(function (a) { return a.id === id; })[0];
if (!app || app.isEnabled === on) process.exit(0);
app.isEnabled = on;
var c = {}; c[KEY] = list;
luna('luna://com.webos.service.config/setConfigs', { configs: c });
console.log('preload ' + (on ? 'on' : 'off') + ' for ' + id);
if (on) process.exit(0);
// A preloaded app ignores closeByAppId; closing its process works. Not while it is on screen.
var fg = luna('luna://com.webos.applicationManager/getForegroundAppInfo', {}).appId;
var run = (luna('luna://com.webos.applicationManager/running', {}).running || []).filter(function (a) { return a.id === id; })[0];
if (run && fg !== id) {
  luna('luna://com.webos.applicationManager/close', { processId: run.processid || run.webprocessid });
  console.log('closed preloaded ' + id);
}
NODE
}

case "$1" in
  run) ;;
  off)
    pkill -f "tvhome-homewatch[ ]run" 2>/dev/null
    home_key remove
    lg_home_preload on
    if [ -f "$MEM_CONF" ]; then rm -f "$MEM_CONF"; systemctl restart memchute; fi
    exit 0
    ;;
  *)
    # Start (or restart) in the background. luna-send does nothing without a terminal on this
    # firmware, so the watcher runs inside one from script(1).
    pkill -f "tvhome-homewatch[ ]run" 2>/dev/null
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

# webOS closes the launcher behind other apps to free memory, and starting it cold takes about five
# seconds, all spent looking at LG's home after Home. So once another app has settled in front, the
# launcher is loaded again, hidden behind it (as preloadmanager does for Netflix): Home then brings
# it up in about a second.
launcher_running() {
  luna-send -n 1 luna://com.webos.applicationManager/running '{}' | grep -q "\"id\":\"$LAUNCHER\""
}
preload_pid=
preload_soon() {
  [ -n "$preload_pid" ] && kill "$preload_pid" 2>/dev/null
  (
    sleep 8
    [ "$(foreground)" = "$1" ] || exit 0   # gone already
    launcher_running && exit 0
    luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$LAUNCHER\",\"preload\":\"full\"}" >/dev/null
    log "launcher preloaded behind $1"
  ) &
  preload_pid=$!
}

# Back at the launcher from an app: that app is closed once the launcher is up. memchute keeps it in
# the background now (the launcher is in its home group), and the next app would wait over a second
# for memory. Live TV, the inputs and the apps LG preloads (YouTube, Netflix...) stay, as LG keeps
# them: memchute frees those itself when it needs to.
close_pid=
# preloadmanager has $1 on its list (and on): LG keeps such apps in memory on purpose, ready to come
# back quickly, and closing them would lose that.
lg_preloads() {
  luna-send -n 1 luna://com.webos.service.config/getConfigs \
    '{"configNames":["com.webos.service.preloadmanager.supportAppList"]}' | tr '{' '\n' |
    grep "\"id\":\"$1\"" | grep -q '"isEnabled":true'
}
close_soon() {
  [ -n "$1" ] && [ "$1" != "$LG_HOME" ] && [ "$1" != "$LAUNCHER" ] || return 0
  is_input "$1" && return 0
  lg_preloads "$1" && return 0
  [ -n "$close_pid" ] && kill "$close_pid" 2>/dev/null
  (
    sleep 1.5
    [ "$(foreground)" = "$LAUNCHER" ] || exit 0
    luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$1\"}" >/dev/null
    log "closed $1 behind the launcher"
  ) &
  close_pid=$!
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
[ "$(home_group)" = changed ] && systemctl restart memchute && log "launcher in memchute's home group"
[ -f "$HOME_KEY" ] && home_key add
lg_home_preload off
[ "$(uptime_cs)" -lt $BOOTING ] && power_on
watch_power &
while true; do
  # last: when we last switched to the launcher; seen: the launcher has been in front since;
  # stay: LG's home was asked for (the launcher's button) and stays until another app comes up.
  last=0 seen= prev= bounces=0 stay=
  # Life events: LG's home is switched once it is in the foreground. (Switching as soon as it starts
  # to launch is quicker, but with the launcher in memchute's home group the two then take the
  # screen from each other a few times.)
  luna-send -i luna://com.webos.applicationManager/getAppLifeEvents '{"subscribe":true}' |
  while read -r line; do
    ev=$(echo "$line" | sed -n 's/.*"event":"\([^"]*\)".*/\1/p')
    app=$(echo "$line" | app_of)
    [ -n "$app" ] || continue
    case "$ev" in
      foreground)
        if [ "$app" != "$LG_HOME" ]; then
          [ "$app" = "$prev" ] && continue
          before=$prev
          prev=$app
          stay=   # left LG's home: the next time it comes up is a Home press again
          if [ "$app" = "$LAUNCHER" ]; then seen=1; close_soon "$before"; else preload_soon "$app"; fi
          continue
        fi
        prev=$app
        # LG's home in front right after a switch we made for this press: nothing new...
        now=$(uptime_cs)
        if [ $((now - last)) -lt $BOUNCE ] && [ -z "$seen" ]; then continue; fi
        ;;
      *) continue ;;
    esac

    # LG's home is coming up (a Home press) or came back.
    [ -n "$stay" ] && continue
    if lg_home_asked; then
      rm -f "$LG_HOME_FLAG"
      stay=1
      log "LG home from the launcher's button: staying"
      continue
    fi
    now=$(uptime_cs)
    if [ $((now - last)) -lt $BOUNCE ]; then
      [ -z "$seen" ] && continue   # the same press, already switched
      # ...but after the launcher had come up, LG's home took the screen back by itself: again,
      # a few times at most.
      bounces=$((bounces + 1))
      if [ $bounces -gt 5 ]; then
        log "LG home keeps coming back: leaving it"
        continue
      fi
      last=$now seen=
      launch
      log "LG home came back -> launcher"
      continue
    fi
    last=$now seen= bounces=0
    launch
    log "LG home ($ev) -> launcher"
  done
  log "subscription ended, restarting"
  sleep 3
done
