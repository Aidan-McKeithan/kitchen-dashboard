#!/bin/sh
# Opens the dashboard fullscreen on the Pi's display.
# Started at login by ~/.config/labwc/autostart (via lwrespawn, which restarts it if it ever closes).

# Wait (up to 60 s) for the dashboard server to be up.
for i in $(seq 1 60); do
  curl -s -o /dev/null http://localhost:8000/api/rev && break
  sleep 1
done

# --password-store=basic: without it Chromium can hang waiting for the desktop keyring.
# A separate profile folder keeps kiosk settings apart from normal browsing.
exec chromium \
  --kiosk \
  --ozone-platform=wayland \
  --password-store=basic \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=Translate \
  --check-for-update-interval=31536000 \
  --user-data-dir="$HOME/.config/kitchen-kiosk" \
  "http://localhost:8000/?kiosk"
