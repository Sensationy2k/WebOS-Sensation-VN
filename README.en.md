# webos-vibehack

An Apple TV-style home screen for LG TVs. It's a webOS port of the launcher from
[tv-vibehack](https://github.com/Gathin23/tv-vibehack), which does the same for Android TVs.

![The launcher running on an LG OLED C6](docs/screenshot.jpg)

Tested on an LG OLED C6 (OLED55C6XLA, webOS 26, firmware 43.21.79).

## What's different from Android

webOS is more locked down than Android TV, so three things work differently:

| | Android TV | LG webOS |
|---|---|---|
| Install | ADB, no account | LG's **Developer Mode** app (free LG developer account) |
| App list | read on the TV | read from your computer by `sync-apps.py` and bundled in; webOS won't let an app list installed apps |
| Home button | the launcher *is* Home | webOS always opens LG's home; `home-watch.py`, running on another device, switches straight back (about 0.1 s) |

There's no debloat step: webOS has no ADB-style package disabling. Turn off LG's ads in the TV's
own settings instead (see [Cleaning up LG's home](#cleaning-up-lgs-home)).

Nothing is rooted. Developer Mode is LG's official way to install your own apps, firmware updates
keep working, and deleting the Developer Mode app removes everything.

## Setup

You need a Mac on the same Wi-Fi as the TV, with Node.js (for LG's `ares` CLI, fetched with `npx`)
and Python 3. The steps are macOS only for now: `install.sh` makes the app icon with `sips`.

**1. Developer Mode on the TV**

1. Create a free account at [webostv.developer.lge.com](https://webostv.developer.lge.com).
2. On the TV, install **Developer Mode** from the LG Content Store and sign in.
3. Turn on **Dev Mode Status** (the TV restarts), open the app again and turn on **Key Server**.
   Note the **IP address** and **Passphrase** it shows.

**2. Connect your computer** (once)

```bash
export TV_HOST=192.168.1.50                       # the IP from the Developer Mode app
npx -y -p @webos-tools/cli ares-setup-device -a lgtv -i "{'host':'$TV_HOST','port':'9922','username':'prisoner'}"
npx -y -p @webos-tools/cli ares-novacom --device lgtv --getkey        # type the passphrase
npx -y -p @webos-tools/cli ares-setup-device -m lgtv -i "{'privatekey':'lgtv_webos','passphrase':'ABC123'}"
```

**3. Install**

```bash
git clone https://github.com/OmkarK97/webos-vibehack.git
cd webos-vibehack
python3 -m venv venv && venv/bin/pip install websockets
TV_HOST=192.168.1.50 ./install.sh
```

The first run shows an "allow this device?" prompt on the TV: accept it. That pairing lets
`sync-apps.py` read your apps and icons. `install.sh` then packages the app, installs it and opens
it. Run it again whenever you install or remove apps on the TV.

**4. A one-press shortcut**

With the launcher open, hold a number key on the remote (say **1**) and assign it. From then on,
holding 1 opens the launcher from anywhere.

## The Home button

webOS hard-wires Home to LG's home, and blocks Developer Mode apps from seeing which app is in front,
so the TV can't redirect it on its own. [`home-watch.py`](home-watch.py) does it from another
always-on device on the same network: it watches the TV's foreground app and, the moment LG's home
appears, opens the launcher on top.

- **Press Home twice** within three seconds to stay on LG's home, for its menus.
- When the TV powers on to LG's home, it goes to the launcher too.
- When the watcher isn't running, Home simply opens LG's home as usual.

On a Mac, install it as a background service that starts at login:

```bash
TV_HOST=192.168.1.50 ./home-watch-mac.sh       # install or update
./home-watch-mac.sh uninstall                  # remove
```

macOS will ask for Local Network access for Python: allow it (System Settings → Privacy & Security →
Local Network), or the watcher logs "No route to host". The log is at
`~/Library/Logs/tv-vibehack-home-watch.log`. A Mac only redirects Home while it's awake and at
home; for every time, run `python3 home-watch.py 192.168.1.50` on something that's always on, such
as a Raspberry Pi.

## Using it

Same as the [Android launcher](https://github.com/Gathin23/tv-vibehack#the-launcher): a dock of four apps with the focused app's name above it and a glow
in its colour, the rest of your apps in a grid below, and Inputs (HDMI ports and Live TV), Wi-Fi
and Settings at the top. The header slides away when the grid scrolls into it.

**Hold OK on a tile** (or press **Info** or the red key) for its menu:

- **Move**: the tile wiggles; move it with the arrows (into the top row puts it in the dock), then
  **OK** to place it or **Back** to cancel. The order is saved on the TV.
- **Hide**: the app stays installed; **Show hidden apps** in the same menu brings it back.
- **Uninstall**: after a confirmation (Cancel is selected first). Only on a rooted TV, where
  `install-root.sh` lets the bundled service uninstall through Homebrew Channel's
  `elevate-service`; LG's own apps and Homebrew Channel aren't offered.

**Configure** in [`app/config.js`](app/config.js): the starting dock, apps to hide, the Live TV
app and the number of columns. App ids come from `venv/bin/python sync-apps.py $TV_HOST --list`.
Changing `dockApps` resets an order arranged on the TV.

## Wallpaper

The picture button next to Settings opens the wallpaper picker:

- **Bing**: Bing's picture of the day, changing daily, or one from the last fortnight.
- **From a phone**: while the picker is open, the TV serves a page at the address under the QR
  code. Scan it with a phone on the same Wi-Fi and pick a photo (on Android the picker includes
  Google Photos), or paste a Google Photos share link or any image link. The picture appears on
  the TV at once. The page goes away when the picker closes.

The bundled service in [`service/`](service/) serves the page and fetches Bing's list. The chosen
picture is kept on the TV in the launcher's storage.

## Rooted TVs

With root SSH (Homebrew Channel) there's no need for Developer Mode:

```bash
TV_HOST=192.168.1.50 TV_SSH_KEY=~/.ssh/tvkey ./install-root.sh
```

`TV_SSH_KEY` also lets `sync-apps.py` fetch the 192px icons that only exist on the TV's disk.

Add `HOME_WATCH=1` to run the Home button watcher on the TV itself instead of another device:
[`service/tv/home-watch.sh`](service/tv/home-watch.sh) goes into Homebrew Channel's `init.d`, so it starts at
every boot. Unlike `home-watch.py`, Home always comes back to the launcher: LG's home sometimes
takes the screen back a second after the switch, which made "press Home twice" misfire, and the
TV doesn't let anything but its compositor read the remote. For LG's home and its menus, use the
house button in the launcher's top bar. It also opens the launcher when the TV is turned on to
Live TV or an HDMI input (with no signal those show LG's own slideshow), and logs to
`/tmp/tvhome-homewatch.log`. To remove it, delete `/var/lib/webosbrew/init.d/tvhome-homewatch` on
the TV and run `pkill -f tvhome-homewatch`.

Add `SCREENSAVER=1` to replace LG's screensaver (and its ads) with a slideshow of Bing's pictures
and every picture sent from a phone, with a clock: [`service/tv/screensaver.qml`](service/tv/screensaver.qml),
bind-mounted over LG's at boot by [`service/tv/screensaver.sh`](service/tv/screensaver.sh). Phone pictures are
kept in `/media/internal/tvhome-photos` (the latest 60). Try it with
`luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreenSaver '{}'`. To remove it,
delete `/var/lib/webosbrew/init.d/tvhome-screensaver` on the TV and reboot.

Add `NO_ASSISTANT=1` to stop Google Assistant being kept in memory (about 40 MB).

## Cleaning up LG's home

For when you do land on it. Names vary a little by webOS version:

- **Settings → General → System → Additional Settings → Home Settings**: turn off **Home
  Promotion** and **Content Recommendation**.
- **Settings → Support → Privacy & Terms → User Agreements**: untick **Viewing Information** and
  **Interest-Based Recommendations**.

## Troubleshooting

- **Pairing fails with "403 Pairing rejected: blacklisted certificate detected".** Newer firmware
  rejects the signed manifest that open-source LG clients share. `lgtv.py` pairs with an unsigned
  one, which still works.
- **No pairing prompt on the TV.** Turn on the TV's option for connecting from mobile apps (on the
  C6: Settings → General → Devices → External Devices; named "LG Connect Apps" or similar).
- **`ares` says "All configured authentication methods failed".** The device profile is missing
  its key: run the third command in step 2 again.
- **Apps stop opening after a while.** Developer Mode sessions expire (LG shows the time left in
  the Developer Mode app; it was 999 hours on our C6). Press **Extend Session Time** there.

## Files

| File | What it does |
|---|---|
| [`app/`](app/) | The launcher: `index.html`, `style.css`, `app.js`, `config.js`, `appinfo.json` |
| [`service/`](service/) | The wallpaper service: the phone upload page and Bing's pictures |
| [`install.sh`](install.sh) | Syncs your apps, packages and installs the launcher, and opens it |
| [`install-root.sh`](install-root.sh) | The same for a rooted TV, over root SSH |
| [`sync-apps.py`](sync-apps.py) | Reads apps, icons and HDMI inputs from the TV into `app/apps.js` and `app/icons/` |
| [`home-watch.py`](home-watch.py) | Sends the Home button to the launcher |
| [`home-watch-mac.sh`](home-watch-mac.sh) | Runs the watcher as a macOS background service |
| [`service/tv/home-watch.sh`](service/tv/home-watch.sh) | The watcher on a rooted TV itself, started at boot |
| [`service/tv/no-assistant.sh`](service/tv/no-assistant.sh) | Keeps Google Assistant out of memory on a rooted TV |
| [`lgtv.py`](lgtv.py) | Pairs with and talks to the TV's remote-control service |
| [`assets/icon.jpg`](assets/icon.jpg) | The app icon, resized to PNG by `install.sh` |

## Credits

The design, layout and app icon come from [tv-vibehack](https://github.com/Gathin23/tv-vibehack)
by [Gathin](https://github.com/Gathin23). The Outfit font is under the SIL Open Font License
([`app/fonts/OFL.txt`](app/fonts/OFL.txt)). MIT licensed, see [`LICENSE`](LICENSE).
