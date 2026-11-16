# Kitchen Dashboard – project context

## Goal
Wall-mounted kitchen dashboard for me (Aidan) and my fiancée, replacing a Skylight-style calendar.
Must match her design (screenshot provided separately): dark theme, rounded cards, "Good morning" greeting + date + clock,
Weather card, Today's Schedule, To-do List, Dinner Tonight, Upcoming Events (next 7 days),
bottom tab bar: Home, Calendar, Lists, Meals, Settings.
We must be able to add/check off to-dos and set meals from our phones on the home network.

## Hardware / system
- Raspberry Pi 5 (8GB), Raspberry Pi OS 64-bit (Debian 13 trixie), labwc (Wayland) desktop, autologin
- Hostname: MACHouse (machouse.local), user: ahmckeit, managed headless over SSH
- Screen blanking already disabled via raspi-config
- Display: HDMI monitor now; may switch to a touchscreen later (design should be touch-friendly)
- Location for weather: Creedmoor, NC (use Open-Meteo, no API key)

## Existing stuff on the Pi
- MagicMirror² is installed in ~/MagicMirror, run by pm2 (process name "MagicMirror"). Keep it as a fallback until the new dashboard works; then we'll `pm2 stop MagicMirror` and kiosk Chromium to the new app.
- MagicMirror's config (~/MagicMirror/config/config.js) contains my Google Calendar *secret iCal URL*. Don't hard-code it in this repo; read it from a .env file (gitignored).

## Tech choices
- Backend: Python + FastAPI, SQLite for to-dos and meals
- Frontend: plain HTML/CSS/JS (no heavy frameworks), served by the backend
- Calendar: start with the Google iCal feed; Google Calendar API later if needed
- Run as a systemd service so it starts on boot; Chromium in kiosk mode on the display

## How I want to work
- I'm an EE grad (FPGA/RTL, some Python) learning web dev/Linux as we go. Explain what you're doing and why, in short chunks.
- Build incrementally: home screen + to-do list first, then the rest.
- Ask before deleting anything or changing system-wide settings.

## Extra context (added from planning chat)

### Hardware history / reliability
- Original Samsung EVO Plus microSD failed (I/O errors after an apt upgrade; Imager verify failed). Now running on a SanDisk 128GB card. Power checked: vcgencmd get_throttled = 0x0.
- Keep SD writes reasonable (no chatty logging to disk, no frequent DB writes in loops). Later we may enable the overlay filesystem (raspi-config) to protect against power-loss corruption.

### Display
- Currently a landscape Sceptre HDMI monitor. Plan to buy a 22–24" USB touchscreen later (possibly portrait), so keep layout responsive and touch-friendly.
- MagicMirror runs fullscreen via Electron and will cover the screen while it's running; stop it (pm2 stop MagicMirror) when testing the new dashboard on the display.

### Ports / services
- MagicMirror uses port 8080. Use a different port for this app (e.g., 8000).
- Node 22 and pm2 are installed (from the MagicMirror install).
- The MagicMirror installer changed the Plymouth boot splash to a MagicMirror theme; we may change it later.

### Calendars
- My main Google calendar's secret iCal URL works but currently returns 0 events (it's mostly empty).
- Other calendars: "Aidan Events / To-Do" (shared with me; may not expose a secret iCal URL), "Holidays in United States". My fiancée will send her own secret iCal URL to add later.
- Google Birthdays and Google Tasks are NOT available via iCal (would need the Google API).
- Support multiple calendars with a color/person label per calendar (e.g., blue = Aidan, pink = Family/fiancée).

### Future feature ideas (not now, but design so they're easy to add)
- Phone control: mobile page saved to phone home screens ("Add to Home Screen" / PWA-style).
- Away/Home modes: detect our phones on Wi-Fi, switch to a photo/away screen or turn display off when we're both gone.
- PIR motion sensor on GPIO to wake/sleep the screen.
- Photo slideshow (Google Photos album or local folder) as idle/background.
- Grocery list, meal plan for the week, chore chart, dog tracker (fed/walked/meds), trash-day reminder, commute time to RTP, football scores/schedules.
- Night mode: screen off overnight on a schedule.
- Later: Home Assistant integration (lights, cameras), Tailscale for access away from home.

### Network
- Reach the Pi as machouse.local. Plan to set a DHCP reservation in the router. scp from Windows works.

## Current setup (as built)
- Code: `app/` (FastAPI: main.py API, db.py SQLite at data/dashboard.db, weather.py, calendars.py), `static/` (index.html, style.css, app.js).
- Calendars + location live in `.env` (gitignored): CAL<n>_NAME / CAL<n>_COLOR / CAL<n>_URL.
- Server: systemd *user* service `kitchen-dashboard` (deploy/kitchen-dashboard.service, symlinked into ~/.config/systemd/user). `systemctl --user restart kitchen-dashboard` after backend changes; front-end changes just need a page reload.
- Kiosk: ~/.config/labwc/autostart (copy of deploy/labwc-autostart) runs deploy/kiosk.sh via lwrespawn → Chromium `--kiosk --ozone-platform=wayland --password-store=basic` at http://localhost:8000/?kiosk. (Without --password-store=basic Chromium hangs on the keyring; without --ozone-platform=wayland it fails looking for X11.)
- Display rotated to portrait: ~/.config/kanshi/config (copy of deploy/kanshi.config), transform 90.
- MagicMirror: stopped in pm2 (`pm2 stop MagicMirror && pm2 save`). Fallback: `pm2 start MagicMirror`.
- Phones: http://machouse.local:8000 (or http://192.168.1.2:8000); `?kiosk` adds night-mode blanking + auto-return to Home.
- Linger enabled (`loginctl enable-linger ahmckeit`), so the user service runs even with no login session.
- Tailscale installed on the Pi (MagicDNS on). Away access: http://machouse:8000 (Tailscale IP 100.77.138.81). Fiancée to be invited to the tailnet later.
- GitHub backup: private repo git@github.com:Aidan-McKeithan/kitchen-dashboard.git (Pi SSH key ~/.ssh/id_ed25519 added to GitHub). Push after each commit. .env and data/ are NOT in git.
