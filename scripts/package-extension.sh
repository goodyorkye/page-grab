#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
EXT_DIR="$REPO_ROOT/extension"
DIST_DIR="$REPO_ROOT/dist"
MANIFEST_PATH="$EXT_DIR/manifest.json"

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "manifest.json not found: $MANIFEST_PATH" >&2
  exit 1
fi

VERSION=$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_PATH" \
    | head -n 1
)

if [ -z "$VERSION" ]; then
  echo "failed to read extension version from $MANIFEST_PATH" >&2
  exit 1
fi

OUTPUT_PATH=${1:-"$DIST_DIR/pagegrab-extension-v$VERSION.zip"}
case "$OUTPUT_PATH" in
  /*) ;;
  *) OUTPUT_PATH="$REPO_ROOT/$OUTPUT_PATH" ;;
esac
OUTPUT_DIR=$(dirname "$OUTPUT_PATH")

mkdir -p "$OUTPUT_DIR"

STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pagegrab-extension.XXXXXX")
cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT INT TERM

cp -R "$EXT_DIR/." "$STAGE_DIR/"
find "$STAGE_DIR" -name '.DS_Store' -delete
rm -f "$OUTPUT_PATH"

(
  cd "$STAGE_DIR"
  zip -qrX "$OUTPUT_PATH" .
)

echo "Created: $OUTPUT_PATH"
