#!/usr/bin/env bash
# Transcode a device screen recording to H.264, attach it to the Frontier
# Painter App Review detail, and push the review notes (item 1 already says a
# recording is attached).
#   ios/appstore/attach-recording.sh ~/Downloads/RPReplay_Final....mov [version]
set -euo pipefail
SRC=${1:?usage: attach-recording.sh <recording.mov|mp4> [version]}
VERSION=${2:-}   # default: newest editable App Store version
BUNDLE=com.dnuke.frontierpainter
V=${ASC_PYTHON:-/usr/bin/python3}   # needs pyjwt + requests + cryptography
T=$HOME/.claude/skills/app-store-release/tools
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${TMPDIR:-/tmp}/frontierpainter-review${VERSION:+-$VERSION}.mp4

echo "transcoding $SRC -> $OUT (H.264, 30 fps, <=1366 px tall)"
# Cap the HEIGHT (landscape gameplay would lose legibility if capped by width).
ffmpeg -y -loglevel error -i "$SRC" -vf "scale=-2:'min(1366,ih)':flags=lanczos,fps=30" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart -an "$OUT"
ls -l "$OUT"

echo "attaching to $BUNDLE ${VERSION:-(newest version)}"
"$V" "$T/asc_review_attachment.py" --bundle-id "$BUNDLE" ${VERSION:+--version "$VERSION"} --replace --file "$OUT"

echo "pushing review notes"
"$V" - "$BUNDLE" "$VERSION" "$HERE/metadata/review_notes.txt" <<'PY'
import os, sys; sys.path.insert(0, os.path.expanduser('~/.claude/skills/app-store-release/tools'))
from asc_listing import Client, attrs
bundle, version, notes_path = sys.argv[1:]
c = Client(dry=False)
app = c.get("/apps", **{"filter[bundleId]": bundle})["data"][0]["id"]
vers = c.get(f"/apps/{app}/appStoreVersions", limit=10)["data"]
v = [x for x in vers if not version or x["attributes"]["versionString"] == version][0]
print(f"  version {v['attributes']['versionString']} ({v['attributes'].get('appVersionState')})")
d = c.get(f"/appStoreVersions/{v['id']}/appStoreReviewDetail")["data"]
notes = open(notes_path).read().strip()
assert len(notes) <= 4000, len(notes)
c.write("PATCH", f"/appStoreReviewDetails/{d['id']}", attrs("appStoreReviewDetails", d["id"], {"notes": notes}))
print(f"  review notes updated in App Store Connect ({len(notes)} chars)")
PY
echo "done. Next: App Privacy in the web UI (if not done), then submit — see ios/appstore/SUBMIT.md."
