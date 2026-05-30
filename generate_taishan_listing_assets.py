# -*- coding: utf-8 -*-
"""Generate PDD-ready Taishan Shigandang listing assets.

The script reads the crawled wholesale goods from MongoDB, downloads any missing
source images, creates refined main images, detail-page slices, SKU images, and
a pricing workbook for direct marketplace listing work.
"""

from __future__ import annotations

import csv
import hashlib
import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import requests
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from pymongo import MongoClient


MONGO_URI = "mongodb://127.0.0.1:27017/"
DB_NAME = "pdd_sales_trends"
GOODS_IDS = ("505562248188", "623335664244", "220643440300")
PRIMARY_GOODS_ID = "505562248188"
OUT_DIR = Path(r"E:\proj\MyShop\output\taishan_shigandang_listing")
LOGO_PATH = Path(r"C:\Users\Alex\Desktop\泰山艺品.png")
PLATFORM_FEE_RATE = 0.006
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_BLACK = r"C:\Windows\Fonts\simhei.ttf"

INK = "#25201b"
STONE = "#5d5a52"
WARM = "#f5efe5"
RED = "#c40000"
GOLD = "#b8862c"
CHARCOAL = "#171717"
MUTED = "#766f66"


@dataclass(frozen=True)
class SkuPlan:
    goods_id: str
    source_title: str
    sku_id: str
    sku_name: str
    style: str
    size_label: str
    size_cm: int | None
    role: str
    cost: float
    suggested_price: float
    ad_limit: float
    shipping_pack: float
    loss_reserve: float
    platform_fee: float
    expected_profit: float
    source_url: str
    local_image: Path
    keywords: str


