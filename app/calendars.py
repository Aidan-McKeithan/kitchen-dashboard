"""Google (or any) iCal feeds -> a simple list of events.

Calendars come from .env as CAL1_NAME / CAL1_COLOR / CAL1_URL, CAL2_..., etc.
Each feed is downloaded at most every 15 minutes; if a download fails we
keep using the last good copy. Repeating events are expanded by the
`recurring_ical_events` library.
"""
import asyncio
import datetime as dt
import os
import time
from zoneinfo import ZoneInfo

import httpx
import icalendar
import recurring_ical_events

TZ = ZoneInfo("America/New_York")
REFRESH_SECONDS = 900


def _load_config() -> list[dict]:
    cals = []
    for i in range(1, 21):
        url = os.getenv(f"CAL{i}_URL", "").strip()
        if not url:
            continue
        cals.append({
            "id": i,
            "name": os.getenv(f"CAL{i}_NAME", f"Calendar {i}"),
            "color": os.getenv(f"CAL{i}_COLOR", "#5b9cf5"),
            "url": url,
            # runtime state
            "cal": None, "fetched": 0.0, "error": None,
        })
    return cals


CALENDARS = _load_config()


async def _refresh(client: httpx.AsyncClient, c: dict) -> None:
    if c["cal"] is not None and time.time() - c["fetched"] < REFRESH_SECONDS:
        return
    try:
        r = await client.get(c["url"], follow_redirects=True)
        r.raise_for_status()
        c["cal"] = icalendar.Calendar.from_ical(r.content)
        c["fetched"], c["error"] = time.time(), None
    except Exception as e:
        # Never put the URL in the error (it's secret).
        c["error"] = type(e).__name__
        c["fetched"] = time.time() - REFRESH_SECONDS + 120  # retry in ~2 min


def _to_local(value) -> tuple[dt.datetime, bool]:
    """Return (local datetime, all_day)."""
    if isinstance(value, dt.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=TZ)
        return value.astimezone(TZ), False
    return dt.datetime.combine(value, dt.time(), TZ), True


def _events_for(c: dict, start: dt.datetime, end: dt.datetime) -> list[dict]:
    out = []
    for ev in recurring_ical_events.of(c["cal"]).between(start, end):
        s, all_day = _to_local(ev["DTSTART"].dt)
        if ev.get("DTEND") is not None:
            e, _ = _to_local(ev["DTEND"].dt)
        elif ev.get("DURATION") is not None:
            e = s + ev["DURATION"].dt
        else:
            e = s + (dt.timedelta(days=1) if all_day else dt.timedelta(0))
        out.append({
            "title": str(ev.get("SUMMARY", "(no title)")),
            "location": str(ev.get("LOCATION", "")) or None,
            "start": s.isoformat(),
            "end": e.isoformat(),
            "all_day": all_day,
            "calendar": c["name"],
            "color": c["color"],
        })
    return out


async def get_events(days: int) -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        await asyncio.gather(*(_refresh(client, c) for c in CALENDARS))
    today = dt.datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    end = today + dt.timedelta(days=days)
    events = []
    for c in CALENDARS:
        if c["cal"] is not None:
            try:
                events += _events_for(c, today, end)
            except Exception as e:
                c["error"] = f"parse: {type(e).__name__}"
    events.sort(key=lambda e: (e["start"], not e["all_day"], e["title"]))
    return events


def status() -> list[dict]:
    return [{
        "name": c["name"],
        "color": c["color"],
        "ok": c["cal"] is not None and c["error"] is None,
        "error": c["error"],
        "fetched": c["fetched"] if c["cal"] is not None else None,
    } for c in CALENDARS]
