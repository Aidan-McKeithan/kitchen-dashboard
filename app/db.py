"""SQLite storage for lists (to-dos, groceries), meals and settings.

One shared connection guarded by a lock: FastAPI runs our plain `def`
endpoints in a thread pool, and sqlite connections aren't thread-safe.
We only write when a person actually changes something (SD-card friendly).
"""
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "dashboard.db"

_lock = threading.Lock()
_con: sqlite3.Connection | None = None

# "Revision" number: bumped on every write. Screens/phones poll it cheaply
# and only re-download data when it changes. Starts at the boot time so a
# server restart also looks like a change.
rev = int(time.time())

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY,
    list       TEXT NOT NULL,
    text       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    done_at    TEXT
);
CREATE INDEX IF NOT EXISTS items_list ON items(list);

CREATE TABLE IF NOT EXISTS meals (
    day      TEXT PRIMARY KEY,          -- YYYY-MM-DD
    name     TEXT NOT NULL,
    prep_min INTEGER,
    cook_min INTEGER,
    url      TEXT,
    recipe   TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_SETTINGS = {
    "night_enabled": "1",
    "night_start": "23:00",
    "night_end": "06:00",
}


def init() -> None:
    global _con
    DB_PATH.parent.mkdir(exist_ok=True)
    _con = sqlite3.connect(DB_PATH, check_same_thread=False)
    _con.row_factory = sqlite3.Row
    with _lock:
        _con.executescript(SCHEMA)
        for k, v in DEFAULT_SETTINGS.items():
            _con.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))
        # Housekeeping once per start: forget items completed over a week ago.
        _con.execute("DELETE FROM items WHERE done = 1 AND done_at < datetime('now','localtime','-7 days')")
        _con.commit()


def query(sql: str, args: tuple = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in _con.execute(sql, args).fetchall()]


def write(sql: str, args: tuple = ()) -> sqlite3.Cursor:
    global rev
    with _lock:
        cur = _con.execute(sql, args)
        _con.commit()
        rev += 1
        return cur
