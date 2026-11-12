#!/usr/bin/env bash
# Build a static, sub-path-safe copy of the site into .static-export/
# (used for the claude.ai preview). Leaves the working tree untouched.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

(cd "$REPO" && git archive HEAD) | tar -x -C "$WORK"
cat > "$WORK/next.config.ts" <<'CFG'
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "export", assetPrefix: "./", images: { unoptimized: true } };
export default nextConfig;
CFG
(cd "$WORK" && npm ci --prefer-offline --no-audit --no-fund >/dev/null && npx next build)

OUT="$REPO/.static-export"
rm -rf "$OUT" && cp -r "$WORK/out" "$OUT" && cd "$OUT"
rm -rf _not-found _not-found.html _not-found.txt 404.html __next.*.txt index.txt
find . -name "*.map" -delete
mv _next nxt
# Rewrite every reference, including the Turbopack runtime chunk base ("./_next/")
grep -rlE '_next/' --include=*.js --include=*.css --include=*.html . | xargs sed -i -E 's#(\./|/)_next/#\1nxt/#g'
grep -rl '"/media/' . | xargs -r sed -i 's#"/media/#"./media/#g'
sed -i 's#href="/icon.svg#href="./icon.svg#g' index.html
echo "Static site written to $OUT"