def font(size: int, bold: bool = False, black: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BLACK if black else FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(path, size)


def ensure_dirs() -> dict[str, Path]:
    dirs = {
        "root": OUT_DIR,
        "source": OUT_DIR / "source_images",
        "main": OUT_DIR / "main_images_800",
        "detail": OUT_DIR / "detail_slices_790",
        "sku": OUT_DIR / "sku_images_800",
    }
    for path in dirs.values():
        path.mkdir(parents=True, exist_ok=True)
    return dirs


def clean_generated_dirs(dirs: dict[str, Path]) -> None:
    for key in ("main", "detail", "sku"):
        for path in dirs[key].glob("*"):
            if path.is_file():
                path.unlink()


def fetch_docs() -> dict[str, dict[str, Any]]:
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    docs: dict[str, dict[str, Any]] = {}
    for goods_id in GOODS_IDS:
        doc = db.goods_snapshots.find_one({"goods_id": goods_id}, sort=[("crawl_time", -1)])
        if not doc:
            raise RuntimeError(f"Missing goods snapshot: {goods_id}")
        docs[goods_id] = doc
    return docs


def safe_name(text: str, limit: int = 72) -> str:
    text = re.sub(r"[\\/:*?\"<>|\s]+", "_", text.strip())
    text = re.sub(r"_+", "_", text).strip("_")
    return text[:limit] or "item"


def image_ext_from_url(url: str) -> str:
    lowered = url.lower()
    if ".png" in lowered:
        return ".png"
    if ".webp" in lowered:
        return ".webp"
    return ".jpg"


def download_image(url: str, dest_dir: Path, prefix: str) -> Path:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    path = dest_dir / f"{safe_name(prefix, 36)}_{digest}{image_ext_from_url(url)}"
    if path.exists() and path.stat().st_size > 1024:
        return path
    response = requests.get(url, timeout=25, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    path.write_bytes(response.content)
    return path


def open_image(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def cover_image(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    src_w, src_h = img.size
    dst_w, dst_h = size
    scale = max(dst_w / src_w, dst_h / src_h)
    resized = img.resize((math.ceil(src_w * scale), math.ceil(src_h * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - dst_w) // 2
    top = (resized.height - dst_h) // 2
    return resized.crop((left, top, left + dst_w, top + dst_h))


def contain_image(img: Image.Image, size: tuple[int, int], bg: str = "#f7f2ea") -> Image.Image:
    src_w, src_h = img.size
    dst_w, dst_h = size
    scale = min(dst_w / src_w, dst_h / src_h)
    resized = img.resize((max(1, int(src_w * scale)), max(1, int(src_h * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, bg)
    canvas.paste(resized, ((dst_w - resized.width) // 2, (dst_h - resized.height) // 2))
    return canvas


def transparent_contain(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    src_w, src_h = img.size
    dst_w, dst_h = size
    scale = min(dst_w / src_w, dst_h / src_h)
    resized = img.resize((max(1, int(src_w * scale)), max(1, int(src_h * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (255, 255, 255, 0))
    canvas.alpha_composite(resized.convert("RGBA"), ((dst_w - resized.width) // 2, (dst_h - resized.height) // 2))
    return canvas


def load_logo(max_size: tuple[int, int]) -> Image.Image | None:
    if not LOGO_PATH.exists():
        return None
    logo = Image.open(LOGO_PATH).convert("RGBA")
    return transparent_contain(logo, max_size)


def paste_logo(canvas: Image.Image, xy: tuple[int, int], max_size: tuple[int, int], opacity: float = 1.0) -> None:
    logo = load_logo(max_size)
    if logo is None:
        return
    if opacity < 1:
        alpha = logo.getchannel("A").point(lambda value: int(value * opacity))
        logo.putalpha(alpha)
    canvas.paste(logo, xy, logo)


def refine_product(img: Image.Image) -> Image.Image:
    refined = ImageEnhance.Color(img).enhance(1.08)
    refined = ImageEnhance.Contrast(refined).enhance(1.12)
    refined = ImageEnhance.Sharpness(refined).enhance(1.55)
    return refined


def stone_background(size: tuple[int, int], base: str = "#f2eadf") -> Image.Image:
    img = Image.new("RGB", size, base)
    draw = ImageDraw.Draw(img)
    w, h = size
    for i in range(0, h, 11):
        shade = 224 + (i * 17) % 18
        draw.line([(0, i), (w, i + ((i * 23) % 31) - 15)], fill=(shade, shade - 6, shade - 14), width=1)
    for i in range(0, w, 37):
        draw.line([(i, 0), (i + ((i * 13) % 57) - 20, h)], fill="#e2d7c8", width=1)
    return img.filter(ImageFilter.GaussianBlur(0.35))


def draw_round_rect(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], fill: str, outline: str | None = None, width: int = 1, radius: int = 8) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def draw_centered(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, fnt: ImageFont.FreeTypeFont, fill: str) -> None:
    tw, th = text_size(draw, text, fnt)
    x = box[0] + (box[2] - box[0] - tw) // 2
    y = box[1] + (box[3] - box[1] - th) // 2
    draw.text((x, y), text, font=fnt, fill=fill)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        trial = current + char
        if text_size(draw, trial, fnt)[0] <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    fnt: ImageFont.FreeTypeFont,
    fill: str,
    max_width: int,
    line_gap: int = 8,
    max_lines: int | None = None,
) -> int:
    lines = wrap_text(draw, text, fnt, max_width)
    if max_lines is not None:
        lines = lines[:max_lines]
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += text_size(draw, line, fnt)[1] + line_gap
    return y


def add_badge(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fill: str = RED) -> tuple[int, int]:
    fnt = font(24, bold=True)
    tw, th = text_size(draw, text, fnt)
    x, y = xy
    draw_round_rect(draw, (x, y, x + tw + 28, y + th + 18), fill, radius=6)
    draw.text((x + 14, y + 8), text, font=fnt, fill="#fffaf0")
    return x + tw + 38, y


def collect_source_images(docs: dict[str, dict[str, Any]], source_dir: Path) -> dict[str, list[Path]]:
    images: dict[str, list[Path]] = {}
    for goods_id, doc in docs.items():
        urls: list[tuple[str, str]] = []
        detail = (((doc.get("raw_detail") or {}).get("queryGoodsDetail") or {}).get("result") or {})
        for index, item in enumerate(detail.get("goodsCarouselInfos") or []):
            url = item.get("url")
            if url:
                urls.append((url, f"{goods_id}_carousel_{index + 1:02d}"))
        for index, sku in enumerate(doc.get("skus") or []):
            url = sku.get("thumb_url")
            if url:
                urls.append((url, f"{goods_id}_sku_{index + 1:02d}"))
        paths: list[Path] = []
        seen: set[str] = set()
        for url, prefix in urls:
            if url in seen:
                continue
            seen.add(url)
            try:
                paths.append(download_image(url, source_dir, prefix))
            except Exception as exc:  # noqa: BLE001 - keep generating with partial assets
                print(f"download failed: {url} ({exc})")
        images[goods_id] = paths
    return images


def sku_text(sku: dict[str, Any]) -> str:
    parts = []
    for spec in sku.get("specs") or []:
        value = str(spec.get("value") or "").strip()
        if value:
            parts.append(value)
    return " / ".join(parts)


def parse_size(text: str) -> int | None:
    matches = re.findall(r"(\d{2,3})\s*(?:cm|CM|mm|MM|厘米|公分)?", text)
    values = [int(m) for m in matches]
    normalized = []
    for value in values:
        normalized.append(round(value / 10) if value >= 200 else value)
    candidates = [v for v in normalized if 20 <= v <= 80]
    return max(candidates) if candidates else None


def style_name(text: str) -> str:
    if "定制" in text or "定做" in text or "客服" in text:
        return "定制图案款"
    if "双狮" in text:
        return "八卦双狮款"
    if "家宅" in text:
        return "家宅阳刻款"
    if "金字" in text or "雄黄" in text:
        return "雄黄金字款"
    if "红字" in text or "朱砂" in text:
        return "朱砂红字款"
    if "阳刻" in text or "八卦" in text:
        return "经典阳刻款"
    return "基础刻字款"


def sku_role(text: str, size_cm: int | None) -> str:
    if "定制" in text or "定做" in text or "客服" in text:
        return "定制利润款"
    if size_cm == 24:
        return "自然引流款"
    if size_cm in {30, 40, 50}:
        return "主推转化款"
    if size_cm and size_cm >= 60:
        return "高客单利润款"
    return "测试补充款"


def shipping_for_size(size_cm: int | None) -> float:
    if size_cm is None:
        return 20.0
    if size_cm <= 24:
        return 8.0
    if size_cm <= 30:
        return 10.0
    if size_cm <= 40:
        return 13.0
    if size_cm <= 50:
        return 18.0
    return 32.0


def ad_limit_for_size(size_cm: int | None, role: str) -> float:
    if "定制" in role or size_cm == 24:
        return 0.0
    if size_cm and size_cm <= 30:
        return 6.0
    if size_cm and size_cm <= 40:
        return 8.0
    if size_cm and size_cm <= 50:
        return 12.0
    return 18.0


def target_profit(size_cm: int | None, role: str) -> float:
    if "定制" in role:
        return 50.0
    if size_cm == 24:
        return 8.0
    if size_cm and size_cm <= 30:
        return 12.0
    if size_cm and size_cm <= 40:
        return 18.0
    if size_cm and size_cm <= 50:
        return 25.0
    return 45.0


def band_for_size(size_cm: int | None, role: str) -> tuple[float, float | None]:
    if "定制" in role:
        return 399.0, None
    if size_cm == 24:
        return 39.9, 49.9
    if size_cm and size_cm <= 30:
        return 59.9, 69.9
    if size_cm and size_cm <= 40:
        return 89.9, 99.9
    if size_cm and size_cm <= 50:
        return 129.9, 149.9
    return 269.9, 299.9


def price_model(cost: float, size_cm: int | None, role: str) -> tuple[float, float, float, float, float, float]:
    shipping = shipping_for_size(size_cm)
    ad = ad_limit_for_size(size_cm, role)
    loss = round(max(cost * 0.05, 2.0), 2)
    target = target_profit(size_cm, role)
    formula_price = (cost + shipping + ad + loss + target) / (1 - PLATFORM_FEE_RATE)
    low, high = band_for_size(size_cm, role)
    if high is None:
        suggested = max(low, math.ceil(formula_price / 10) * 10 - 1)
    else:
        suggested = min(max(math.ceil(formula_price) - 0.1, low), high)
    fee = round(suggested * PLATFORM_FEE_RATE, 2)
    profit = round(suggested - cost - shipping - ad - loss - fee, 2)
    return round(suggested, 1), ad, shipping, loss, fee, profit


def build_sku_plan(docs: dict[str, dict[str, Any]], source_images: dict[str, list[Path]]) -> list[SkuPlan]:
    candidates: list[SkuPlan] = []
    by_url_path = {}
    for goods_id, doc in docs.items():
        detail = (((doc.get("raw_detail") or {}).get("queryGoodsDetail") or {}).get("result") or {})
        for item in detail.get("goodsSkuInfos") or []:
            if item.get("thumbUrl"):
                by_url_path[item["thumbUrl"]] = download_image(item["thumbUrl"], OUT_DIR / "source_images", f"{goods_id}_sku")

        for sku in doc.get("skus") or []:
            text = sku_text(sku)
            size_cm = parse_size(text)
            style = style_name(text)
            role = sku_role(text, size_cm)
            if not (
                size_cm in {24, 30, 40, 50, 60}
                or "定制" in role
                or "双狮" in text
            ):
                continue
            cost = float(sku.get("wholesale_price_yuan") or 0)
            if cost <= 0:
                continue
            price, ad, shipping, loss, fee, profit = price_model(cost, size_cm, role)
            thumb_url = sku.get("thumb_url") or doc.get("image_url") or ""
            local = by_url_path.get(thumb_url)
            if not local:
                local = download_image(thumb_url, OUT_DIR / "source_images", f"{goods_id}_{sku.get('sku_id')}")
            size_label = f"{size_cm}cm" if size_cm else "定制"
            candidates.append(
                SkuPlan(
                    goods_id=goods_id,
                    source_title=doc.get("title") or "",
                    sku_id=str(sku.get("sku_id")),
                    sku_name=text,
                    style=style,
                    size_label=size_label,
                    size_cm=size_cm,
                    role=role,
                    cost=cost,
                    suggested_price=price,
                    ad_limit=ad,
                    shipping_pack=shipping,
                    loss_reserve=loss,
                    platform_fee=fee,
                    expected_profit=profit,
                    source_url=thumb_url,
                    local_image=local,
                    keywords="泰山石敢当 石敢当 泰安石 家宅门口 路冲补角 手工刻字",
                )
            )

    preferred: list[tuple[str, int | None]] = [
        ("朱砂红字款", 24),
        ("朱砂红字款", 30),
        ("朱砂红字款", 40),
        ("朱砂红字款", 50),
        ("雄黄金字款", 30),
        ("雄黄金字款", 40),
        ("经典阳刻款", 30),
        ("经典阳刻款", 40),
        ("经典阳刻款", 50),
        ("朱砂红字款", 60),
        ("雄黄金字款", 60),
        ("家宅阳刻款", 60),
        ("八卦双狮款", 50),
        ("定制图案款", None),
    ]
    selected: list[SkuPlan] = []
    used_ids: set[str] = set()
    for style, size in preferred:
        matches = [
            c
            for c in candidates
            if c.sku_id not in used_ids
            and c.style == style
            and (c.size_cm == size if size is not None else "定制" in c.role)
            and c.expected_profit >= (-5 if c.size_cm == 24 else 8)
        ]
        if not matches:
            continue
        matches.sort(key=lambda c: (c.goods_id != PRIMARY_GOODS_ID, c.cost))
        pick = matches[0]
        selected.append(pick)
        used_ids.add(pick.sku_id)
    return selected


def paste_product(canvas: Image.Image, product_path: Path, box: tuple[int, int, int, int], bg: str = "#f4eadc") -> None:
    img = refine_product(open_image(product_path))
    product = contain_image(img, (box[2] - box[0], box[3] - box[1]), bg)
    product = product.filter(ImageFilter.UnsharpMask(radius=1.2, percent=120, threshold=3))
    canvas.paste(product, (box[0], box[1]))


def paste_photo(canvas: Image.Image, photo_path: Path, box: tuple[int, int, int, int], label: str | None = None) -> None:
    photo = refine_product(open_image(photo_path))
    cropped = cover_image(photo, (box[2] - box[0], box[3] - box[1]))
    canvas.paste(cropped, (box[0], box[1]))
    draw = ImageDraw.Draw(canvas)
    if label:
        draw.rectangle((box[0], box[3] - 58, box[2], box[3]), fill=(0, 0, 0))
        draw.text((box[0] + 18, box[3] - 43), label, font=font(24, bold=True), fill="#fff4dc")


def draw_photo_caption(canvas: Image.Image, box: tuple[int, int, int, int], title: str, subtitle: str = "") -> None:
    draw = ImageDraw.Draw(canvas)
    x1, y1, x2, y2 = box
    draw_round_rect(draw, (x1, y1, x2, y2), "#fff8ec", "#dbc5ad", 2, radius=6)
    draw.text((x1 + 20, y1 + 18), title, font=font(30, bold=True), fill=RED)
    if subtitle:
        draw.text((x1 + 20, y1 + 62), subtitle, font=font(22), fill=STONE)


def draw_red_stamp(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str) -> None:
    x, y = xy
    draw_round_rect(draw, (x, y, x + 146, y + 54), RED, radius=4)
    draw_centered(draw, (x, y, x + 146, y + 54), text, font(23, bold=True), "#fff8e7")


def make_main_images(primary_doc: dict[str, Any], sku_plan: list[SkuPlan], image_paths: list[Path], main_dir: Path) -> list[Path]:
    outputs: list[Path] = []
    main_source = image_paths[0]

    # 01 Hero
    img = stone_background((800, 800), "#f7f0e5")
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 800, 86), fill=CHARCOAL)
    paste_logo(img, (650, 12), (118, 62))
    draw.text((44, 23), "国家级非遗民俗 · 泰安石刻", font=font(28, bold=True), fill="#f8e7bd")
    paste_product(img, main_source, (58, 170, 506, 690))
    draw.text((468, 156), "泰山\n石敢当", font=font(76, black=True), fill=RED, spacing=4)
    draw.text((472, 352), "家宅门口 · 路冲补角\n手工刻字 · 中式摆件", font=font(31, bold=True), fill=INK, spacing=12)
    add_badge(draw, (468, 486), "24-60cm 多规格")
    add_badge(draw, (468, 550), "泰安发货", GOLD)
    draw.text((48, 724), "天然石材纹理各有差异，所见为同款工艺参考", font=font(22), fill=MUTED)
    path = main_dir / "01_首图_泰山石敢当_800x800.jpg"
    img.save(path, quality=94)
    outputs.append(path)

    # 02 Scenes
    img = stone_background((800, 800), "#efe8dc")
    draw = ImageDraw.Draw(img)
    paste_logo(img, (650, 38), (110, 72), 0.92)
    draw.text((44, 42), "这些位置都适合摆放", font=font(48, black=True), fill=INK)
    draw.text((46, 104), "门口 / 墙角 / 院门 / 店铺 / 过道", font=font(28, bold=True), fill=RED)
    scenes = [("大门口", "入户门侧、院门旁"), ("墙角补角", "墙角、缺角处陈设"), ("路冲过道", "走廊、门路直冲处"), ("店铺门面", "开业、收银台、店门")]
    for i, (title, desc) in enumerate(scenes):
        x = 48 + (i % 2) * 364
        y = 180 + (i // 2) * 230
        draw_round_rect(draw, (x, y, x + 314, y + 178), "#fffaf2", "#dac8b4", 2)
        draw.text((x + 28, y + 28), title, font=font(36, bold=True), fill=RED if i == 0 else INK)
        draw.text((x + 28, y + 86), desc, font=font(24), fill=STONE)
        draw.line((x + 28, y + 133, x + 252, y + 133), fill=GOLD, width=4)
    paste_product(img, main_source, (535, 470, 760, 730), "#efe8dc")
    path = main_dir / "02_场景图_门口墙角店铺_800x800.jpg"
    img.save(path, quality=94)
    outputs.append(path)

    # 03 Craft
    img = stone_background((800, 800), "#f6efe4")
    draw = ImageDraw.Draw(img)
    paste_logo(img, (650, 36), (110, 72), 0.9)
    draw.text((44, 42), "石材质感 + 手工刻字", font=font(48, black=True), fill=INK)
    draw.text((46, 104), "朱砂红字 / 雄黄金字 / 阳刻八卦", font=font(28, bold=True), fill=RED)
    for i, sku in enumerate(sku_plan[:3]):
        x = 42 + i * 252
        draw_round_rect(draw, (x, 178, x + 218, 526), "#fffaf2", "#ddcdbb", 2)
        paste_product(img, sku.local_image, (x + 20, 202, x + 198, 394), "#fffaf2")
        draw_centered(draw, (x + 18, 414, x + 200, 458), sku.style.replace("款", ""), font(24, bold=True), INK)
        draw_centered(draw, (x + 18, 462, x + 200, 502), sku.size_label, font(22), MUTED)
    notes = [("半手工雕刻", "字口有深浅变化"), ("天然石材", "纹理色差属正常"), ("多规格可选", "按摆放位置选尺寸")]
    for i, (title, desc) in enumerate(notes):
        x = 60 + i * 240
        draw.text((x, 598), title, font=font(27, bold=True), fill=RED)
        draw.text((x, 642), desc, font=font(22), fill=STONE)
    path = main_dir / "03_工艺图_石材刻字三款对比_800x800.jpg"
    img.save(path, quality=94)
    outputs.append(path)

    # 04 SKU grid
    img = stone_background((800, 800), "#f3ecdf")
    draw = ImageDraw.Draw(img)
    draw.text((44, 38), "SKU 不乱选", font=font(50, black=True), fill=INK)
    draw.text((46, 100), "按场景和尺寸选择，更容易买对", font=font(28, bold=True), fill=RED)
    for i, sku in enumerate(sku_plan[:6]):
        x = 42 + (i % 3) * 252
        y = 168 + (i // 3) * 270
        draw_round_rect(draw, (x, y, x + 218, y + 238), "#fffaf2", "#ddcdbb", 2)
        paste_product(img, sku.local_image, (x + 18, y + 16, x + 200, y + 154), "#fffaf2")
        draw_centered(draw, (x + 14, y + 166, x + 204, y + 196), f"{sku.style}", font(19, bold=True), INK)
        draw_centered(draw, (x + 14, y + 198, x + 204, y + 224), f"{sku.size_label}  ¥{sku.suggested_price:g}", font(20, bold=True), RED)
    path = main_dir / "04_SKU图_规格价格梯度_800x800.jpg"
    img.save(path, quality=94)
    outputs.append(path)

    # 05 Size guide
    img = stone_background((800, 800), "#f7f0e5")
    draw = ImageDraw.Draw(img)
    draw.text((44, 42), "尺寸怎么选", font=font(50, black=True), fill=INK)
    size_rows = [(24, "小门口/桌面/墙角", "引流款"), (30, "家用门口常规", "主推"), (40, "院门/过道更醒目", "主推"), (50, "店铺门面/大门侧", "利润款"), (60, "庭院/企业门面", "高客单")]
    max_bar = 520
    for i, (size, use, role) in enumerate(size_rows):
        y = 148 + i * 106
        draw.text((60, y), f"{size}cm", font=font(34, bold=True), fill=RED if role == "主推" else INK)
        draw_round_rect(draw, (170, y + 8, 170 + int(max_bar * size / 60), y + 42), GOLD if role == "主推" else "#8f8275", radius=4)
        draw.text((170, y + 58), f"{use} · {role}", font=font(24), fill=STONE)
    draw.text((58, 716), "建议优先铺 30/40/50cm，24cm 做自然引流，60cm 和定制款拉利润。", font=font(22), fill=MUTED)
    path = main_dir / "05_尺寸图_24到60cm选择指南_800x800.jpg"
    img.save(path, quality=94)
    outputs.append(path)

    # 06 Service
    img = stone_background((800, 800), "#efe8dc")
    draw = ImageDraw.Draw(img)
    draw.text((44, 42), "石材商品更要看包装", font=font(46, black=True), fill=INK)
    items = [("加固包装", "泡棉/纸箱/边角保护"), ("泰安发货", "批发源头，48小时内发出"), ("破损处理", "签收验货，问题及时反馈"), ("定制说明", "定制图案需客服确认")]
    for i, (title, desc) in enumerate(items):
        y = 150 + i * 128
        draw.ellipse((60, y, 120, y + 60), fill=RED if i == 0 else GOLD)
        draw_centered(draw, (60, y, 120, y + 60), str(i + 1), font(28, bold=True), "#fffaf0")
        draw.text((146, y - 2), title, font=font(34, bold=True), fill=INK)
        draw.text((146, y + 48), desc, font=font(25), fill=STONE)
    paste_product(img, main_source, (562, 482, 762, 724), "#efe8dc")
    path = main_dir / "06_保障图_包装发货售后说明_800x800.jpg"
    img.save(path, quality=94)
    outputs.append(path)
    return outputs


def detail_header(draw: ImageDraw.ImageDraw, title: str, subtitle: str) -> None:
    draw.text((48, 48), title, font=font(48, black=True), fill=INK)
    draw.text((50, 116), subtitle, font=font(25, bold=True), fill=RED)
    draw.line((50, 158, 740, 158), fill=GOLD, width=4)


def make_detail_slices(primary_doc: dict[str, Any], sku_plan: list[SkuPlan], image_paths: list[Path], detail_dir: Path) -> list[Path]:
    outputs: list[Path] = []
    main_source = image_paths[0]

    configs = [
        ("01_首屏_泰安石刻民俗.jpg", 1120),
        ("02_文化_非遗民俗寓意.jpg", 980),
        ("03_场景_门口墙角过道店铺.jpg", 1120),
        ("04_工艺_石材刻字三款.jpg", 1120),
        ("05_尺寸_24到60cm选择.jpg", 1120),
        ("06_SKU_主推价格梯度.jpg", 1400),
        ("07_下单_包装售后说明.jpg", 980),
    ]

    for name, height in configs:
        img = stone_background((790, height), "#f6efe4")
        draw = ImageDraw.Draw(img)
        if name.startswith("01"):
            paste_product(img, main_source, (55, 250, 485, 830), "#f6efe4")
            draw.text((455, 238), "泰山\n石敢当", font=font(70, black=True), fill=RED, spacing=4)
            draw.text((460, 430), "泰安石刻 · 民俗寓意\n家宅门口 · 路冲补角\n手工刻字 · 中式摆件", font=font(30, bold=True), fill=INK, spacing=16)
            add_badge(draw, (454, 640), "24-60cm")
            add_badge(draw, (454, 704), "多款可选", GOLD)
            draw.text((58, 920), "源头批发货盘：505562248188 为主推，同款素材参考 623335664244 / 220643440300", font=font(22), fill=MUTED)
            draw.text((58, 966), "设计重组后用于铺货，不复制原店铺商标，不承诺绝对化功效。", font=font(22), fill=MUTED)
        elif name.startswith("02"):
            detail_header(draw, "文化有来处，表达要克制", "国家级非遗民俗 · 泰安石刻 · 平安家宅寓意")
            paragraphs = [
                "泰山石敢当习俗是围绕石刻、家宅、道路和院门形成的传统民俗。详情页只表达文化寓意与中式装饰属性，不写保证性效果。",
                "文案关键词建议使用：民俗寓意、平安祈愿、泰安石刻、中式家宅摆件、门口墙角陈设。",
                "广告和主图避免使用“必灵、必挡、保平安”等绝对化承诺，降低平台审核风险。",
            ]
            y = 220
            for i, para in enumerate(paragraphs):
                draw_round_rect(draw, (54, y - 22, 736, y + 150), "#fffaf2", "#dfd0bd", 2)
                draw.text((78, y), f"0{i + 1}", font=font(34, bold=True), fill=RED)
                draw_wrapped(draw, para, (150, y + 2), font(27), INK, 535, 12)
                y += 220
            draw.text((62, 895), "参考：国家级非物质文化遗产名录相关公开资料、泰安市公开文化资料。", font=font(20), fill=MUTED)
        elif name.startswith("03"):
            detail_header(draw, "五类高频摆放场景", "用户先看用途，再决定尺寸")
            scenes = [("家宅大门", "门口一侧、入户附近"), ("院门墙角", "院墙、墙角、转角位置"), ("路冲过道", "走廊、过道、门路直线处"), ("店铺门面", "收银台、店门、开业陈设"), ("办公空间", "办公室、接待台、中式空间")]
            for i, (title, desc) in enumerate(scenes):
                x = 60 + (i % 2) * 350
                y = 220 + (i // 2) * 245
                draw_round_rect(draw, (x, y, x + 300, y + 180), "#fffaf2", "#dfd0bd", 2)
                draw.text((x + 24, y + 26), title, font=font(34, bold=True), fill=RED if i == 0 else INK)
                draw.text((x + 24, y + 88), desc, font=font(24), fill=STONE)
            paste_product(img, main_source, (450, 780, 742, 1070), "#f6efe4")
        elif name.startswith("04"):
            detail_header(draw, "三种主推工艺", "朱砂红字、雄黄金字、经典阳刻")
            for i, sku in enumerate(sku_plan[:3]):
                x = 54 + i * 242
                draw_round_rect(draw, (x, 230, x + 210, 670), "#fffaf2", "#dfd0bd", 2)
                paste_product(img, sku.local_image, (x + 18, 260, x + 192, 485), "#fffaf2")
                draw_centered(draw, (x + 15, 512, x + 195, 548), sku.style, font(22, bold=True), INK)
                draw_centered(draw, (x + 15, 562, x + 195, 600), sku.size_label, font(22), MUTED)
            notes = [("天然石材", "纹理、边缘、色差每块不同"), ("半手工刻字", "字口深浅会有自然差异"), ("户外陈设", "石材质感比树脂类更稳重")]
            y = 760
            for title, desc in notes:
                draw.text((70, y), title, font=font(32, bold=True), fill=RED)
                draw.text((250, y + 4), desc, font=font(26), fill=STONE)
                y += 90
        elif name.startswith("05"):
            detail_header(draw, "尺寸选择不踩坑", "按摆放位置选，不只看低价")
            rows = [(24, "桌面、小墙角", "自然引流款"), (30, "普通家用门口", "主推转化款"), (40, "门口/过道更醒目", "主推转化款"), (50, "院门/店铺门面", "利润款"), (60, "庭院/企业门面", "高客单款")]
            for i, (size, use, role) in enumerate(rows):
                y = 230 + i * 155
                draw.text((70, y), f"{size}cm", font=font(42, bold=True), fill=RED if "主推" in role else INK)
                draw_round_rect(draw, (190, y + 10, 190 + int(455 * size / 60), y + 50), GOLD if "主推" in role else "#8d8175", radius=4)
                draw.text((190, y + 70), f"{use} · {role}", font=font(25), fill=STONE)
            draw.text((70, 1040), "铺货建议：30/40/50cm 做广告测试，24cm 控制投流，60cm 和定制款客服确认后销售。", font=font(20), fill=MUTED)
        elif name.startswith("06"):
            detail_header(draw, "第一版主推 SKU", "保留能卖、能解释、能盈利的规格")
            for i, sku in enumerate(sku_plan[:10]):
                x = 48 + (i % 2) * 360
                y = 210 + (i // 2) * 220
                draw_round_rect(draw, (x, y, x + 320, y + 184), "#fffaf2", "#dfd0bd", 2)
                paste_product(img, sku.local_image, (x + 16, y + 18, x + 138, y + 146), "#fffaf2")
                draw.text((x + 152, y + 22), sku.style, font=font(22, bold=True), fill=INK)
                draw.text((x + 152, y + 60), sku.size_label, font=font(22), fill=STONE)
                draw.text((x + 152, y + 98), f"建议 ¥{sku.suggested_price:g}", font=font(25, bold=True), fill=RED)
                draw.text((x + 152, y + 136), sku.role, font=font(18), fill=MUTED)
            draw.text((58, 1330), "表格中保留供应价、广告上限、运费包装、损耗预留和预估利润，铺货时按平台活动再微调。", font=font(19), fill=MUTED)
        elif name.startswith("07"):
            detail_header(draw, "下单前说明", "石材类商品把风险提前讲清楚，减少售后")
            items = [
                ("天然色差", "每块石材纹理、色泽、边缘不同，属于天然材料特征。"),
                ("手工差异", "刻字深浅、笔画边缘会有轻微差异，不影响陈设使用。"),
                ("包装验货", "收到后先检查外包装和石材边角，如有运输问题及时反馈。"),
                ("定制规则", "定制图案、尺寸需客服确认后生产，通常不支持无理由退换。"),
            ]
            y = 230
            for i, (title, desc) in enumerate(items):
                draw_round_rect(draw, (58, y, 732, y + 125), "#fffaf2", "#dfd0bd", 2)
                draw.text((86, y + 32), title, font=font(31, bold=True), fill=RED if i == 0 else INK)
                draw_wrapped(draw, desc, (250, y + 30), font(24), STONE, 430, 8)
                y += 160
            draw.text((70, 910), "客服话术重点：尺寸确认、摆放位置确认、定制内容确认、签收验货提醒。", font=font(20), fill=MUTED)
        path = detail_dir / name
        img.save(path, quality=94)
        outputs.append(path)
    return outputs


def make_sku_images(sku_plan: list[SkuPlan], sku_dir: Path) -> list[Path]:
    outputs: list[Path] = []
    for index, sku in enumerate(sku_plan, start=1):
        img = stone_background((800, 800), "#f7f0e5")
        draw = ImageDraw.Draw(img)
        draw.text((44, 42), sku.style, font=font(46, black=True), fill=INK)
        draw.text((46, 102), f"{sku.size_label} · {sku.role}", font=font(27, bold=True), fill=RED)
        paste_product(img, sku.local_image, (90, 174, 530, 630), "#f7f0e5")
        draw_round_rect(draw, (540, 210, 746, 430), "#fffaf2", "#dfd0bd", 2)
        draw_centered(draw, (560, 238, 726, 292), "建议售价", font(26, bold=True), INK)
        draw_centered(draw, (560, 308, 726, 374), f"¥{sku.suggested_price:g}", font(42, black=True), RED)
        draw.text((544, 480), f"供应价 ¥{sku.cost:g}", font=font(23), fill=STONE)
        draw.text((544, 524), f"广告上限 ¥{sku.ad_limit:g}", font=font(23), fill=STONE)
        draw.text((544, 568), f"预估利润 ¥{sku.expected_profit:g}", font=font(23), fill=STONE if sku.expected_profit >= 0 else RED)
        draw.text((48, 710), "天然石材一石一纹，图片为同款工艺参考", font=font(22), fill=MUTED)
        path = sku_dir / f"{index:02d}_{safe_name(sku.style)}_{safe_name(sku.size_label)}_建议{sku.suggested_price:g}元.jpg"
        img.save(path, quality=94)
        outputs.append(path)
    return outputs


def write_pricing_files(sku_plan: list[SkuPlan], root: Path) -> tuple[Path, Path]:
    rows = []
    for sku in sku_plan:
        rows.append(
            {
                "商品ID": sku.goods_id,
                "来源商品": sku.source_title,
                "SKU ID": sku.sku_id,
                "SKU名称": sku.sku_name,
                "款式": sku.style,
                "尺寸": sku.size_label,
                "角色": sku.role,
                "供应价": sku.cost,
                "建议售价": sku.suggested_price,
                "广告消耗上限": sku.ad_limit,
                "预估运费包装": sku.shipping_pack,
                "损耗预留": sku.loss_reserve,
                "平台费": sku.platform_fee,
                "预估单件利润": sku.expected_profit,
                "铺货标题关键词": sku.keywords,
                "来源图片": str(sku.local_image),
                "来源URL": sku.source_url,
            }
        )
    csv_path = root / "taishan_shigandang_sku_pricing.csv"
    xlsx_path = root / "taishan_shigandang_sku_pricing.xlsx"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    df = pd.DataFrame(rows)
    with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="SKU定价", index=False)
        ws = writer.book["SKU定价"]
        for column_cells in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in column_cells)
            ws.column_dimensions[column_cells[0].column_letter].width = min(max(max_len + 2, 12), 42)
        for cell in ws[1]:
            cell.style = "Headline 4"
    return csv_path, xlsx_path


def write_preview(
    root: Path,
    main_images: Iterable[Path],
    detail_images: Iterable[Path],
    sku_images: Iterable[Path],
    pricing_xlsx: Path,
) -> Path:
    html_path = root / "preview.html"
    def img_tag(path: Path, width: int) -> str:
        return f'<img src="{path.relative_to(root).as_posix()}" style="width:{width}px;max-width:100%;border:1px solid #ddd;margin:8px 0;">'

    html = [
        "<!doctype html><html><head><meta charset='utf-8'><title>泰山石敢当铺货素材预览</title>",
        "<style>body{font-family:'Microsoft YaHei',Arial,sans-serif;margin:24px;background:#f6f1e9;color:#211b16}"
        "section{margin:28px 0}h1,h2{margin-bottom:10px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}"
        "a{color:#9f1f1a}</style></head><body>",
        "<h1>泰山石敢当商品主图、详情页与SKU铺货素材</h1>",
        f"<p>SKU定价表：<a href='{pricing_xlsx.relative_to(root).as_posix()}'>{pricing_xlsx.name}</a></p>",
        "<section><h2>主图 800x800</h2><div class='grid'>",
    ]
    html.extend(img_tag(path, 260) for path in main_images)
    html.append("</div></section><section><h2>SKU图 800x800</h2><div class='grid'>")
    html.extend(img_tag(path, 260) for path in sku_images)
    html.append("</div></section><section><h2>详情页切片 790px</h2>")
    html.extend(img_tag(path, 790) for path in detail_images)
    html.append("</section></body></html>")
    html_path.write_text("\n".join(html), encoding="utf-8")
    return html_path


def validate_outputs(main_images: list[Path], detail_images: list[Path], sku_images: list[Path], sku_plan: list[SkuPlan]) -> list[str]:
    checks: list[str] = []
    for path in main_images:
        with Image.open(path) as img:
            checks.append(f"OK main {path.name}: {img.size[0]}x{img.size[1]}")
            if img.size != (800, 800):
                raise RuntimeError(f"Main image size invalid: {path}")
    for path in detail_images:
        with Image.open(path) as img:
            checks.append(f"OK detail {path.name}: {img.size[0]}x{img.size[1]}")
            if img.size[0] != 790:
                raise RuntimeError(f"Detail image width invalid: {path}")
    for path in sku_images:
        with Image.open(path) as img:
            checks.append(f"OK sku {path.name}: {img.size[0]}x{img.size[1]}")
            if img.size != (800, 800):
                raise RuntimeError(f"SKU image size invalid: {path}")
    if len(sku_images) != len(sku_plan):
        raise RuntimeError("SKU image count does not match SKU plan")
    for sku in sku_plan:
        if sku.expected_profit < -5:
            raise RuntimeError(f"SKU expected profit too low: {sku.sku_id} {sku.expected_profit}")
    return checks


def write_manifest(root: Path, docs: dict[str, dict[str, Any]], sku_plan: list[SkuPlan], checks: list[str]) -> Path:
    path = root / "README_铺货说明.md"
    lines = [
        "# 泰山石敢当铺货素材说明",
        "",
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## 数据来源",
    ]
    for goods_id, doc in docs.items():
        lines.append(f"- {goods_id}：{doc.get('title')}；店铺：{doc.get('shop_name')}；销量提示：{doc.get('sales_tip_amount')}；批发价：{doc.get('min_wholesale_price_yuan')}-{doc.get('max_wholesale_price_yuan')} 元")
    lines.extend(
        [
            "",
            "## 设计定位",
            "- 平台：拼多多优先。",
            "- 主视觉：泰山石纹、朱砂红、石墨黑、金色点缀。",
            "- 文案边界：表达民俗寓意和中式摆件属性，不写绝对化功效承诺。",
            "",
            "## 定价模型",
            "- 建议售价 = 供应价 + 运费包装 + 广告预留 + 破损损耗 + 平台费 + 目标利润。",
            "- 平台费按 0.6%，破损损耗按 max(供应价*5%, 2元)。",
            "- 24cm 控制投流；30/40/50cm 主推；60cm 和定制款拉利润。",
            "",
            "## 输出目录",
            "- main_images_800：商品主图。",
            "- detail_slices_790：详情页切片。",
            "- sku_images_800：SKU 图。",
            "- taishan_shigandang_sku_pricing.xlsx：SKU 定价表。",
            "- preview.html：本地预览页。",
            "",
            "## 校验结果",
        ]
    )
    lines.extend(f"- {item}" for item in checks)
    lines.extend(["", "## SKU概览"])
    for sku in sku_plan:
        lines.append(f"- {sku.style} {sku.size_label}：供应价 {sku.cost:g}，建议售价 {sku.suggested_price:g}，预估利润 {sku.expected_profit:g}，角色 {sku.role}")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main() -> None:
    dirs = ensure_dirs()
    clean_generated_dirs(dirs)
    docs = fetch_docs()
    source_images = collect_source_images(docs, dirs["source"])
    primary_doc = docs[PRIMARY_GOODS_ID]
    primary_images = source_images[PRIMARY_GOODS_ID]
    if not primary_images:
        raise RuntimeError("No primary product images were downloaded.")

    sku_plan = build_sku_plan(docs, source_images)
    if len(sku_plan) < 8:
        raise RuntimeError(f"Too few SKU plans generated: {len(sku_plan)}")

    main_images = make_main_images(primary_doc, sku_plan, primary_images, dirs["main"])
    detail_images = make_detail_slices(primary_doc, sku_plan, primary_images, dirs["detail"])
    sku_images = make_sku_images(sku_plan, dirs["sku"])
    _, pricing_xlsx = write_pricing_files(sku_plan, dirs["root"])
    checks = validate_outputs(main_images, detail_images, sku_images, sku_plan)
    readme = write_manifest(dirs["root"], docs, sku_plan, checks)
    preview = write_preview(dirs["root"], main_images, detail_images, sku_images, pricing_xlsx)

    print(f"done: {dirs['root']}")
    print(f"preview: {preview}")
    print(f"pricing: {pricing_xlsx}")
    print(f"readme: {readme}")
    print(f"main_images: {len(main_images)} detail_slices: {len(detail_images)} sku_images: {len(sku_images)}")


if __name__ == "__main__":
    main()
