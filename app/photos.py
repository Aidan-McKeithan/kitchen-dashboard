"""Recipe photo uploads (pages of Kaitlyn's recipe book).

Files live in data/recipe-photos/ (gitignored, like the database):
  <id>.jpg        the full photo (HEIC/PNG/WebP converted to JPEG, rotated upright)
  thumbs/<id>.jpg a small preview for the app's photo grid
Photos are later read and turned into structured recipes.
"""
import io
import re
import secrets
import time
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()  # teaches Pillow to open iPhone HEIC photos

DIR = Path(__file__).resolve().parent.parent / "data" / "recipe-photos"
THUMBS = DIR / "thumbs"
MAX_BYTES = 25 * 1024 * 1024
MAX_SIDE = 4000          # shrink giant photos a bit; still plenty to read small print
NAME_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}\.jpg$")


def _ensure_dirs() -> None:
    THUMBS.mkdir(parents=True, exist_ok=True)


def save(data: bytes) -> str:
    """Validate, normalize to JPEG, write photo + thumbnail. Returns the file name."""
    if len(data) > MAX_BYTES:
        raise ValueError("photo is larger than 25 MB")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)  # phone photos store rotation separately; bake it in
        img = img.convert("RGB")
    except Exception:
        raise ValueError("that file isn't a photo I can read")
    _ensure_dirs()
    name = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3) + ".jpg"
    full = img.copy()
    full.thumbnail((MAX_SIDE, MAX_SIDE))
    full.save(DIR / name, "JPEG", quality=90)
    thumb = img.copy()
    thumb.thumbnail((400, 400))
    thumb.save(THUMBS / name, "JPEG", quality=75)
    return name


def list_photos() -> list[dict]:
    _ensure_dirs()
    return [
        {"name": p.name, "size": p.stat().st_size}
        for p in sorted(DIR.glob("*.jpg"))
    ]


def path_for(name: str, thumb: bool = False) -> Path:
    if not NAME_RE.match(name):
        raise ValueError("bad photo name")
    return (THUMBS if thumb else DIR) / name


def delete(name: str) -> None:
    for p in (path_for(name), path_for(name, thumb=True)):
        p.unlink(missing_ok=True)
