"""Kitchen Dashboard web server.

Run:  .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Serves the page in ../static and a small JSON API under /api.
"""
import datetime as dt
import re
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent
load_dotenv(BASE / ".env")  # must happen before calendars reads env vars

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field, field_validator  # noqa: E402

from fastapi import File, UploadFile  # noqa: E402

from . import calendars, db, photos, weather  # noqa: E402


@asynccontextmanager
async def lifespan(_app):
    db.init()
    yield


app = FastAPI(title="Kitchen Dashboard", lifespan=lifespan)


@app.middleware("http")
async def no_cache(request: Request, call_next):
    # Make browsers always re-check files, so code updates show up on reload.
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


# ---------- page ----------
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(BASE / "static" / "index.html")


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(BASE / "static" / "manifest.webmanifest", media_type="application/manifest+json")


# ---------- change polling ----------
@app.get("/api/rev")
def get_rev():
    return {"rev": db.rev}


# ---------- lists (to-do, groceries, ...) ----------
LIST_NAME = re.compile(r"^[a-z0-9-]{1,30}$")


def _check_list(name: str) -> None:
    if not LIST_NAME.match(name):
        raise HTTPException(400, "bad list name")


class ItemIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)


class ItemPatch(BaseModel):
    done: bool | None = None
    text: str | None = Field(default=None, min_length=1, max_length=200)


@app.get("/api/lists/{name}")
def list_items(name: str):
    _check_list(name)
    return db.query("SELECT * FROM items WHERE list = ? ORDER BY done, id", (name,))


@app.post("/api/lists/{name}")
def add_item(name: str, item: ItemIn):
    _check_list(name)
    cur = db.write("INSERT INTO items(list, text) VALUES (?, ?)", (name, item.text.strip()))
    return {"id": cur.lastrowid}


class QuickAddIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


# Split spoken/typed text like "milk, eggs and bread" into separate items.
# (Trade-off: "mac and cheese" becomes two items; easy to fix on the list.)
_SPLIT = re.compile(r"\s*(?:,|;|\n|\band\b)\s*", re.I)
LIST_LABELS = {"grocery": "groceries", "todo": "your to-do list"}


@app.post("/api/lists/{name}/quick-add")
def quick_add(name: str, body: QuickAddIn):
    """For Siri Shortcuts: add several items from one sentence, reply with a sentence Siri can speak."""
    _check_list(name)
    existing = {r["text"].lower() for r in db.query("SELECT text FROM items WHERE list = ? AND done = 0", (name,))}
    added, skipped = [], []
    for part in _SPLIT.split(body.text)[:20]:
        item = part.strip(" .!?").strip()
        if not item:
            continue
        item = item[0].upper() + item[1:]
        if item.lower() in existing:
            skipped.append(item.lower())
            continue
        db.write("INSERT INTO items(list, text) VALUES (?, ?)", (name, item[:200]))
        existing.add(item.lower())
        added.append(item.lower())

    def join(xs):
        return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]

    label = LIST_LABELS.get(name, f"the {name} list")
    msg = []
    if added:
        msg.append(f"Added {join(added)} to {label}.")
    if skipped:
        msg.append(f"{join(skipped).capitalize()} {'was' if len(skipped) == 1 else 'were'} already on it.")
    return {"added": added, "skipped": skipped, "message": " ".join(msg) or "I didn't catch anything to add."}


@app.patch("/api/items/{item_id}")
def update_item(item_id: int, patch: ItemPatch):
    if patch.done is not None:
        db.write(
            "UPDATE items SET done = ?, done_at = CASE WHEN ? THEN datetime('now','localtime') END WHERE id = ?",
            (int(patch.done), int(patch.done), item_id),
        )
    if patch.text is not None:
        db.write("UPDATE items SET text = ? WHERE id = ?", (patch.text.strip(), item_id))
    return {"ok": True}


@app.delete("/api/items/{item_id}")
def delete_item(item_id: int):
    db.write("DELETE FROM items WHERE id = ?", (item_id,))
    return {"ok": True}


