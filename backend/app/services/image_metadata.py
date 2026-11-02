"""Privacy-preserving extraction of permitted photo metadata fields."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from collections.abc import Mapping

from PIL import Image, UnidentifiedImageError


GPS_IFD_TAG = 34853
CAPTURED_AT_TAGS = (36867, 36868, 306)  # DateTimeOriginal, DateTimeDigitized, DateTime


def _decimal_degrees(values, reference: str) -> float | None:
    try:
        degrees, minutes, seconds = (float(value) for value in values)
        coordinate = degrees + minutes / 60 + seconds / 3600
        if reference.upper() in {"S", "W"}:
            coordinate *= -1
        return round(coordinate, 7)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _capture_time(exif) -> str | None:
    for tag in CAPTURED_AT_TAGS:
        value = exif.get(tag)
        if not value:
            continue
        try:
            return datetime.strptime(str(value), "%Y:%m:%d %H:%M:%S").isoformat()
        except ValueError:
            continue
    return None


def extract_permitted_metadata(content: bytes) -> dict | None:
    """Return only GPS, optional accuracy, and capture time; ignore all other EXIF."""
    if not content:
        return None
    try:
        with Image.open(BytesIO(content)) as image:
            exif = image.getexif()
            if not exif:
                return None
            try:
                gps = exif.get_ifd(GPS_IFD_TAG)
            except (AttributeError, KeyError, TypeError, ValueError):
                gps = exif.get(GPS_IFD_TAG) or {}
            if not isinstance(gps, Mapping):
                return None
            latitude = _decimal_degrees(gps.get(2), str(gps.get(1, ""))) if gps else None
            longitude = _decimal_degrees(gps.get(4), str(gps.get(3, ""))) if gps else None
            if latitude is None or longitude is None or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                return None
            accuracy = gps.get(31) if gps else None
            try:
                accuracy = round(float(accuracy), 1) if accuracy is not None else None
            except (TypeError, ValueError, ZeroDivisionError):
                accuracy = None
            return {
                "latitude": latitude,
                "longitude": longitude,
                "accuracy_meters": accuracy,
                "captured_at": _capture_time(exif),
                "source": "photo_exif",
            }
    except (UnidentifiedImageError, OSError, ValueError, TypeError, AttributeError):
        return None
