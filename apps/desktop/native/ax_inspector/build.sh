#!/usr/bin/env bash
# Build the macOS accessibility inspector helper for Phase 2 (experimental).
# Produces ./ax_inspector next to this script. Requires Xcode command line tools.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install Xcode command line tools: xcode-select --install" >&2
  exit 1
fi

echo "Compiling ax_inspector (macOS, $(uname -m))..."
swiftc -O \
  -framework ApplicationServices \
  -framework Foundation \
  main.swift \
  -o ax_inspector

echo "Built: $(pwd)/ax_inspector"
