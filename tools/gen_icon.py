"""Generate placeholder app icons (PNG + PNG-wrapped ICO) for JamMarkdown.

Pure stdlib (zlib + struct) so it runs anywhere with Python 3. The icon is a
simple "document" glyph on an accent rounded square - a placeholder you can
later replace with a real icon in src-tauri/icons/.
"""

import os
import struct
import zlib

SIZE = 512
ACCENT = (47, 111, 237, 255)       # #2f6fed
PAGE = (255, 255, 255, 255)
LINE = (150, 156, 168, 255)
TRANSPARENT = (0, 0, 0, 0)


def set_px(buf, size, x, y, rgba):
    if 0 <= x < size and 0 <= y < size:
        i = (y * size + x) * 4
        buf[i], buf[i + 1], buf[i + 2], buf[i + 3] = rgba


def fill_rect(buf, size, x0, y0, x1, y1, rgba):
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            set_px(buf, size, x, y, rgba)


def draw_rrect(buf, size, x0, y0, x1, y1, r, rgba):
    fill_rect(buf, size, x0, y0, x1, y1, rgba)
    corners = [
        (x0 + r, y0 + r, -1, -1),
        (x1 - r, y0 + r, 1, -1),
        (x0 + r, y1 - r, -1, 1),
        (x1 - r, y1 - r, 1, 1),
    ]
    for cx, cy, sx, sy in corners:
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                dx, dy = (x - cx) * sx, (y - cy) * sy
                if dx >= 0 and dy >= 0 and dx * dx + dy * dy > r * r:
                    set_px(buf, size, x, y, TRANSPARENT)


def make_icon(size):
    buf = bytearray(size * size * 4)
    m = int(size * 0.06)
    draw_rrect(buf, size, m, m, size - m, size - m, int(size * 0.22), ACCENT)
    pm = int(size * 0.26)
    draw_rrect(buf, size, pm, pm, size - pm, size - pm, int(size * 0.06), PAGE)
    lx0, lx1 = int(size * 0.36), int(size * 0.64)
    for y in (int(size * 0.42), int(size * 0.52), int(size * 0.62)):
        fill_rect(buf, size, lx0, y, lx1, y + int(size * 0.04), LINE)
    return buf


def build_png(size, buf):
    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw.extend(buf[y * size * 4 : (y + 1) * size * 4])
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def write_png(path, size, buf):
    with open(path, "wb") as f:
        f.write(build_png(size, buf))
    return build_png(size, buf)


def write_ico(path, png_bytes):
    icon_dir = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack(
        "<BBBBHHII",
        0,   # width  (0 means 256)
        0,   # height (0 means 256)
        0,   # colors
        0,   # reserved
        1,   # color planes
        32,  # bits per pixel
        len(png_bytes),
        6 + 16,  # offset to image data
    )
    with open(path, "wb") as f:
        f.write(icon_dir)
        f.write(entry)
        f.write(png_bytes)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    icons = os.path.join(os.path.dirname(here), "src-tauri", "icons")
    os.makedirs(icons, exist_ok=True)

    write_png(os.path.join(icons, "icon.png"), 512, make_icon(512))
    # Build the 256px PNG in memory and wrap it directly into the ICO
    # (avoids writing a temporary file to disk).
    png256 = build_png(256, make_icon(256))
    write_ico(os.path.join(icons, "icon.ico"), png256)

    print("icons written to", icons)


if __name__ == "__main__":
    main()
