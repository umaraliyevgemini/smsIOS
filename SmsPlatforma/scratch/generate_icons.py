import math
import os
import struct
import zlib
from pathlib import Path

def create_png(width, height, draw_fn):
    # RGBA image buffer
    pixels = bytearray(width * height * 4)

    for y in range(height):
        for x in range(width):
            r, g, b, a = draw_fn(x, y, width, height)
            idx = (y * width + x) * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a

    # PNG raw scanlines (filter type 0 per line)
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0) # Filter type 0
        raw_data.extend(pixels[y * width * 4 : (y + 1) * width * 4])

    compressed = zlib.compress(raw_data, 9)

    def chunk(chunk_type, data):
        c_len = struct.pack(">I", len(data))
        c_type = chunk_type.encode('ascii')
        crc = struct.pack(">I", zlib.crc32(c_type + data) & 0xffffffff)
        return c_len + c_type + data + crc

    header = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    ihdr = chunk("IHDR", ihdr_data)
    idat = chunk("IDAT", compressed)
    iend = chunk("IEND", b"")

    return header + ihdr + idat + iend

def draw_square_logo(x, y, w, h):
    # Normalized coordinates 0.0 to 1.0
    nx = x / float(w)
    ny = y / float(h)
    cx, cy = 0.5, 0.5
    dx, dy = nx - cx, ny - cy
    dist = math.sqrt(dx * dx + dy * dy)

    # Background gradient: deep teal navy to emerald green
    r_bg = int(18 + (31 - 18) * ny)
    g_bg = int(45 + (122 - 45) * ny)
    b_bg = int(75 + (92 - 75) * ny)

    # Rounded rectangle mask for app icon
    corner_r = 0.22
    inside_mask = 1.0
    if nx < corner_r and ny < corner_r:
        cdist = math.sqrt((nx - corner_r)**2 + (ny - corner_r)**2)
        if cdist > corner_r: inside_mask = 0.0
    elif nx > (1 - corner_r) and ny < corner_r:
        cdist = math.sqrt((nx - (1 - corner_r))**2 + (ny - corner_r)**2)
        if cdist > corner_r: inside_mask = 0.0
    elif nx < corner_r and ny > (1 - corner_r):
        cdist = math.sqrt((nx - corner_r)**2 + (ny - (1 - corner_r))**2)
        if cdist > corner_r: inside_mask = 0.0
    elif nx > (1 - corner_r) and ny > (1 - corner_r):
        cdist = math.sqrt((nx - (1 - corner_r))**2 + (ny - (1 - corner_r))**2)
        if cdist > corner_r: inside_mask = 0.0

    if inside_mask == 0.0:
        return 0, 0, 0, 0

    # Draw Chat Bubble in white
    # Main bubble circle / oval: center (0.5, 0.46), radius 0.28
    bx, by = nx - 0.5, ny - 0.45
    b_dist = math.sqrt(bx * bx * 1.1 + by * by)

    # Bubble tail (triangle near bottom left of bubble)
    in_tail = False
    if 0.32 <= nx <= 0.46 and 0.62 <= ny <= 0.74:
        slope = (ny - 0.62) / (0.74 - 0.62)
        if nx <= 0.46 - slope * 0.14:
            in_tail = True

    in_bubble = (b_dist <= 0.26) or in_tail

    # Draw Send Arrow inside bubble
    in_arrow = False
    if in_bubble:
        # Arrow shape: arrowhead pointing right-up
        ax, ay = nx - 0.48, ny - 0.44
        if -0.12 <= ax <= 0.12 and -0.10 <= ay <= 0.10:
            if (ax - ay >= -0.06 and ax + ay <= 0.08) or (abs(ay) <= 0.035 and -0.10 <= ax <= 0.05):
                in_arrow = True

    if in_bubble and not in_arrow:
        # White speech bubble
        return 255, 255, 255, 255
    elif in_arrow:
        # Emerald accent arrow
        return 31, 122, 92, 255

    return r_bg, g_bg, b_bg, 255

def draw_round_logo(x, y, w, h):
    nx = x / float(w)
    ny = y / float(h)
    dx, dy = nx - 0.5, ny - 0.5
    dist = math.sqrt(dx * dx + dy * dy)
    if dist > 0.48:
        return 0, 0, 0, 0
    return draw_square_logo(x, y, w, h)

res_dir = Path("android/app/src/main/res")
sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for folder, size in sizes.items():
    target_folder = res_dir / folder
    target_folder.mkdir(parents=True, exist_ok=True)

    sq_data = create_png(size, size, draw_square_logo)
    (target_folder / "ic_launcher.png").write_bytes(sq_data)

    rd_data = create_png(size, size, draw_round_logo)
    (target_folder / "ic_launcher_round.png").write_bytes(rd_data)

print("Icons generated successfully!")
