"""Animated timeline of the release versioning end to end test.

Assembles the DevOps Pipeline captures of each step (<id>-pipeline.png, in step order) into one GIF,
each frame with the caption of its step (captions.tsv: id, caption) in a band above it.

    python rv-timeline.py <shots folder> <output.gif> [--width 1280] [--seconds 3]

Needs Pillow (pip install pillow).
"""

import argparse
import csv
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BAND_HEIGHT = 56
BAND_COLOR = (255, 255, 255)
TEXT_COLOR = (24, 32, 43)
STEP_COLOR = (31, 95, 168)


def load_font(size: int) -> ImageFont.ImageFont:
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf", "Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def read_captions(shots: Path) -> list:
    captions_file = shots / "captions.tsv"
    if not captions_file.exists():
        return [
            (png.name.split("-pipeline")[0], "")
            for png in sorted(shots.glob("*-pipeline.png"))
        ]
    with captions_file.open(encoding="utf-8") as handle:
        rows = [row for row in csv.reader(handle, delimiter="\t") if row]
    # A step replayed keeps its last caption, in the order of its first capture
    order, captions = [], {}
    for row in rows:
        if row[0] not in captions:
            order.append(row[0])
        captions[row[0]] = row[1] if len(row) > 1 else ""
    return [(step, captions[step]) for step in order]


def frame(png: Path, step: str, caption: str, width: int, fonts: tuple) -> Image.Image:
    shot = Image.open(png).convert("RGB")
    height = round(shot.height * width / shot.width)
    shot = shot.resize((width, height), Image.LANCZOS)
    canvas = Image.new("RGB", (width, height + BAND_HEIGHT), BAND_COLOR)
    canvas.paste(shot, (0, BAND_HEIGHT))
    draw = ImageDraw.Draw(canvas)
    step_font, caption_font = fonts
    draw.text((16, 14), step, fill=STEP_COLOR, font=step_font)
    step_width = draw.textlength(step, font=step_font)
    draw.text((32 + step_width, 16), caption, fill=TEXT_COLOR, font=caption_font)
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("shots")
    parser.add_argument("output")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--seconds", type=float, default=3)
    args = parser.parse_args()
    shots = Path(args.shots)
    fonts = (load_font(24), load_font(20))
    frames = []
    for step, caption in read_captions(shots):
        png = shots / f"{step}-pipeline.png"
        if png.exists():
            frames.append(frame(png, step, caption, args.width, fonts))
    if not frames:
        print(f"no <step>-pipeline.png in {shots}")
        return 1
    # One palette for every frame keeps the colors of the chips steady from one step to the next
    palette = frames[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    quantized = [
        image.quantize(palette=palette, dither=Image.Dither.NONE) for image in frames
    ]
    duration = int(args.seconds * 1000)
    durations = [duration] * len(quantized)
    durations[-1] = duration * 2
    quantized[0].save(
        args.output,
        save_all=True,
        append_images=quantized[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    print(f"{args.output}: {len(frames)} steps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
