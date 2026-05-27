from __future__ import annotations

from pathlib import Path

import pandas as pd


OUT_DIR = Path(r"E:\proj\MyShop\output")
SOURCE_XLSX = OUT_DIR / "category_analysis.xlsx"


def sub_type(title: str) -> str:
    title = str(title)
    if any(k in title for k in ("铜", "招财", "天官")):
        return "金属招财衍生款"
    if any(k in title for k in ("挂件", "牌匾", "桃木")):
        return "挂件/中式挂饰"
    if any(k in title for k in ("一图一物", "精选", "精品")) and any(k in title for k in ("原石", "天然")):
        return "一图一物精选原石"
    if any(k in title for k in ("底座", "木座")):
        return "带底座原石摆件"
    if any(k in title for k in ("靠山石", "办公室", "老板桌", "收银台")):
        return "靠山石/办公室摆件"
    if any(k in title for k in ("路冲", "补角", "缺角", "室外")):
        return "室外路冲补角石"
    if any(k in title for k in ("青石", "雕刻", "浮雕", "阳刻")):
        return "青石雕刻石敢当"
    if any(k in title for k in ("门牌", "刻字", "石板")):
        return "石板刻字门牌"
    if any(k in title for k in ("自粘", "粘贴", "外墙", "贴墙")):
        return "外墙粘贴/自粘门牌"
    if any(k in title for k in ("庭院", "大号", "大型")):
        return "大号庭院镇宅石"
    if any(k in title for k in ("朱砂", "红石", "红色")):
        return "朱砂/红石泰山石"
    if any(k in title for k in ("定制", "刻字")):
        return "可定制刻字款"
    if any(k in title for k in ("原石", "天然", "石头")):
        return "天然原石小摆件"
    return "普通泰山石摆件"


REASON_MAP = {
    "天然原石小摆件": ("搜索需求最大，低客单更适合拼多多引流，天然/原石/补角词覆盖广。", "9.9-39.9 引流款，主打天然随机、桌面/门口小摆件。"),
    "室外路冲补角石": ("补角、路冲是明确场景需求，用户购买目的强。", "做场景款：入户门、墙角、路冲、庭院，详情页强调尺寸选择。"),
    "石板刻字门牌": ("商品数多、客单价高，适合做利润款和定制款。", "主打室外门牌/刻字，设置尺寸+刻字内容定制。"),
    "青石雕刻石敢当": ("青石和雕刻有材质差异，视觉更稳定，适合主图做质感。", "中客单款，强调青石材质、雕刻清晰、室外耐放。"),
    "可定制刻字款": ("定制能提高转化和客单，但需要客服承接。", "做“刻字定制”独立 SKU，详情页说明下单备注/联系客服。"),
    "靠山石/办公室摆件": ("办公室、靠山石是送礼和办公桌场景，文案容易聚焦。", "主打办公桌/老板桌/收银台，SKU 以中小尺寸为主。"),
    "带底座原石摆件": ("带底座提升成品感和溢价，适合解决原石摆放不稳痛点。", "把“送实木底座”放主图，价格高于普通原石。"),
    "挂件/中式挂饰": ("体积小、物流低、可做礼品场景，但竞争词偏泛。", "做中式挂饰/乔迁礼品补充款。"),
    "大号庭院镇宅石": ("高客单但物流和售后风险更高，适合少量利润款。", "只保留大号高价 SKU，强调木架/包装/签收。"),
    "一图一物精选原石": ("差异化强，可减少同质化比价，但上新维护成本更高。", "做高价精选款，图片一石一拍，客服确认后发货。"),
    "外墙粘贴/自粘门牌": ("安装简单，适合低门槛用户，但材质和耐候要讲清。", "主打免打孔/外墙/门口，小规格低价款。"),
    "金属招财衍生款": ("和泰山石主词相关性弱，适合作为店铺扩品，不宜主推。", "作为关联搭配款，不抢主推资源。"),
    "普通泰山石摆件": ("覆盖面广但差异化弱，需要依靠价格和主图。", "作为基础款补充。"),
    "朱砂/红石泰山石": ("颜色有差异化，但样本少，先小批测试。", "做视觉差异款，小流量测试。"),
}


