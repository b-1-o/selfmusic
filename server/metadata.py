#!/usr/bin/env python3
"""Read audio tags with Mutagen and print one JSON object to stdout."""

import base64
import json
import os
import sys


def first(tags, *keys):
    if not tags:
        return None
    for key in keys:
        value = tags.get(key)
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            value = value[0] if value else None
        if value is None:
            continue
        value = str(value).strip()
        if value:
            return value
    return None


def number(value):
    if not value:
        return None
    try:
        part = str(value).split("/", 1)[0].strip()
        return int(part) if part else None
    except (TypeError, ValueError):
        return None


def cover_data(audio):
    tags = getattr(audio, "tags", None)
    pictures = list(getattr(audio, "pictures", []) or [])

    if tags:
        try:
            pictures.extend(tags.getall("APIC"))
        except Exception:
            pass
        for key in ("covr", "metadata_block_picture"):
            try:
                value = tags.get(key)
                if value is None:
                    continue
                values = value if isinstance(value, (list, tuple)) else [value]
                for item in values:
                    if key == "metadata_block_picture":
                        try:
                            from mutagen.flac import Picture
                            picture = Picture(base64.b64decode(str(item)))
                            pictures.append(picture)
                        except Exception:
                            continue
                    else:
                        pictures.append(item)
            except Exception:
                pass

    for picture in pictures:
        data = getattr(picture, "data", None)
        if data is None and isinstance(picture, bytes):
            data = picture
        if data is None:
            continue
        data = bytes(data)
        if not data or len(data) > 8 * 1024 * 1024:
            continue
        mime = str(getattr(picture, "mime", "") or "").lower()
        fmt = str(getattr(picture, "format", "") or "").lower()
        if "png" in mime or "png" in fmt:
            ext = ".png"
        elif "webp" in mime or "webp" in fmt:
            ext = ".webp"
        else:
            ext = ".jpg"
        return {"base64": base64.b64encode(data).decode("ascii"), "extension": ext}
    return None


def main():
    filename = sys.argv[1]
    try:
        from mutagen import File as MutagenFile
    except Exception:
        print(json.dumps({"error": "mutagen_not_installed"}))
        return

    try:
        audio = MutagenFile(filename, easy=True)
        if audio is None:
            print(json.dumps({"error": "unsupported_audio"}))
            return
        tags = getattr(audio, "tags", None) or {}
        raw_artist = first(tags, "artist", "performer")
        raw_album_artist = first(tags, "albumartist", "album artist", "band")
        raw_album = first(tags, "album")
        raw_title = first(tags, "title")
        raw_date = first(tags, "date", "originaldate", "year")
        year_text = None
        if raw_date:
            import re
            match = re.search(r"\b(18|19|20|21)\d{2}\b", raw_date)
            year_text = int(match.group(0)) if match else number(raw_date)

        info = getattr(audio, "info", None)
        path_ext = os.path.splitext(filename)[1].lower().lstrip(".")
        result = {
            "title": raw_title,
            "artist": raw_artist,
            "album": raw_album,
            "albumArtist": raw_album_artist,
            "year": year_text,
            "genre": first(tags, "genre"),
            "trackNumber": number(first(tags, "tracknumber", "track")),
            "discNumber": number(first(tags, "discnumber", "disc")),
            "duration": float(info.length) if info and getattr(info, "length", None) is not None else None,
            "bitrate": int(info.bitrate) if info and getattr(info, "bitrate", None) else None,
            "sampleRate": int(info.sample_rate) if info and getattr(info, "sample_rate", None) else None,
            "codec": path_ext,
            "cover": cover_data(audio),
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": "metadata_read_failed", "message": str(error)[:200]}))


if __name__ == "__main__":
    main()
