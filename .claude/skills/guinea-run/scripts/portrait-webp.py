"""
The guinea pig pictures of the cards and the footer, from the transparent
portrait render of scripts/blender/guinea-pig.py (GUINEA_PORTRAIT=1):

    python portrait-webp.py portrait.png site-theme/images/guinea-pig.webp site-theme/images/guinea-pig-small.webp

Crops to the guinea pig, then writes a 360 px wide picture (shown at about
130 px on the cards) and an 84 px one (the footer button). Needs Pillow.
"""
import sys

from PIL import Image

source, big, small = sys.argv[1:4]
image = Image.open(source).convert("RGBA")
image = image.crop(image.getbbox())
for path, width in ((big, 360), (small, 84)):
    height = round(image.size[1] * width / image.size[0])
    image.resize((width, height), Image.LANCZOS).save(path, "WEBP", quality=88, method=6)
    print(path, width, "x", height)
