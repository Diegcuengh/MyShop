# -*- coding: utf-8 -*-
"""Create one contact sheet with eight PDD main-image draft directions."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(r"E:\proj\MyShop\output\taishan_shigandang_listing")
SRC = ROOT / "source_images"
OUT = ROOT / "main_image_8_draft_board.jpg"
LOGO_PATH = Path(r"C:\Users\Alex\Desktop\泰山艺品.png")

FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_BLACK = r"C:\Windows\Fonts\simhei.ttf"

RED = "#c40000"
INK = "#171412"
STONE = "#5d5750"
GOLD = "#b8862c"


def font(size: int, bold: bool = False, black: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BLACK if black else FONT_BOLD if bold else FONT_REGULAR, size)


def contain(img: Image.Image, size: tuple[int, int], bg: str = "#f8f1e7") -> Image.Image:
    img = img.convert("RGB")
    sw, sh = img.size
    dw, dh = size
    scale = min(dw / sw, dh / sh)
    resized = img.resize((max(1, int(sw * scale)), max(1, int(sh * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, bg)
    canvas.paste(resized, ((dw - resized.width) // 2, (dh - resized.height) // 2))
    return canvas


def product_only(path: Path) -> Image.Image:
    img = refine(Image.open(path))
    w, h = img.size
    # Most SKU source images put the actual stone plate in the left-center area
    # with size annotations above/left and option text on the right. This crop
    # keeps the product and removes the obvious dimension labels.
    if w >= 700 and h >= 700:
        return img.crop((118, 92, 372, 735))
    return img


def product_card_image(path: Path, size: tuple[int, int], bg: str = "#f8f1e7") -> Image.Image:
    return contain(product_only(path), size, bg)


def refine(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    img = ImageEnhance.Color(img).enhance(1.08)
    img = ImageEnhance.Contrast(img).enhance(1.12)
    return ImageEnhance.Sharpness(img).enhance(1.45)


def stone_bg(size: tuple[int, int], base: str = "#f5eee5") -> Image.Image:
    img = Image.new("RGB", size, base)
    draw = ImageDraw.Draw(img)
    w, h = size
    for y in range(0, h, 10):
        shade = 222 + (y * 17) % 20
        draw.line((0, y, w, y + ((y * 19) % 36) - 18), fill=(shade, shade - 7, shade - 15), width=1)
    for x in range(0, w, 31):
        draw.line((x, 0, x + ((x * 13) % 48) - 22, h), fill="#e1d5c6", width=1)
    return img.filter(ImageFilter.GaussianBlur(0.35))


def text_center(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, fnt: ImageFont.FreeTypeFont, fill: str) -> None:
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = box[0] + (box[2] - box[0] - tw) // 2
    y = box[1] + (box[3] - box[1] - th) // 2
    draw.text((x, y), text, font=fnt, fill=fill)


def paste_logo(canvas: Image.Image, x: int, y: int, w: int, h: int, opacity: float = 1.0) -> None:
    if not LOGO_PATH.exists():
        return
    logo = Image.open(LOGO_PATH).convert("RGBA")
    sw, sh = logo.size
    scale = min(w / sw, h / sh)
    logo = logo.resize((max(1, int(sw * scale)), max(1, int(sh * scale))), Image.Resampling.LANCZOS)
    if opacity < 1:
        alpha = logo.getchannel("A").point(lambda value: int(value * opacity))
        logo.putalpha(alpha)
    canvas.paste(logo, (x, y), logo)


def first_image(pattern: str) -> Path:
    hits = sorted(SRC.glob(pattern))
    if not hits:
        hits = sorted(SRC.glob("*.jpg"))
    return hits[0]


def product_strip(card: Image.Image, paths: list[Path], y: int, mode: str = "single") -> None:
    if mode == "scene":
        scene = refine(Image.open(paths[0]))
        scene = scene.crop((280, 90, 650, 650)) if scene.width >= 700 else scene
        scene = contain(scene, (330, 290), "#f8f1e7")
        card.paste(scene, (44, y + 4))
        product = product_card_image(paths[1], (142, 238), "#f8f1e7")
        card.paste(product, (44, y + 52))
        return
    if mode == "custom":
        product = product_card_image(paths[0], (246, 300), "#f8f1e7")
        card.paste(product, (34, y))
        draw = ImageDraw.Draw(card)
        draw.rounded_rectangle((255, y + 70, 382, y + 128), radius=5, fill=RED)
        text_center(draw, (255, y + 70, 382, y + 128), "刻字", font(24, bold=True), "#fff7e8")
        draw.rounded_rectangle((255, y + 150, 382, y + 208), radius=5, fill=INK)
        text_center(draw, (255, y + 150, 382, y + 208), "图案", font(24, bold=True), "#fff7e8")
        return
    if mode == "pack":
        product = product_card_image(paths[1], (178, 272), "#f8f1e7")
        pack = contain(refine(Image.open(paths[0])), (178, 180), "#f8f1e7")
        card.paste(product, (42, y + 12))
        card.paste(pack, (206, y + 76))
        return
    product = product_card_image(paths[0], (308, 310), "#f8f1e7")
    card.paste(product, (56, y))


def card(caption: str, title: str, sub: str, paths: list[Path], mode: str = "single") -> Image.Image:
    card_w, card_h = 408, 548
    img = stone_bg((card_w, card_h))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, card_w, 54), fill=INK)
    draw.text((18, 15), "泰山艺品", font=font(22, bold=True), fill="#fff2df")
    paste_logo(img, card_w - 92, 6, 72, 42, 0.95)
    draw.text((24, 78), title, font=font(40, bold=True), fill=RED)
    draw.text((26, 130), sub, font=font(24, bold=True), fill=INK)
    draw.line((24, 168, card_w - 24, 168), fill=GOLD, width=4)
    product_strip(img, paths, 190, mode)
    draw.rounded_rectangle((24, 478, card_w - 24, 528), radius=5, fill=RED)
    text_center(draw, (24, 478, card_w - 24, 528), "泰安石刻 · 实拍同款", font(23, bold=True), "#fff7e8")
    return img


def main() -> None:
    red_img = first_image("505562248188_sku_09*.jpg")
    gold_img = first_image("505562248188_sku_13*.jpg")
    yang_img = first_image("505562248188_sku_02*.jpg")
    scene_img = first_image("505562248188_carousel_03*.jpg")
    custom_img = first_image("505562248188_sku_22*.jpg")
    pack_img = first_image("505562248188_carousel_08*.jpg")

    cards = [
        ("1. 单商品强封面", "泰山石敢当", "门口墙角可摆", [red_img], "single"),
        ("2. 朱砂红字款", "朱砂红字款", "家宅门口常用", [red_img]),
        ("3. 雄黄金字款", "雄黄金字款", "院门店铺适用", [gold_img]),
        ("4. 阳刻八卦款", "阳刻八卦款", "石刻立体感", [yang_img]),
        ("5. 泰安源头封面", "泰安发货", "源头批发同款", [red_img]),
        ("6. 门口场景封面", "门口墙角摆件", "院门店铺可用", [scene_img, red_img], "scene"),
        ("7. 定制封面", "支持定制刻字", "图案内容可沟通", [red_img], "custom"),
        ("8. 保障封面", "石材加固包装", "破损售后处理", [pack_img, red_img], "pack"),
    ]

    card_w, card_h = 420, 570
    margin = 34
    board_w = margin * 2 + card_w * 4
    board_h = 128 + margin * 2 + card_h * 2
    board = Image.new("RGB", (board_w, board_h), "#efe6dc")
    draw = ImageDraw.Draw(board)
    draw.text((44, 28), "泰山艺品｜8张拼多多主图初稿方向", font=font(38, bold=True), fill=INK)
    draw.text((48, 80), "每张都按“可单独成为搜索商品卡”设计：大商品 + 品类识别 + 一个点击理由", font=font(22), fill=STONE)

    for index, args in enumerate(cards):
        col = index % 4
        row = index // 4
        x = margin + col * card_w
        y = 128 + margin + row * card_h
        board.paste(card(*args), (x, y))
        draw.text((x + 10, y + 550), args[0], font=font(18, bold=True), fill=INK)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    board.save(OUT, quality=94)
    print(OUT)


if __name__ == "__main__":
    main()
