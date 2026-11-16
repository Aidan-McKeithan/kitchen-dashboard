#!/bin/sh
# Switch the wall screen between portrait and landscape.
#   ./rotate.sh portrait     (monitor turned vertical; transform 90 — use 270 if upside-down)
#   ./rotate.sh landscape    (monitor in normal orientation)
# Saves the choice for future boots and applies it immediately.
set -e
case "$1" in
  portrait)  T=90 ;;
  landscape) T=normal ;;
  *) echo "usage: $0 portrait|landscape"; exit 1 ;;
esac
DIR=$(dirname "$(readlink -f "$0")")
cp "$DIR/kanshi.$1.config" "$HOME/.config/kanshi/config"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
wlr-randr --output HDMI-A-1 --transform "$T"
echo "Display set to $1 (transform $T)."
