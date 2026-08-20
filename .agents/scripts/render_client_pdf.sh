#!/usr/bin/env bash
set -euo pipefail
pdf="$1"
out="$2"
mkdir -p "$out"
mutool draw -r 120 -o "$out/page-%02d.png" "$pdf" >/dev/null
pdftotext -layout "$pdf" "$out/client-complaint.txt"
