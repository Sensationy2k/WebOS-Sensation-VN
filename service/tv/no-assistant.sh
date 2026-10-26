#!/bin/sh
# Keeps Google Assistant from sitting in memory on a rooted TV: LG's preloadmanager keeps it
# loaded (pinned) for a quick answer. At boot this takes it off the preload list and closes it.
# The change lives in configd's memory only, nothing on disk: remove this file from
# /var/lib/webosbrew/init.d and reboot to undo. The service puts it there (tvhome-noassistant) when
# the option is turned on in the launcher.
APPS="google.assistant"   # app ids to stop preloading
KEY=com.webos.service.preloadmanager.supportAppList

case "$1" in
  run) ;;
  *)
    # luna-send does nothing without a terminal on this firmware: run inside one from script(1).
    nohup script -q -c "$0 run" /dev/null >/dev/null 2>&1 &
    exit 0
    ;;
esac

exec >>/tmp/tvhome-noassistant.log 2>&1
log() { echo "$(date '+%F %T') $*"; }

# preloadmanager may not be up yet this early in the boot: wait for its list.
for i in $(seq 1 30); do
  cur=$(luna-send -n 1 luna://com.webos.service.config/getConfigs "{\"configNames\":[\"$KEY\"]}")
  case "$cur" in *'"id":'*) break ;; esac
  sleep 2
done

new=$(echo "$cur" | APPS="$APPS" KEY="$KEY" node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const off = process.env.APPS.split(" "), key = process.env.KEY;
    const list = JSON.parse(s).configs[key];
    list.forEach(a => { if (off.includes(a.id)) { a.isEnabled = false; a.isPinUp = false; } });
    process.stdout.write(JSON.stringify({ configs: { [key]: list } }));
  });')
if [ -n "$new" ]; then
  log "preload off for $APPS: $(luna-send -n 1 luna://com.webos.service.config/setConfigs "$new")"
else
  log "preload list not found"
fi

# A preloaded app ignores closeByAppId; closing its process works.
running=$(luna-send -n 1 luna://com.webos.applicationManager/running '{}')
for id in $APPS; do
  pid=$(echo "$running" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const app = (JSON.parse(s).running || []).find(a => a.id === process.argv[1]);
      if (app) process.stdout.write(app.processid || app.webprocessid || "");
    });' "$id")
  if [ -n "$pid" ]; then
    log "close $id: $(luna-send -n 1 luna://com.webos.applicationManager/close "{\"processId\":\"$pid\"}")"
  else
    log "$id not running"
  fi
done
