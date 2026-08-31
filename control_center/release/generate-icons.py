#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import struct
from pathlib import Path
import zlib


MASTER_SIZE = 1024
PNG_SIZES = (16, 32, 64, 128, 256, 512, 1024)


def _color(value: str) -> tuple[int, int, int, int]:
    if len(value) != 7 or not value.startswith("#"):
        raise ValueError(f"Unsupported icon color: {value}")
    return tuple(int(value[index:index + 2], 16) for index in (1, 3, 5)) + (255,)


def _inside_rounded_rect(x: float, y: float, rect: dict[str, float]) -> bool:
    left, top = rect["x"], rect["y"]
    right, bottom = left + rect["width"], top + rect["height"]
    if x < left or x >= right or y < top or y >= bottom:
        return False
    radius = min(rect["rx"], rect["width"] / 2, rect["height"] / 2)
    if radius <= 0 or left + radius <= x < right - radius or top + radius <= y < bottom - radius:
        return True
    center_x = left + radius if x < left + radius else right - radius
    center_y = top + radius if y < top + radius else bottom - radius
    return (x - center_x) ** 2 + (y - center_y) ** 2 <= radius ** 2


def _read_rectangles(source: Path) -> list[tuple[dict[str, float], tuple[int, int, int, int]]]:
    document = source.read_text(encoding="utf-8")
    if re.search(r'\bviewBox="0 0 1024 1024"', document) is None:
        raise ValueError("The icon must use the canonical 1024-square viewBox")
    rectangles = []
    for match in re.finditer(r"<rect\s+([^>]+)/>", document):
        attributes = dict(re.findall(r'([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"', match.group(1)))
        values = {
            key: float(attributes.get(key, "0"))
            for key in ("x", "y", "width", "height", "rx")
        }
        rectangles.append((values, _color(attributes["fill"])))
    if not rectangles:
        raise ValueError("The icon has no drawable rectangles")
    return rectangles


def _render_master(source: Path) -> bytes:
    rectangles = _read_rectangles(source)
    pixels = bytearray(MASTER_SIZE * MASTER_SIZE * 4)
    for rectangle, color in rectangles:
        left = max(0, int(rectangle["x"]))
        top = max(0, int(rectangle["y"]))
        right = min(MASTER_SIZE, int(rectangle["x"] + rectangle["width"] + 1))
        bottom = min(MASTER_SIZE, int(rectangle["y"] + rectangle["height"] + 1))
        for y in range(top, bottom):
            for x in range(left, right):
                if _inside_rounded_rect(x + 0.5, y + 0.5, rectangle):
                    offset = (y * MASTER_SIZE + x) * 4
                    pixels[offset:offset + 4] = bytes(color)
    return bytes(pixels)


def _downsample(master: bytes, size: int) -> bytes:
    scale = MASTER_SIZE // size
    if scale * size != MASTER_SIZE:
        raise ValueError(f"Icon size must divide {MASTER_SIZE}: {size}")
    result = bytearray(size * size * 4)
    samples = scale * scale
    for target_y in range(size):
        for target_x in range(size):
            totals = [0, 0, 0, 0]
            for source_y in range(target_y * scale, (target_y + 1) * scale):
                offset = (source_y * MASTER_SIZE + target_x * scale) * 4
                for _source_x in range(scale):
                    for channel in range(4):
                        totals[channel] += master[offset + channel]
                    offset += 4
            target = (target_y * size + target_x) * 4
            result[target:target + 4] = bytes(round(total / samples) for total in totals)
    return bytes(result)


def _png(size: int, rgba: bytes) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    rows = b"".join(b"\x00" + rgba[row * size * 4:(row + 1) * size * 4] for row in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def _ico(images: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + len(images) * 16
    entries = []
    payloads = []
    for size, payload in images:
        dimension = 0 if size == 256 else size
        entries.append(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(payload), offset))
        payloads.append(payload)
        offset += len(payload)
    return header + b"".join(entries) + b"".join(payloads)


def generate(source: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    master = _render_master(source)
    images = []
    for size in PNG_SIZES:
        payload = _png(size, _downsample(master, size))
        (output / f"icon-{size}.png").write_bytes(payload)
        if size <= 256:
            images.append((size, payload))
    (output / "anote-control-center.ico").write_bytes(_ico(images))


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic Anote native icons")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    generate(options.source.resolve(strict=True), options.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
