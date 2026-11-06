// A surface-manager key filter: the Home key opens the launcher straight away, instead of LG's home
// (which the Home watcher would then have to replace: about two seconds of LG's home on screen).
// home-watch.sh copies this next to itself and adds it to com.webos.surfacemanager.keyFilters,
// in memory: surface-manager reloads its filters when that changes, and a reboot without the
// watcher brings LG's list back. Loaded by WebOSCompositor's StarfishKeyFilterLoader, which sets
// the compositor's helpers (lunaCall, global, ...) on this file's scope.
//
// LG's home stays one key away: the launcher's LG home button opens it, and Home there comes back.

var LAUNCHER = "com.gathin.tvhome";
var HOME_KEYS = [Qt.Key_Super_L, Qt.Key_Meta];

function init() {}

// Skipped (left to LG's handling) while something of the system's own needs the Home key: a modal
// alert, the magnifier and other special UI, the voice agent.
function systemBusy() {
    try {
        if (typeof modalAlert !== "undefined" && modalAlert.visible) return true;
        if (typeof global !== "undefined" && global.specialUIVisible) return true;
        if (typeof voiceAgent !== "undefined" && voiceAgent.isRunning()) return true;
    } catch (e) { return true; }
    return false;
}

function handleHomeToLauncher(key, pressed, autoRepeat, deviceId) {
    if (HOME_KEYS.indexOf(key) === -1 || systemBusy()) return KeyPolicy.NextPolicy;
    if (pressed && !autoRepeat) {
        try {
            // As LG's own Home handler launches its home (systemUi.js launchHomeApp).
            applicationManager.launch(LAUNCHER, JSON.stringify({ launchType: "homeKey" }));
        } catch (e) {
            return KeyPolicy.NextPolicy;   // no way to launch it from here: LG's home as before
        }
    }
    return KeyPolicy.Accepted;   // the release too, so LG's handler never sees half a press
}
