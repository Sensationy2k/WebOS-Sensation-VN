#!/usr/bin/env bash
# Builds the release IPK and the Homebrew Channel repository that lists it.
#   ./make-release.sh            then: gh release create v<version> build/release/*.ipk
#
# The IPK is the launcher and its service without any TV's apps (on a rooted TV the service reads
# them on the TV). docs/apps.json and docs/manifest.json are the repository, served by GitHub Pages:
# in Homebrew Channel, Settings, add https://sensationy2k.github.io/WebOS-Sensation-VN/apps.json
set -euo pipefail
cd "$(dirname "$0")"
REPO=Sensationy2k/WebOS-Sensation-VN
PAGES=https://sensationy2k.github.io/WebOS-Sensation-VN
APP_ID=com.gathin.tvhome

PY="${PY:-python3}"
[ -x venv/bin/python ] && PY=venv/bin/python
[ -x venv/Scripts/python ] && PY=venv/Scripts/python

VERSION=$("$PY" -c "import json; print(json.load(open('app/appinfo.json'))['version'])")
OUT=build/release
rm -rf "$OUT" && mkdir -p "$OUT/pkg"

# The app without apps.js and icons/ (one TV's apps, from sync-apps.py).
cp -r app "$OUT/pkg/app"
rm -rf "$OUT/pkg/app/apps.js" "$OUT/pkg/app/icons"
"$PY" -c "
from PIL import Image
im = Image.open('assets/icon.jpg').convert('RGB')
im.resize((80, 80), Image.LANCZOS).save('$OUT/pkg/app/icon.png')
im.resize((130, 130), Image.LANCZOS).save('$OUT/pkg/app/largeIcon.png')"
npx -y -p @webos-tools/cli ares-package "$OUT/pkg/app" service -o "$OUT" >/dev/null
IPK="$OUT/${APP_ID}_${VERSION}_all.ipk"
[ -f "$IPK" ] || { echo "no $IPK"; exit 1; }
cp "$OUT/pkg/app/largeIcon.png" docs/icon.png

"$PY" - "$IPK" "$VERSION" <<EOF
import hashlib, json, os, sys
ipk, version = sys.argv[1], sys.argv[2]
data = open(ipk, "rb").read()
manifest = {
    "id": "$APP_ID",
    "version": version,
    "type": "web",
    "title": "WebOS Sensation VN",
    "appDescription": "Màn hình chính kiểu Apple TV: hình nền Bing và ảnh từ điện thoại, gỡ và sắp xếp app, "
                      "nút Home luôn về launcher, trình bảo vệ màn hình.",
    "iconUri": "$PAGES/icon.png",
    "sourceUrl": "https://github.com/$REPO",
    "rootRequired": "optional",
    "ipkUrl": "https://github.com/$REPO/releases/download/v%s/%s" % (version, os.path.basename(ipk)),
    "ipkHash": {"sha256": hashlib.sha256(data).hexdigest()},
    "ipkSize": len(data),
}
repo = {
    "paging": {"page": 1, "count": 1, "maxPage": 1, "itemsTotal": 1, "prevUrl": None, "nextUrl": None},
    "packages": [{
        "id": manifest["id"],
        "title": manifest["title"],
        "iconUri": manifest["iconUri"],
        "manifestUrl": "$PAGES/manifest.json",
        "manifest": manifest,
        "pool": "main",
        "requirements": {"webosRelease": ">=4.0"},
        "shortDescription": manifest["appDescription"],
    }],
}
for name, obj in (("docs/manifest.json", manifest), ("docs/apps.json", repo)):
    with open(name, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
print("version", version, "sha256", manifest["ipkHash"]["sha256"], "size", len(data))
EOF
echo "Built $IPK; docs/apps.json and docs/manifest.json point at release v$VERSION."
