"""Weather from Open-Meteo (free, no API key). Cached for 10 minutes."""
import os
import time

import httpx

URL = "https://api.open-meteo.com/v1/forecast"
CACHE_SECONDS = 600

_cache: dict = {"t": 0.0, "data": None}


async def get() -> dict:
    if _cache["data"] and time.time() - _cache["t"] < CACHE_SECONDS:
        return _cache["data"]
    params = {
        "latitude": os.getenv("LAT", "36.1224"),
        "longitude": os.getenv("LON", "-78.6861"),
        "current": "temperature_2m,apparent_temperature,weather_code,is_day",
        "hourly": "temperature_2m,weather_code,precipitation_probability,is_day",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "timezone": "America/New_York",
        "forecast_days": 7,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(URL, params=params)
            r.raise_for_status()
            j = r.json()
    except Exception as e:  # network hiccup: serve stale data if we have it
        if _cache["data"]:
            return {**_cache["data"], "stale": True}
        raise RuntimeError(f"weather fetch failed: {e}") from e

    cur, h, d = j["current"], j["hourly"], j["daily"]
    now_hour = cur["time"][:13]  # "YYYY-MM-DDTHH"
    start = next((i for i, t in enumerate(h["time"]) if t[:13] >= now_hour), 0)
    data = {
        "current": {
            "temp": round(cur["temperature_2m"]),
            "feels": round(cur["apparent_temperature"]),
            "code": cur["weather_code"],
            "is_day": cur["is_day"],
        },
        "hourly": [
            {
                "time": h["time"][i],
                "temp": round(h["temperature_2m"][i]),
                "code": h["weather_code"][i],
                "precip": h["precipitation_probability"][i],
                "is_day": h["is_day"][i],
            }
            for i in range(start, min(start + 25, len(h["time"])))
        ],
        "daily": [
            {
                "date": d["time"][i],
                "hi": round(d["temperature_2m_max"][i]),
                "lo": round(d["temperature_2m_min"][i]),
                "code": d["weather_code"][i],
                "precip": d["precipitation_probability_max"][i],
                "sunrise": d["sunrise"][i],
                "sunset": d["sunset"][i],
            }
            for i in range(len(d["time"]))
        ],
        "stale": False,
    }
    _cache.update(t=time.time(), data=data)
    return data
