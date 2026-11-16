"""Recipe box + grocery-list builder.

Recipes live in recipes/recipes.json (inside the git repo, so they're backed
up to GitHub). The file is small, so we keep it in memory and rewrite it
whenever someone edits a recipe.

Each ingredient is stored as {qty, unit, item, note, optional}, e.g.
  "1 1/2 cups chicken broth, warm"  ->  qty "1 1/2", unit "cup", item "chicken broth", note "warm"
which lets us add up the same ingredient across a week of meals.
"""
import json
import re
import threading
from fractions import Fraction
from pathlib import Path

FILE = Path(__file__).resolve().parent.parent / "recipes" / "recipes.json"
SECTIONS = ["Dinner", "Side", "Soup", "Dip", "Topping", "Breakfast", "Bread", "Dessert"]

_lock = threading.Lock()
_data: dict = {"pantry": [], "recipes": []}


# ---------- file storage ----------
def load() -> None:
    global _data
    if FILE.exists():
        _data = json.loads(FILE.read_text())
    _data.setdefault("pantry", [])
    _data.setdefault("recipes", [])


def _save() -> None:
    FILE.parent.mkdir(exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_data, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(FILE)  # atomic: a power cut can't leave a half-written file


def all_data() -> dict:
    return _data


def get(rid: str) -> dict | None:
    return next((r for r in _data["recipes"] if r["id"] == rid), None)


def _slug(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "recipe"
    s, n = base, 2
    while get(s):
        s, n = f"{base}-{n}", n + 1
    return s


def upsert(rid: str | None, fields: dict) -> dict:
    with _lock:
        r = get(rid) if rid else None
        if r is None:
            r = {"id": _slug(fields["title"]), "pairs_with": [], "photo": None, "check": []}
            _data["recipes"].append(r)
        r.update(fields)
        _save()
        return r


def delete(rid: str) -> None:
    with _lock:
        _data["recipes"] = [r for r in _data["recipes"] if r["id"] != rid]
        for r in _data["recipes"]:
            r["pairs_with"] = [p for p in r.get("pairs_with", []) if p != rid]
        _save()


def clear_check(rid: str) -> None:
    with _lock:
        r = get(rid)
        if r:
            r["check"] = []
            _save()


def set_pantry(items: list[str]) -> None:
    with _lock:
        _data["pantry"] = sorted({i.strip().lower() for i in items if i.strip()})
        _save()


# ---------- ingredient text <-> structure ----------
UNITS = {
    "tsp": ["tsp", "teaspoon", "teaspoons", "t"],
    "tbsp": ["tbsp", "tbs", "tablespoon", "tablespoons", "tbsps"],
    "cup": ["cup", "cups", "c"],
    "lb": ["lb", "lbs", "pound", "pounds"],
    "oz": ["oz", "ounce", "ounces"],
    "g": ["g", "gram", "grams"],
    "clove": ["clove", "cloves"],
    "can": ["can", "cans"],
    "packet": ["packet", "packets", "pkt", "package", "packages"],
    "pinch": ["pinch", "pinches"],
    "handful": ["handful", "handfuls"],
    "slice": ["slice", "slices"],
    "sprig": ["sprig", "sprigs"],
    "piece": ["piece", "pieces"],
    "block": ["block", "blocks"],
    "bunch": ["bunch", "bunches"],
}
_UNIT_LOOKUP = {alias: u for u, aliases in UNITS.items() for alias in aliases}
_UNICODE_FRAC = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8"}
_QTY_RE = re.compile(r"^(\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*")


def parse_line(line: str) -> dict | None:
    """'1 1/2 cups chicken broth, warm (optional)' -> structured ingredient."""
    s = line.strip().lstrip("-•*").strip()
    if not s:
        return None
    for k, v in _UNICODE_FRAC.items():
        s = re.sub(rf"(\d){k}", rf"\1 {v}", s).replace(k, v)
    optional = bool(re.search(r"\(optional\)|^optional\b", s, re.I))
    s = re.sub(r"\s*\(optional\)\s*|^optional\s+", " ", s, flags=re.I).strip()
    qty, unit = "", ""
    m = _QTY_RE.match(s)
    if m:
        qty = re.sub(r"\s*-\s*", "-", m.group(1))
        s = s[m.end():]
        word = re.match(r"([A-Za-z]+)\.?\s+", s)
        if word and word.group(1).lower() in _UNIT_LOOKUP and not (word.group(1) in ("t", "c") and len(s) < 3):
            unit = _UNIT_LOOKUP[word.group(1).lower()]
            s = s[word.end():]
    item, _, note = s.partition(",")
    return {"qty": qty, "unit": unit, "item": item.strip(), "note": note.strip(), "optional": optional}


def format_line(ing: dict) -> str:
    parts = [p for p in (ing.get("qty"), ing.get("unit"), ing.get("item")) if p]
    text = " ".join(parts)
    if ing.get("note"):
        text += ", " + ing["note"]
    if ing.get("optional"):
        text += " (optional)"
    return text


def qty_value(q: str) -> Fraction | None:
    """'1 1/2' -> 3/2, '4-5' -> 5 (buy enough for the high end), '' -> None."""
    if not q:
        return None
    q = q.split("-")[-1].strip()
    try:
        return sum((Fraction(p) for p in q.split()), Fraction(0))
    except (ValueError, ZeroDivisionError):
        return None


def format_qty(v: Fraction) -> str:
    whole = int(v)
    rest = v - whole
    nice = min((Fraction(0), Fraction(1, 4), Fraction(1, 3), Fraction(1, 2), Fraction(2, 3), Fraction(3, 4), Fraction(1)),
               key=lambda f: abs(f - rest))
    if nice == 1:
        whole, nice = whole + 1, Fraction(0)
    if nice == 0:
        return str(whole)
    return f"{whole} {nice}" if whole else str(nice)


PLURAL_UNITS = {"cup", "can", "clove", "packet", "slice", "sprig", "piece", "block", "bunch", "lb", "handful"}


def _norm_item(item: str) -> str:
    """Key for combining: lowercase, single spaces, simple singular of the last word."""
    s = re.sub(r"\s+", " ", item.lower()).strip()
    words = s.split(" ")
    w = words[-1]
    if w.endswith("oes"):
        w = w[:-2]
    elif w.endswith("ies") and len(w) > 4:
        w = w[:-3] + "y"
    elif w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        w = w[:-1]
    words[-1] = w
    return " ".join(words)


NEVER_BUY = {"water", "warm water", "filtered water", "ice", "pan sauce"}


def grocery_preview(meals: list[dict], on_list: set[str]) -> list[dict]:
    """Combine ingredients of every planned recipe (main + sides) into a shopping list."""
    pantry = {_norm_item(p) for p in _data["pantry"]}
    groups: dict[str, dict] = {}
    for meal in meals:
        ids = ([meal["recipe_id"]] if meal.get("recipe_id") else []) + json.loads(meal.get("sides") or "[]")
        for rid in ids:
            r = get(rid)
            if not r:
                continue
            for ing in r["ingredients"]:
                key = _norm_item(ing["item"])
                if not key or key in NEVER_BUY or ing.get("buy") is False:
                    continue
                g = groups.setdefault(key, {
                    "key": key, "item": ing["item"][:1].upper() + ing["item"][1:],
                    "amounts": {}, "unquantified": False, "for": [], "optional": True,
                    "pantry": key in pantry,
                })
                v = qty_value(ing.get("qty", ""))
                if v is not None:
                    unit = ing.get("unit", "")
                    g["amounts"][unit] = g["amounts"].get(unit, Fraction(0)) + v
                else:
                    g["unquantified"] = True  # some recipe didn't say how much
                if r["title"] not in g["for"]:
                    g["for"].append(r["title"])
                g["optional"] = g["optional"] and bool(ing.get("optional"))
    out = []
    for g in groups.values():
        parts = []
        for unit, v in g["amounts"].items():
            u = unit + ("s" if unit in PLURAL_UNITS and v > 1 else "")
            parts.append(f"{format_qty(v)} {u}".strip())
        amount = " + ".join(parts)
        if amount and g["unquantified"]:
            amount += " + more"
        out.append({
            "key": g["key"],
            "text": g["item"] + (f" – {amount}" if amount else ""),
            "for": g["for"],
            "pantry": g["pantry"],
            "optional": g["optional"],
            "on_list": any(t.startswith(g["key"]) or t.startswith(g["item"].lower()) for t in on_list),
        })
    out.sort(key=lambda x: (x["pantry"], x["key"]))
    return out
