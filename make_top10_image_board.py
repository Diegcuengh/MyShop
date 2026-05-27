from __future__ import annotations

import shutil
from pathlib import Path

import pandas as pd
from PIL import Image, ImageDraw, ImageFont


DATA_ROOT = Path(r"E:\ds电商\data")
OUT_DIR = Path(r"E:\proj\MyShop\output")
BOARD_DIR = OUT_DIR / "top10_main_images"


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for ch in text:
        candidate = current + ch
        if draw.textbbox((0, 0), candidate, font=fnt)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines


def fit_image(src: Path, size: int) -> Image.Image:
    img = Image.open(src).convert("RGB")
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), "white")
    x = (size - img.width) // 2
    y = (size - img.height) // 2
    canvas.paste(img, (x, y))
    return canvas


def main() -> None:
    BOARD_DIR.mkdir(parents=True, exist_ok=True)
    products = pd.read_excel(OUT_DIR / "category_analysis.xlsx", sheet_name=0)
    top10 = pd.read_excel(OUT_DIR / "top10_potential_products.xlsx")
    image_by_id = products.set_index("goodsId")["imageLocal"].to_dict()

    title_font = font(28)
    meta_font = font(18)
    small_font = font(15)
    card_w, card_h = 430, 520
    img_size = 360
    gap = 24
    cols, rows = 2, 5
    board = Image.new("RGB", (cols * card_w + (cols + 1) * gap, rows * card_h + (rows + 1) * gap), "#f4f1ec")
    draw = ImageDraw.Draw(board)

    manifest = []
    for idx, row in top10.iterrows():
        rank = int(row.iloc[0])
        product_type = str(row.iloc[1])
        source_id = int(row.iloc[8])
        price_band = str(row.iloc[7])
        title = str(row.iloc[9])
        rel = image_by_id.get(source_id, "")
        src = DATA_ROOT / rel if isinstance(rel, str) and rel else None
        if not src or not src.exists():
            continue

        copied = BOARD_DIR / f"{rank:02d}_{product_type.replace('/', '_')}_{source_id}{src.suffix.lower()}"
        shutil.copy2(src, copied)
        manifest.append(
            {
                "排名": rank,
                "潜力产品类型": product_type,
                "代表源商品ID": source_id,
                "建议售价带": price_band,
                "主图文件": str(copied),
                "代表标题": title,
            }
        )

        col = idx % cols
        row_no = idx // cols
        x0 = gap + col * (card_w + gap)
        y0 = gap + row_no * (card_h + gap)
        draw.rounded_rectangle((x0, y0, x0 + card_w, y0 + card_h), radius=10, fill="white", outline="#ded8cf", width=2)

        img = fit_image(src, img_size)
        board.paste(img, (x0 + (card_w - img_size) // 2, y0 + 18))
        text_y = y0 + 394
        draw.text((x0 + 18, text_y), f"{rank}. {product_type}", fill="#1f2a24", font=title_font)
        text_y += 40
        draw.text((x0 + 18, text_y), f"售价带：{price_band}", fill="#b92d1e", font=meta_font)
        text_y += 30
        for line in wrap_text(draw, title, small_font, card_w - 36)[:2]:
            draw.text((x0 + 18, text_y), line, fill="#5a5048", font=small_font)
            text_y += 22

    board_path = OUT_DIR / "top10_main_image_board.png"
    board.save(board_path, quality=95)
    pd.DataFrame(manifest).to_excel(OUT_DIR / "top10_main_images_manifest.xlsx", index=False)
    print(board_path)
    print(OUT_DIR / "top10_main_images_manifest.xlsx")


if __name__ == "__main__":
    main()
