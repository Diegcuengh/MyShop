from __future__ import annotations

import json
import math
import re
import shutil
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any

import pandas as pd
from PIL import Image


DATA_ROOT = Path(r"E:\ds电商\data")
BATCH_DIR = DATA_ROOT / "泰山 石敢当_20260526_115329"
OUT_DIR = Path(r"E:\proj\MyShop\output")
ASSET_DIR = OUT_DIR / "assets"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def yuan(cents: int | float | None) -> float | None:
    if cents is None:
        return None
    return round(float(cents) / 100, 2)


def classify(title: str) -> str:
    if any(k in title for k in ("门牌", "刻字", "石板", "外墙", "大门口", "墙上")):
        return "石板门牌/刻字定制"
    if any(k in title for k in ("挂件", "贴", "自粘", "牌匾", "桃木")):
        return "挂件/贴牌"
    if any(k in title for k in ("青石", "雕刻", "浮雕", "阳刻")):
        return "青石雕刻摆件"
    if any(k in title for k in ("原石", "靠山石", "奇石", "石头", "天然")):
        return "天然原石摆件"
    if any(k in title for k in ("铜", "天官", "招财")):
        return "金属/招财衍生"
    return "其他"


def clean_spec_value(value: str) -> str:
    value = re.sub(r"\s+", "", value or "")
    value = value.replace("左右随机发货", "cm左右")
    value = value.replace("厘米", "cm")
    value = value.replace("高度", "")
    value = value.replace("原石", "")
    return value


def pdd_price(wholesale_yuan: float) -> float:
    if wholesale_yuan < 20:
        rate, add = 1.65, 3
    elif wholesale_yuan < 50:
        rate, add = 1.5, 5
    elif wholesale_yuan < 100:
        rate, add = 1.38, 8
    else:
        rate, add = 1.28, 12
    raw = wholesale_yuan * rate + add
    return round(math.ceil(raw) - 0.1, 1)


@dataclass
class ProductPick:
    goods_id: str
    title: str
    category: str
    sales: int
    min_price: float
    max_price: float
    detail_path: Path


