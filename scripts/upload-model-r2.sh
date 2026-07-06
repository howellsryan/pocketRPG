#!/usr/bin/env bash
# Process a raw Tripo GLB and upload the optimised output to the R2 bucket.
# Requires wrangler auth (`npx wrangler login` or CLOUDFLARE_API_TOKEN).
#
#   scripts/upload-model-r2.sh <raw.glb> <name.glb> [process-3d-model flags...]
#   e.g. scripts/upload-model-r2.sh ~/Downloads/tripo_dragon.glb red_dragon.glb --ratio 0.05
#
# Objects land under models/ in the bucket. Prefer content-suffixed names
# (red_dragon.v2.glb) over overwriting: R2 + a custom domain serve these with
# long cache lifetimes, and a renamed file can be cached immutably forever.
set -euo pipefail

BUCKET="${R2_BUCKET:-pocketrpg-tripo-assets}"
raw="$1"; name="$2"; shift 2

out="$(mktemp -d)/$name"
node scripts/process-3d-model.mjs "$raw" "$out" "$@"

npx wrangler r2 object put "$BUCKET/models/$name" \
  --file "$out" \
  --content-type model/gltf-binary \
  --remote

echo "uploaded -> r2://$BUCKET/models/$name"
echo "registry: set equipmentModels.json modelBase (or the entry's model) to the bucket's public URL + models/$name"
