#!/bin/sh
# Cross-compiles the tunnel server + client into ./dist for distribution.
# Usage: sh services/tunnel-dist/build.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$(cd "$HERE/../agent" && pwd)"
DIST="$HERE/dist"
mkdir -p "$DIST"

cd "$AGENT"
export CGO_ENABLED=0

build() {
  os="$1"; arch="$2"; ext="$3"
  for cmd in tunnel-server tunnel-client; do
    name="$cmd-$os-$arch$ext"
    echo "building $name"
    GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags '-s -w' \
      -o "$DIST/$name" "./cmd/$cmd"
  done
}

build linux   amd64 ""
build linux   arm64 ""
build windows amd64 ".exe"

echo
echo "Artifacts in $DIST:"
ls -lh "$DIST"
