#!/usr/bin/env python3
"""Fetch the TV's apps, icons and HDMI inputs into app/apps.js and app/icons/.

webOS does not let a third-party app list installed apps, so the launcher reads them from here.

    python3 sync-apps.py 192.168.1.50          # sync
    python3 sync-apps.py 192.168.1.50 --list   # just print app ids and titles

On a rooted TV, set TV_SSH_KEY to an SSH key for root: the 192px (or 4K) icons that only exist on
the TV's disk are fetched over SSH instead of the 130px ones the remote service serves.

Needs: pip install websockets pillow (pillow works out the tile colours; without it the launcher
tries to on the TV, which webOS blocks)
"""
import asyncio
import colorsys
import io
import json
import os
import shlex
import subprocess
import sys
import time
import urllib.request

import lgtv

try:
    from PIL import Image
except ImportError:
    Image = None

APP_DIR = os.path.join(lgtv.HERE, "app")
SSH_KEY = os.environ.get("TV_SSH_KEY")


def fetch_ssh(host, path):
    """A file from the TV's disk over root SSH, or None."""
    if not (SSH_KEY and path.startswith("/")):
        return None
    try:
        r = subprocess.run(["ssh", "-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                            f"root@{host}", "cat " + shlex.quote(path)], capture_output=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 and r.stdout else None


def hex_color(rgb):
    return "#%02x%02x%02x" % tuple(int(round(v)) for v in rgb[:3])


def tile_colors(data):
    """(background, glow) for a tile, as app.js would work them out from the icon.

    The background is the icon's edge colour when the icon is opaque there; the glow is its most
    saturated, not too dark pixel, or the lifted average of a nearly monochrome icon.
    """
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    w, h = im.size
    edge = im.getpixel((2, 2))
    if edge[3] <= 200:
        edge = im.getpixel((2, h // 2))
    bg = hex_color(edge) if edge[3] > 200 else None

    best, best_score, total, n = None, -1, [0, 0, 0], 0
    raw = im.resize((12, 12), Image.BILINEAR).tobytes()
    for p in (raw[i:i + 4] for i in range(0, len(raw), 4)):
        if p[3] < 128:
            continue
        total = [t + v for t, v in zip(total, p)]
        n += 1
        _, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in p[:3]))
        score = s * min(1, v * 1.4)
        if score > best_score:
            best, best_score = p, score
    if not n:
        return bg, "#444444"
    if best_score < 0.25:
        hh, s, v = colorsys.rgb_to_hsv(*(t / n / 255 for t in total))
        v = max(v, 0.55)
    else:
        hh, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in best[:3]))
        s, v = min(1, s * 1.1), max(0.5, v)
    return bg, hex_color([c * 255 for c in colorsys.hsv_to_rgb(hh, s, v)])


async def main(host, list_only):
    ws = await lgtv.session(host)
    try:
        points = (await lgtv.call(ws, "ssap://com.webos.applicationManager/listLaunchPoints")).get("launchPoints", [])
        inputs = (await lgtv.call(ws, "ssap://tv/getExternalInputList")).get("devices", [])
    finally:
        await ws.close()

    if list_only:
        for p in points:
            print(f'{p["id"]:45} {p["title"]}')
        return

    icon_dir = os.path.join(APP_DIR, "icons")
    os.makedirs(icon_dir, exist_ok=True)
    ctx = lgtv.insecure_ctx()
    apps = []
    for p in points:
        if p.get("hidden") or p["id"] == "com.gathin.tvhome":   # not the launcher itself
            continue
        url = p.get("largeIcon") if str(p.get("largeIcon", "")).startswith("http") else p.get("icon")
        name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in p["id"]) + ".png"
        data = fetch_ssh(host, p.get("extraLargeIcon") or "")
        if not data:
            try:
                data = urllib.request.urlopen(url, context=ctx, timeout=10).read()
            except Exception as e:
                print(f"  no icon for {p['id']}: {e}")
                continue
        with open(os.path.join(icon_dir, name), "wb") as f:
            f.write(data)
        app = {
            "id": p["id"],
            "title": p["title"],
            "icon": "icons/" + name,
            "iconColor": p.get("iconColor") or p.get("bgColor") or "",
        }
        if Image:
            try:
                bg, glow = tile_colors(data)
                app["glow"] = glow
                if bg:
                    app["bg"] = bg
            except Exception as e:
                print(f"  no colours for {p['id']}: {e}")
        apps.append(app)
    out = {
        "apps": apps,
        "inputs": [{"appId": d["appId"], "label": d.get("label") or d["id"]} for d in inputs if d.get("appId")],
        # ms since 1970: apps uninstalled from the launcher before this sync don't count any more
        "synced": int(time.time() * 1000),
    }
    with open(os.path.join(APP_DIR, "apps.js"), "w") as f:
        f.write("// Generated by sync-apps.py: the TV's apps and inputs.\n")
        f.write("window.TV_APPS = " + json.dumps(out, indent=1, ensure_ascii=False) + ";\n")
    print(f"Synced {len(apps)} apps and {len(out['inputs'])} inputs.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    host = args[0] if args else os.environ.get("TV_HOST")
    if not host:
        sys.exit("usage: sync-apps.py <TV IP> [--list]")
    asyncio.run(main(host, "--list" in sys.argv))
