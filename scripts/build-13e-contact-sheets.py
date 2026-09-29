"""Assemble 13E FFmpeg title frames into three visual QA sheets.

First run the Rust visual_render title test with CHETO_13E_TITLE_FRAMES
pointing at a temporary folder, then pass that folder to this script.
"""

from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont

FAMILIES = [
    "editorial-master", "future-glow", "content-create", "neon-statement",
    "kinetic-pop", "letter-cascade-pro", "dynamic-slide", "typewriter-tech",
    "word-highlight", "split-impact", "stacked-reveal-pro", "underline-editorial",
    "lower-third-premium", "stat-hero", "tutorial-step", "quote-editorial",
    "gaming-impact", "corporate-clean",
]
RATIOS = {"16x9": (320, 180), "9x16": (180, 320), "1x1": (240, 240)}


def build_sheet(frames: Path, destination: Path, ratio: str, size: tuple[int, int]) -> None:
    columns = 3 if ratio == "9x16" else 4
    rows = (len(FAMILIES) + columns - 1) // columns
    frame_width, frame_height = size
    gap, label_height, heading_height = 14, 28, 54
    sheet = Image.new("RGB", (columns * (frame_width + gap) + gap, rows * (frame_height + label_height + gap) + heading_height + gap), "#0a111b")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((gap, 18), f"CHETO TEMPLATE ENGINE · 13E · {ratio.replace('x', ':')} · 18 familias", fill="#e5f9ff", font=font)
    for index, family in enumerate(FAMILIES):
        path = frames / ratio / f"{family}.png"
        if not path.is_file():
            raise FileNotFoundError(path)
        x = gap + index % columns * (frame_width + gap)
        y = heading_height + gap + index // columns * (frame_height + label_height + gap)
        with Image.open(path) as source:
            preview = source.convert("RGB")
            preview.thumbnail(size, Image.Resampling.LANCZOS)
            sheet.paste(preview, (x + (frame_width - preview.width) // 2, y + (frame_height - preview.height) // 2))
        draw.text((x, y + frame_height + 5), f"{index + 1:02d}  {family}", fill="#c6d3dd", font=font)
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination, quality=90, subsampling=0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("frames", type=Path)
    parser.add_argument("--output", type=Path, default=Path("docs"))
    args = parser.parse_args()
    for ratio, size in RATIOS.items():
        build_sheet(args.frames, args.output / f"13e-template-gallery-{ratio}.jpg", ratio, size)


if __name__ == "__main__":
    main()