def extract_product(detail_path: Path, fallback_title: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    try:
        data = load_json(detail_path)
    except Exception:
        return None, []
    detail = data.get("queryGoodsDetail", {}).get("result") or {}
    props = data.get("queryGoodsPropertyInfo", {}).get("result") or {}
    reviews = data.get("queryGoodsReviewList", {}).get("result", {}).get("reviews") or []
    goods_id = str(detail.get("goodsId") or detail_path.parent.name)
    title = detail.get("goodsName") or fallback_title
    share_info = data.get("queryGoodsShareInfo") or {}
    share_result = share_info.get("result") or {}
    product = {
        "goodsId": goods_id,
        "title": title,
        "category": classify(title),
        "sales": int(re.sub(r"\D", "", str(detail.get("salesTipAmount") or "0")) or 0),
        "minWholesalePrice": yuan(detail.get("minWholesalePrice")),
        "maxWholesalePrice": yuan(detail.get("maxWholesalePrice")),
        "skuCount": len(detail.get("goodsSkuInfos") or []),
        "carouselCount": len(detail.get("goodsCarouselInfos") or []),
        "detailImageCount": len(props.get("goodsPropertyInfos") or []),
        "reviewCount": len(reviews),
        "detailFile": str(detail_path),
        "shareUrl": share_result.get("url", ""),
        "imageLocal": detail.get("imageUrl_localFile", ""),
    }
    skus = []
    for sku in detail.get("goodsSkuInfos") or []:
        spec_pairs = sku.get("skuSpecs") or []
        spec = " / ".join(f"{x.get('specKey')}:{x.get('specValue')}" for x in spec_pairs)
        wholesale = yuan(sku.get("wholesalePrice"))
        if wholesale is None:
            continue
        skus.append(
            {
                "goodsId": goods_id,
                "sourceTitle": title,
                "category": product["category"],
                "sourceSkuId": str(sku.get("skuId") or ""),
                "sourceSpec": spec,
                "cleanSpec": clean_spec_value(spec),
                "sourceWholesaleYuan": wholesale,
                "sourceGroupYuan": yuan(sku.get("groupPrice")),
                "suggestPddPriceYuan": pdd_price(wholesale),
                "stock": sku.get("quantity"),
                "thumbLocal": sku.get("thumbUrl_localFile", ""),
            }
        )
    return product, skus


def resolve_resource(local_file: str) -> Path | None:
    if not local_file:
        return None
    path = DATA_ROOT / local_file
    return path if path.exists() else None


def copy_asset(src: Path, name: str) -> str:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    ext = src.suffix.lower() or ".jpg"
    dst = ASSET_DIR / f"{name}{ext}"
    shutil.copy2(src, dst)
    return str(dst.relative_to(OUT_DIR)).replace("\\", "/")


def try_ocr(paths: list[Path]) -> list[dict[str, str]]:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception as exc:
        return [{"image": str(p), "text": f"OCR不可用: {exc}"} for p in paths]
    engine = RapidOCR()
    rows: list[dict[str, str]] = []
    for path in paths:
        try:
            result, _ = engine(str(path))
            parts = [line[1].strip() for line in result or [] if len(line) > 1 and line[1].strip()]
            rows.append({"image": str(path), "text": "\n".join(parts)})
        except Exception as exc:
            rows.append({"image": str(path), "text": f"OCR失败: {exc}"})
    return rows


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    search = load_json(BATCH_DIR / "_搜索结果.json")
    products: list[dict[str, Any]] = []
    sku_rows: list[dict[str, Any]] = []
    title_by_id = {str(x.get("goodsId")): x.get("title", "") for x in search.get("goods", [])}

    for item in search.get("goods", []):
        detail_file = item.get("detailFile")
        if not detail_file:
            continue
        detail_path = BATCH_DIR / detail_file
        if not detail_path.exists():
            continue
        product, skus = extract_product(detail_path, item.get("title", ""))
        if not product:
            continue
        products.append(product)
        sku_rows.extend(skus)

    products_df = pd.DataFrame(products)
    sku_df = pd.DataFrame(sku_rows)
    category_df = (
        products_df.groupby("category", dropna=False)
        .agg(
            productCount=("goodsId", "count"),
            totalSales=("sales", "sum"),
            medianMinWholesale=("minWholesalePrice", "median"),
            minWholesale=("minWholesalePrice", "min"),
            maxWholesale=("maxWholesalePrice", "max"),
            medianSkuCount=("skuCount", "median"),
        )
        .reset_index()
        .sort_values(["totalSales", "productCount"], ascending=False)
    )

    keyword_counter: Counter[str] = Counter()
    for title in products_df["title"].fillna(""):
        for kw in ("正品", "天然", "原石", "泰山石敢当", "镇宅", "补角", "路冲", "靠山石", "青石", "刻字", "室内外", "客厅", "办公室", "家用", "定制"):
            if kw in title:
                keyword_counter[kw] += 1

    picked = (
        products_df[(products_df["category"] == "天然原石摆件") & (products_df["skuCount"] >= 5)]
        .sort_values(["sales", "detailImageCount"], ascending=False)
        .head(1)
    )
    if picked.empty:
        picked = products_df.sort_values(["sales", "detailImageCount"], ascending=False).head(1)
    pick = picked.iloc[0].to_dict()
    pick_detail = load_json(Path(pick["detailFile"]))
    pick_result = pick_detail["queryGoodsDetail"]["result"]
    pick_props = pick_detail.get("queryGoodsPropertyInfo", {}).get("result") or {}

    selected_images: list[dict[str, Any]] = []
    for idx, info in enumerate((pick_result.get("goodsCarouselInfos") or [])[:6], 1):
        p = resolve_resource(info.get("url_localFile", ""))
        if p:
            selected_images.append({"role": "carousel", "index": idx, "src": p})
    for idx, info in enumerate((pick_props.get("goodsPropertyInfos") or [])[:12], 1):
        p = resolve_resource(info.get("url_localFile", ""))
        if p:
            selected_images.append({"role": "detail", "index": idx, "src": p})

    asset_rows = []
    for i, row in enumerate(selected_images, 1):
        src = row["src"]
        rel = copy_asset(src, f"{i:02d}_{row['role']}_{row['index']}")
        try:
            w, h = image_size(src)
        except Exception:
            w, h = 0, 0
        asset_rows.append({"role": row["role"], "index": row["index"], "source": str(src), "output": rel, "width": w, "height": h})

    ocr_targets = [x["src"] for x in selected_images if x["role"] == "detail"][:10]
    ocr_rows = try_ocr(ocr_targets)
    ocr_text = "\n".join(x["text"] for x in ocr_rows if x["text"] and not x["text"].startswith("OCR"))

    source_skus = sku_df[sku_df["goodsId"] == str(pick["goodsId"])].copy()
    source_skus = source_skus[source_skus["stock"].isna() | (source_skus["stock"] != 0)]
    source_skus = source_skus.sort_values("sourceWholesaleYuan").head(9)
    publish_skus = source_skus[
        ["cleanSpec", "sourceWholesaleYuan", "suggestPddPriceYuan", "sourceSkuId", "thumbLocal"]
    ].rename(
        columns={
            "cleanSpec": "SKU规格",
            "sourceWholesaleYuan": "拿货价",
            "suggestPddPriceYuan": "建议拼多多售价",
            "sourceSkuId": "源SKU",
            "thumbLocal": "SKU图片",
        }
    )

    product_title = "天然泰山石敢当原石摆件 镇宅补角靠山石 室内外办公室客厅可用"
    subtitle = "山东泰山天然石材，原石纹理随机发货；适合门口、客厅、办公室、庭院等场景摆放。"
    bullets = [
        "天然原石：每块纹理、形态不同，实拍同款随机优选。",
        "多尺寸可选：从约10cm到35cm，覆盖桌面、门口、庭院等使用场景。",
        "场景明确：补角、路冲、靠山石、办公室/客厅/室外摆件关键词需求集中。",
        "现货批发源：参考同类爆款销量与SKU梯度，设置低门槛引流款和中高客单利润款。",
        "售后说明：天然石材存在色差、纹理差异、边角自然痕迹，介意慎拍。",
    ]

    md = []
    md.append("# 拼多多商品方案：泰山石敢当天然原石摆件\n")
    md.append("## 1. 类目结论\n")
    md.append(f"- 抓取批次：`{BATCH_DIR}`")
    md.append(f"- 有效详情：{len(products_df)} 个商品，SKU {len(sku_df)} 条")
    md.append(f"- 搜索词：{search.get('keyword')}，搜索结果总量：{search.get('total')}")
    md.append("- 主推方向：天然原石摆件。原因是搜索词和标题高频集中在“天然、原石、镇宅、补角、靠山石、室内外”，并且 SKU 梯度完整，适合低价引流加尺寸升级。")
    md.append("\n## 2. 类目价格带\n")
    md.append(category_df.to_markdown(index=False))
    md.append("\n## 3. 高频卖点词\n")
    md.append(", ".join(f"{k}({v})" for k, v in keyword_counter.most_common()))
    md.append("\n## 4. 建议商品标题\n")
    md.append(product_title)
    md.append("\n## 5. 商品短卖点\n")
    md.extend(f"- {x}" for x in bullets)
    md.append("\n## 6. 建议 SKU 与价格\n")
    md.append(publish_skus.to_markdown(index=False))
    md.append("\n## 7. 详情页结构\n")
    md.append("1. 首屏：天然泰山石敢当原石摆件，突出镇宅补角、靠山石、室内外可用。")
    md.append("2. 尺寸选择：10cm以下、10cm、15cm、20cm、25cm、27cm、30cm、33cm、35cm。")
    md.append("3. 材质说明：泰山天然石材/青石，天然纹理，随机优选。")
    md.append("4. 使用场景：入户门、客厅、办公室、庭院、店铺、墙角、路冲位置。")
    md.append("5. 发货说明：天然石不是一图一物，形态纹理随机；大件注意签收检查。")
    md.append("\n## 8. 图片 OCR 提取文案\n")
    if ocr_rows:
        for row in ocr_rows:
            md.append(f"### {Path(row['image']).name}")
            md.append(row["text"] or "未识别到文字")
    else:
        md.append("未执行 OCR。")
    md.append("\n## 9. 素材清单\n")
    md.append(pd.DataFrame(asset_rows).to_markdown(index=False))
    (OUT_DIR / "pdd_listing_plan.md").write_text("\n".join(md), encoding="utf-8")

    html_assets = "\n".join(
        f'<img src="{x["output"]}" alt="{x["role"]}-{x["index"]}">' for x in asset_rows
    )
    sku_html = publish_skus.to_html(index=False)
    category_html = category_df.to_html(index=False)
    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{product_title}</title>
  <style>
    body {{ margin: 0; font-family: Arial, "Microsoft YaHei", sans-serif; color: #202020; background: #f7f4ef; }}
    .wrap {{ max-width: 900px; margin: 0 auto; background: #fff; }}
    .hero {{ padding: 28px 22px 18px; background: #1f2a24; color: #fff; }}
    h1 {{ margin: 0 0 12px; font-size: 30px; line-height: 1.2; letter-spacing: 0; }}
    h2 {{ margin: 28px 22px 12px; font-size: 22px; }}
    p, li {{ font-size: 16px; line-height: 1.75; }}
    .price {{ font-size: 28px; color: #c93422; font-weight: 700; }}
    .section {{ padding: 0 22px 16px; }}
    .grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 8px 18px; }}
    img {{ width: 100%; height: auto; display: block; background: #eee; }}
    table {{ border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0 18px; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
    th {{ background: #f0ebe4; }}
    .note {{ color: #6a5142; }}
    @media (max-width: 640px) {{ .grid {{ grid-template-columns: 1fr; }} h1 {{ font-size: 24px; }} }}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <h1>{product_title}</h1>
      <p>{subtitle}</p>
      <div class="price">建议起售价 ¥{publish_skus["建议拼多多售价"].min():.1f}</div>
    </section>
    <section class="grid">{html_assets}</section>
    <h2>核心卖点</h2>
    <section class="section"><ul>{"".join(f"<li>{x}</li>" for x in bullets)}</ul></section>
    <h2>SKU 价格</h2>
    <section class="section">{sku_html}</section>
    <h2>类目价格参考</h2>
    <section class="section">{category_html}</section>
    <h2>购买须知</h2>
    <section class="section note">
      <p>天然石材每块纹理、颜色、形态不同，页面图片用于展示同类效果，实际以收到实物为准。室外大件签收前请检查外包装。</p>
    </section>
  </main>
</body>
</html>"""
    (OUT_DIR / "detail_page_preview.html").write_text(html, encoding="utf-8")

    with pd.ExcelWriter(OUT_DIR / "category_analysis.xlsx", engine="openpyxl") as writer:
        products_df.to_excel(writer, sheet_name="商品汇总", index=False)
        sku_df.to_excel(writer, sheet_name="源SKU价格", index=False)
        category_df.to_excel(writer, sheet_name="类目价格带", index=False)
        publish_skus.to_excel(writer, sheet_name="建议上架SKU", index=False)
        pd.DataFrame(asset_rows).to_excel(writer, sheet_name="详情页素材", index=False)
        pd.DataFrame(ocr_rows).to_excel(writer, sheet_name="OCR文案", index=False)

    summary = {
        "batchDir": str(BATCH_DIR),
        "productCount": len(products_df),
        "skuCount": len(sku_df),
        "pickedGoodsId": str(pick["goodsId"]),
        "pickedTitle": pick["title"],
        "outputs": [
            str(OUT_DIR / "pdd_listing_plan.md"),
            str(OUT_DIR / "category_analysis.xlsx"),
            str(OUT_DIR / "detail_page_preview.html"),
        ],
    }
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