@app.post("/api/lists/{name}/clear-done")
def clear_done(name: str):
    _check_list(name)
    db.write("DELETE FROM items WHERE list = ? AND done = 1", (name,))
    return {"ok": True}


# ---------- meals ----------
class MealIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    prep_min: int | None = Field(default=None, ge=0, le=1440)
    cook_min: int | None = Field(default=None, ge=0, le=1440)
    url: str | None = Field(default=None, max_length=500)
    recipe: str | None = Field(default=None, max_length=5000)

    @field_validator("url")
    @classmethod
    def http_only(cls, v):
        # Only allow real web links (blocks "javascript:" tricks).
        if v and not re.match(r"^https?://", v.strip(), re.I):
            raise ValueError("recipe link must start with http:// or https://")
        return v.strip() if v else None


def _check_day(day: str) -> None:
    try:
        dt.date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, "day must be YYYY-MM-DD")


@app.get("/api/meals")
def get_meals(start: str | None = None, days: int = 7):
    first = dt.date.fromisoformat(start) if start else dt.date.today()
    last = first + dt.timedelta(days=max(1, min(days, 62)) - 1)
    rows = db.query("SELECT * FROM meals WHERE day BETWEEN ? AND ?", (first.isoformat(), last.isoformat()))
    return {r["day"]: r for r in rows}


@app.put("/api/meals/{day}")
def set_meal(day: str, meal: MealIn):
    _check_day(day)
    db.write(
        "INSERT OR REPLACE INTO meals(day, name, prep_min, cook_min, url, recipe) VALUES (?,?,?,?,?,?)",
        (day, meal.name.strip(), meal.prep_min, meal.cook_min, meal.url, meal.recipe),
    )
    return {"ok": True}


@app.delete("/api/meals/{day}")
def clear_meal(day: str):
    _check_day(day)
    db.write("DELETE FROM meals WHERE day = ?", (day,))
    return {"ok": True}


# ---------- recipe photos ----------
@app.post("/api/recipe-photos")
def upload_recipe_photo(file: UploadFile = File(...)):
    """One photo per request (the page uploads them one at a time to show progress)."""
    try:
        name = photos.save(file.file.read(photos.MAX_BYTES + 1))
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.rev += 1  # let other screens know the photo list changed
    return {"name": name}


@app.get("/api/recipe-photos")
def list_recipe_photos():
    return photos.list_photos()


@app.get("/recipe-photos/{name}", include_in_schema=False)
def get_recipe_photo(name: str, thumb: bool = False):
    try:
        p = photos.path_for(name, thumb)
    except ValueError:
        raise HTTPException(404)
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


@app.delete("/api/recipe-photos/{name}")
def delete_recipe_photo(name: str):
    try:
        photos.delete(name)
    except ValueError:
        raise HTTPException(404)
    db.rev += 1
    return {"ok": True}


# ---------- settings ----------
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


@app.get("/api/settings")
def get_settings():
    return {r["key"]: r["value"] for r in db.query("SELECT key, value FROM settings")}


@app.put("/api/settings")
def put_settings(values: dict[str, str]):
    for k, v in values.items():
        if k not in db.DEFAULT_SETTINGS:
            raise HTTPException(400, f"unknown setting {k}")
        if k in ("night_start", "night_end") and not TIME_RE.match(v):
            raise HTTPException(400, f"{k} must be HH:MM")
        if k == "night_enabled" and v not in ("0", "1"):
            raise HTTPException(400, "night_enabled must be 0 or 1")
        db.write("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (k, v))
    return get_settings()


# ---------- weather & calendars ----------
@app.get("/api/weather")
async def get_weather():
    try:
        return await weather.get()
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@app.get("/api/events")
async def get_events(days: int = 30, start: str | None = None):
    """Events from `start` (YYYY-MM-DD, default today) for `days` days."""
    first = None
    if start:
        try:
            first = dt.date.fromisoformat(start)
        except ValueError:
            raise HTTPException(400, "start must be YYYY-MM-DD")
    return await calendars.get_events(max(1, min(days, 90)), first)


@app.get("/api/calendars")
def get_calendars():
    return calendars.status()
