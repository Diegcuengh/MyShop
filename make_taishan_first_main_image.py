# -*- coding: utf-8 -*-
"""Generate the first PDD main image draft for Taishan Shigandang."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(r"E:\proj\MyShop\output\taishan_shigandang_listing")
SOURCE = ROOT / "source_images" / "505562248188_sku_09_d72d7aff5bbe5915.jpg"
LOGO_PATH = Path(r"C:\Users\Alex\Desktop\泰山艺品.png")
OUT = ROOT / "main_image_01_final_draft.jpg"

FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_BLACK = r"C:\Windows\Fonts\simhei.ttf"

RED = "#c40000"
INK = "#171412"
STONE = "#5d5750"
GOLD = "#b8862c"
CREAM = "#f6efe6"


def font(size: int, bold: bool = False, black: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BLACK if black else FONT_BOLD if bold else FONT_REGULAR, size)


def background(size: tuple[int, int] = (800, 800)) -> Image.Image:
    image = Image.new("RGB", size, CREAM)
    draw = ImageDraw.Draw(image)
    width, height = size
    for y in range(0, height, 13):
        shade = 224 + (y * 17) % 18
        draw.line((0, y, width, y + ((y * 23) % 35) - 17), fill=(shade, shade - 6, shade - 15), width=1)
    for x in range(0, width, 41):
        draw.line((x, 0, x + ((x * 11) % 54) - 24, height), fill="#e3d8cb", width=1)
    return image.filter(ImageFilter.GaussianBlur(0.25))


def refine(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    image = ImageEnhance.Color(image).enhance(1.12)
    image = ImageEnhance.Contrast(image).enhance(1.18)
    return ImageEnhance.Sharpness(image).enhance(1.55)


def product_cutout(path: Path) -> Image.Image:
    image = refine(Image.open(path))
    crop = image.crop((118, 92, 372, 735)).convert("RGBA")
    gray = ImageOps.grayscale(crop.convert("RGB"))
    mask = gray.point(lambda p: 255 if p < 210 else 0)
    mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
    crop.putalpha(mask)
    return crop


def paste_logo(canvas: Image.Image, box: tuple[int, int, int, int]) -> None:
    if not LOGO_PATH.exists():
        return
    logo = Image.open(LOGO_PATH).convert("RGBA")
    max_w = box[2] - box[0]
    max_h = box[3] - box[1]
    scale = min(max_w / logo.width, max_h / logo.height)
    logo = logo.resize((max(1, int(logo.width * scale)), max(1, int(logo.height * scale))), Image.Resampling.LANCZOS)
    canvas.paste(logo, (box[0], box[1]), logo)


def draw_center(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, text_font: ImageFont.FreeTypeFont, fill: str) -> None:
    bbox = draw.textbbox((0, 0), text, font=text_font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = box[0] + (box[2] - box[0] - text_w) // 2
    y = box[1] + (box[3] - box[1] - text_h) // 2
    draw.text((x, y), text, font=text_font, fill=fill)


def main() -> None:
    image = background()
    draw = ImageDraw.Draw(image)

    # Logo-inspired brush arc, placed behind the product.
    draw.arc((220, 48, 805, 720), start=205, end=18, fill=RED, width=16)
    draw.arc((246, 74, 784, 690), start=205, end=12, fill="#d43732", width=4)
    draw.ellipse((410, 148, 770, 666), fill="#f1ded4")
    image = image.filter(ImageFilter.GaussianBlur(0.15))
    draw = ImageDraw.Draw(image)

    # Short, search-card readable copy.
    draw.text((48, 64), "泰山石敢当", font=font(62, bold=True), fill=RED)
    draw.text((52, 142), "泰安石刻｜门口墙角可摆", font=font(30, bold=True), fill=INK)
    draw.line((52, 190, 365, 190), fill=GOLD, width=5)

    # Single large hero product. No size marks, price, SKU table, or source-store text.
    product = product_cutout(SOURCE).resize((330, 640), Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", product.size, (0, 0, 0, 0))
    shadow.putalpha(product.getchannel("A").filter(ImageFilter.GaussianBlur(10)).point(lambda p: int(p * 0.32)))
    image.paste(shadow, (405, 130), shadow)
    image.paste(product, (385, 96), product)

    # Brand seal kept small, without taking search-card space from the product.
    paste_logo(image, (650, 36, 748, 112))

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((54, 590, 286, 650), radius=8, fill=INK)
    draw_center(draw, (54, 590, 286, 650), "朱砂红字主推", font(28, bold=True), "#fff7e8")
    draw.rounded_rectangle((54, 666, 286, 726), radius=8, fill=RED)
    draw_center(draw, (54, 666, 286, 726), "实拍同款可定制", font(27, bold=True), "#fff7e8")

    draw.text((50, 752), "天然石材纹理略有差异，以实物为准", font=font(18), fill=STONE)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, quality=95)
    print(OUT)


if __name__ == "__main__":
    main()