def main() -> None:
    products = pd.read_excel(SOURCE_XLSX, sheet_name=0)
    skus = pd.read_excel(SOURCE_XLSX, sheet_name=1)
    products["potentialType"] = products["title"].map(sub_type)

    agg = (
        products.groupby("potentialType")
        .agg(
            productCount=("goodsId", "count"),
            totalSales=("sales", "sum"),
            medianSales=("sales", "median"),
            medianMin=("minWholesalePrice", "median"),
            minPrice=("minWholesalePrice", "min"),
            maxPrice=("maxWholesalePrice", "max"),
            medianSku=("skuCount", "median"),
            detailImgs=("detailImageCount", "median"),
        )
        .reset_index()
    )
    sku2 = skus.merge(products[["goodsId", "potentialType"]], on="goodsId", how="left")
    skuagg = (
        sku2.groupby("potentialType")
        .agg(skuCount=("sourceSkuId", "count"), skuMedianCost=("sourceWholesaleYuan", "median"))
        .reset_index()
    )
    agg = agg.merge(skuagg, on="potentialType", how="left")
    for col in ["productCount", "totalSales", "medianSku", "detailImgs", "skuCount"]:
        agg[f"{col}_n"] = agg[col] / (agg[col].max() or 1)
    agg["priceFit"] = agg["medianMin"].apply(lambda x: 1.0 if 8 <= x <= 80 else (0.75 if x < 8 or x <= 150 else 0.45))
    agg["score"] = (
        agg["totalSales_n"] * 0.35
        + agg["productCount_n"] * 0.20
        + agg["medianSku_n"] * 0.15
        + agg["detailImgs_n"] * 0.10
        + agg["skuCount_n"] * 0.10
        + agg["priceFit"] * 0.10
    )
    agg = agg[agg["score"].notna()].sort_values("score", ascending=False)

    rows = []
    for _, r in agg.head(10).iterrows():
        product_type = r["potentialType"]
        cand = products[(products["potentialType"] == product_type) & products["minWholesalePrice"].notna()].copy()
        if cand.empty:
            continue
        cand["pickScore"] = cand["sales"] * 0.6 + cand["skuCount"] * 80 + cand["detailImageCount"] * 40
        picked = cand.sort_values("pickScore", ascending=False).iloc[0]

        active = sku2[sku2["goodsId"] == picked["goodsId"]].sort_values("sourceWholesaleYuan")
        if "stock" in active.columns:
            filtered = active[active["stock"].isna() | (active["stock"] != 0)]
            if not filtered.empty:
                active = filtered
        active = active[active["suggestPddPriceYuan"].notna()]
        if active.empty:
            continue
        price_min = active["suggestPddPriceYuan"].min()
        price_max = active["suggestPddPriceYuan"].max()
        specs = list(active["cleanSpec"].dropna().astype(str).head(4))
        reason, position = REASON_MAP.get(product_type, ("需求存在，需用价格和素材测试。", "小批量测试。"))

        rows.append(
            {
                "排名": len(rows) + 1,
                "潜力产品类型": product_type,
                "机会理由": reason,
                "建议定位": position,
                "商品数": int(r["productCount"]),
                "类目销量合计": int(r["totalSales"]),
                "源价格中位数": round(float(r["medianMin"]), 2),
                "建议售价带": f"{price_min:.1f}-{price_max:.1f}元",
                "代表源商品ID": str(picked["goodsId"]),
                "代表标题": picked["title"],
                "可选SKU示例": "；".join(specs),
                "综合分": round(float(r["score"]) * 100, 1),
            }
        )

    result = pd.DataFrame(rows)
    xlsx_path = OUT_DIR / "top10_potential_products.xlsx"
    md_path = OUT_DIR / "top10_potential_products.md"
    result.to_excel(xlsx_path, index=False)
    md_path.write_text(
        "# 最有潜力的 10 类产品\n\n"
        "筛选依据：类目销量、同类商品数、SKU 完整度、价格带适配、详情图素材数量。\n\n"
        + result.to_markdown(index=False),
        encoding="utf-8",
    )
    print(result[["排名", "潜力产品类型", "商品数", "类目销量合计", "源价格中位数", "建议售价带", "综合分", "代表源商品ID"]].to_string(index=False))
    print(f"\n输出：{xlsx_path}")
    print(f"输出：{md_path}")


if __name__ == "__main__":
    main()
