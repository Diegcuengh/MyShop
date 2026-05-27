# -*- coding: utf-8 -*-
"""
Import Pinduoduo crawl snapshots into MongoDB for sales trend analysis.

Data model:
  pdd_sales_trends.crawl_runs
    One document per crawl folder/search snapshot.

  pdd_sales_trends.goods
    One document per goodsId, updated with latest known static attributes.

  pdd_sales_trends.goods_snapshots
    One document per (run, goodsId). This is the main trend collection.

  pdd_sales_trends.sku_snapshots
    One document per (run, goodsId, skuId), for SKU price trend analysis.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import ASCENDING, DESCENDING, MongoClient, ReplaceOne, UpdateOne


DEFAULT_DATA_ROOT = Path(r"E:\ds电商\data")
DEFAULT_MONGO_URI = "mongodb://localhost:27017/"
DEFAULT_DB = "pdd_sales_trends"
BATCH_SIZE = 500
DB_STATUS_KEY = "DB_status"
SCRIPT_VERSION = "2026.05.27.4"


class ChineseHelpFormatter(argparse.ArgumentDefaultsHelpFormatter, argparse.RawDescriptionHelpFormatter):
    def start_section(self, heading: str | None) -> None:
        headings = {
            "positional arguments": "位置参数",
            "options": "选项",
            "optional arguments": "选项",
        }
        super().start_section(headings.get(heading, heading))

    def _get_help_string(self, action: argparse.Action) -> str:
        help_text = action.help or ""
        if "%(default)" not in help_text and action.default not in (argparse.SUPPRESS, None, False):
            help_text += "（默认：%(default)s）"
        return help_text


class ChineseArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        message = message.replace("the following arguments are required:", "缺少必填参数：")
        self.print_usage()
        self.exit(2, f"{self.prog}: 错误: {message}\n")


def parse_folder_name(name: str) -> tuple[str, str | None, datetime | None]:
    match = re.match(r"^(.+?)_(\d{8}_\d{6})$", name)
    if not match:
        return name, None, None

    keyword = match.group(1)
    stamp = match.group(2)
    crawl_time = datetime.strptime(stamp, "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
    return keyword, stamp, crawl_time


def parse_iso_datetime(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_json(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")


def as_str(value: Any) -> str:
    return "" if value is None else str(value)


def as_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        digits = re.sub(r"[^\d-]", "", value)
        if not digits or digits == "-":
            return None
        return int(digits)
    return None


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"true", "yes", "y", "1", "是"}:
        return True
    if normalized in {"false", "no", "n", "0", "否"}:
        return False
    raise argparse.ArgumentTypeError("必须填写 true 或 false。")


def cents_to_yuan(value: Any) -> float | None:
    number = as_int(value)
    if number is None:
        return None
    return round(number / 100, 2)


def get_nested(obj: dict[str, Any], *keys: str) -> Any:
    cur: Any = obj
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def compact_sku(sku: dict[str, Any]) -> dict[str, Any]:
    specs = sku.get("skuSpecs") or []
    return {
        "sku_id": as_str(sku.get("skuId")),
        "specs": [
            {
                "key": item.get("specKey"),
                "value": item.get("specValue"),
            }
            for item in specs
            if isinstance(item, dict)
        ],
        "group_price_cents": as_int(sku.get("groupPrice")),
        "group_price_yuan": cents_to_yuan(sku.get("groupPrice")),
        "wholesale_price_cents": as_int(sku.get("wholesalePrice")),
        "wholesale_price_yuan": cents_to_yuan(sku.get("wholesalePrice")),
        "quantity": as_int(sku.get("quantity")),
        "piece": as_int(sku.get("piece")),
        "thumb_url": sku.get("thumbUrl"),
        "thumb_local_file": sku.get("thumbUrl_localFile"),
    }


def discover_runs(data_root: Path, only_dir: str | None = None) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    for folder in sorted(data_root.iterdir(), key=lambda p: p.name):
        if not folder.is_dir() or not (folder / "goods").is_dir():
            continue
        if only_dir and folder.name != only_dir:
            continue

        keyword, folder_stamp, folder_time = parse_folder_name(folder.name)
        search_file = folder / "_搜索结果.json"
        list_file = folder / f"{keyword}_商品数据.json"

        search_meta: dict[str, Any] = {}
        if search_file.exists():
            search_meta = load_json(search_file)
        crawl_time = parse_iso_datetime(search_meta.get("createdAt")) or folder_time

        runs.append(
            {
                "run_id": folder.name,
                "folder": folder,
                "keyword": search_meta.get("keyword") or keyword,
                "folder_stamp": folder_stamp,
                "crawl_time": crawl_time,
                "search_file": search_file if search_file.exists() else None,
                "list_file": list_file if list_file.exists() else None,
                "search_meta": search_meta,
            }
        )
    return runs


def run_db_status(run: dict[str, Any]) -> dict[str, Any] | None:
    search_meta = run.get("search_meta")
    if not isinstance(search_meta, dict):
        return None
    status = search_meta.get(DB_STATUS_KEY)
    return status if isinstance(status, dict) else None


def is_run_imported(run: dict[str, Any]) -> bool:
    status = run_db_status(run)
    return bool(status and status.get("status") == "done")


def write_db_status(run: dict[str, Any], args: argparse.Namespace, status_value: str, source: str, error: str | None = None) -> None:
    search_file = run.get("search_file")
    if not search_file:
        return

    data = load_json(search_file)
    if not isinstance(data, dict):
        return

    status = {
        "status": status_value,
        "run_id": run["run_id"],
        "db": args.db,
        "mongo_uri": args.mongo_uri,
        "script": "import_pdd_to_mongo.py",
        "script_version": SCRIPT_VERSION,
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
    }
    if error:
        status["error"] = error
    data[DB_STATUS_KEY] = status

    goods = data.get("goods")
    if isinstance(goods, list):
        for item in goods:
            if isinstance(item, dict):
                item[DB_STATUS_KEY] = status

    save_json(search_file, data)


def search_items_by_goods_id(run: dict[str, Any]) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}

    meta_goods = run["search_meta"].get("goods") if isinstance(run["search_meta"], dict) else None
    if isinstance(meta_goods, list):
        for index, item in enumerate(meta_goods, start=1):
            if isinstance(item, dict) and item.get("goodsId") is not None:
                copied = dict(item)
                copied.setdefault("index", index)
                items[as_str(item.get("goodsId"))] = copied

    list_file = run.get("list_file")
    if list_file:
        for index, item in enumerate(load_json(list_file), start=1):
            if isinstance(item, dict) and item.get("goodsId") is not None:
                gid = as_str(item.get("goodsId"))
                merged = dict(items.get(gid, {}))
                merged.update(item)
                merged.setdefault("index", index)
                items[gid] = merged

    return items


def build_documents(run: dict[str, Any], goods_dir: Path) -> tuple[list[Any], list[Any], list[Any]]:
    goods_ops: list[Any] = []
    snapshot_ops: list[Any] = []
    sku_ops: list[Any] = []
    now = datetime.now(timezone.utc)

    search_items = search_items_by_goods_id(run)
    detail_dirs = [p for p in goods_dir.iterdir() if p.is_dir()]

    for detail_dir in sorted(detail_dirs, key=lambda p: p.name):
        detail_path = detail_dir / "detail.json"
        if not detail_path.exists():
            continue

        raw = load_json(detail_path)
        result = get_nested(raw, "queryGoodsDetail", "result") or {}
        prop_result = get_nested(raw, "queryGoodsPropertyInfo", "result") or {}

        goods_id = as_str(result.get("goodsId") or prop_result.get("goodsId") or detail_dir.name)
        search_item = search_items.get(goods_id, {})
        mall_card = result.get("mallCard") or {}
        skus = result.get("goodsSkuInfos") or []
        compact_skus = [compact_sku(sku) for sku in skus if isinstance(sku, dict)]
        title = result.get("goodsName") or search_item.get("title") or ""
        crawl_time = run["crawl_time"]
        rank = as_int(search_item.get("index") or search_item.get("_displayIndex"))

        goods_doc_update = {
            "latest_title": title,
            "latest_image_url": result.get("imageUrl") or search_item.get("goodsImageUrl"),
            "latest_image_local_file": result.get("imageUrl_localFile") or search_item.get("goodsImageUrl_localFile"),
            "latest_goods_url": search_item.get("goodsUrl"),
            "latest_mall": {
                "mall_id": as_str(mall_card.get("mallId")),
                "real_mall_id": as_str(mall_card.get("realMallId")),
                "mall_name": mall_card.get("mallName") or search_item.get("shopName"),
                "mall_logo": mall_card.get("mallLogo"),
                "mall_url": search_item.get("mallUrl"),
            },
            "latest_address": search_item.get("address"),
            "latest_keyword": run["keyword"],
            "last_seen_at": crawl_time,
            "updated_at": now,
        }

        goods_ops.append(
            UpdateOne(
                {"_id": goods_id},
                {
                    "$set": goods_doc_update,
                    "$setOnInsert": {
                        "_id": goods_id,
                        "goods_id": goods_id,
                        "first_seen_at": crawl_time,
                        "created_at": now,
                    },
                    "$addToSet": {"keywords": run["keyword"]},
                },
                upsert=True,
            )
        )

        qgd = raw.get("queryGoodsDetail") or {}
        error_code = qgd.get("errorCode", qgd.get("error_code"))
        sales_amount = as_int(result.get("salesTipAmount"))
        snapshot_id = f"{run['run_id']}::{goods_id}"
        snapshot_doc = {
            "_id": snapshot_id,
            "run_id": run["run_id"],
            "keyword": run["keyword"],
            "crawl_time": crawl_time,
            "goods_id": goods_id,
            "rank": rank,
            "title": title,
            "goods_url": search_item.get("goodsUrl"),
            "image_url": result.get("imageUrl") or search_item.get("goodsImageUrl"),
            "image_local_file": result.get("imageUrl_localFile") or search_item.get("goodsImageUrl_localFile"),
            "shop_name": search_item.get("shopName") or mall_card.get("mallName"),
            "address": search_item.get("address"),
            "mall": {
                "mall_id": as_str(mall_card.get("mallId")),
                "real_mall_id": as_str(mall_card.get("realMallId")),
                "mall_name": mall_card.get("mallName") or search_item.get("shopName"),
                "mall_logo": mall_card.get("mallLogo"),
                "mall_url": search_item.get("mallUrl"),
            },
            "sales_tip_amount": sales_amount,
            "min_wholesale_price_cents": as_int(result.get("minWholesalePrice")),
            "min_wholesale_price_yuan": cents_to_yuan(result.get("minWholesalePrice")),
            "max_wholesale_price_cents": as_int(result.get("maxWholesalePrice")),
            "max_wholesale_price_yuan": cents_to_yuan(result.get("maxWholesalePrice")),
            "sku_count": len(compact_skus),
            "skus": compact_skus,
            "service_tags": result.get("goodsServiceTags") or [],
            "property_texts": prop_result.get("goodsPropertyTexts") or [],
            "status": search_item.get("status"),
            "unmatched": bool(search_item.get("_unmatched", False)),
            "detail_error_code": as_int(error_code),
            "detail_success": qgd.get("success"),
            "detail_file": str(detail_path),
            "raw_search_item": search_item,
            "raw_detail": raw,
            "imported_at": now,
        }
        snapshot_ops.append(ReplaceOne({"_id": snapshot_id}, snapshot_doc, upsert=True))

        for sku in compact_skus:
            sku_id = sku.get("sku_id")
            if not sku_id:
                continue
            sku_doc = {
                "_id": f"{run['run_id']}::{goods_id}::{sku_id}",
                "run_id": run["run_id"],
                "keyword": run["keyword"],
                "crawl_time": crawl_time,
                "goods_id": goods_id,
                "sku_id": sku_id,
                "title": title,
                **sku,
                "imported_at": now,
            }
            sku_ops.append(ReplaceOne({"_id": sku_doc["_id"]}, sku_doc, upsert=True))

    return goods_ops, snapshot_ops, sku_ops


def ensure_indexes(db: Any) -> None:
    db.crawl_runs.create_index([("keyword", ASCENDING), ("crawl_time", ASCENDING)])
    db.crawl_runs.create_index([("folder", ASCENDING)])

    db.goods.create_index([("goods_id", ASCENDING)], unique=True)
    db.goods.create_index([("latest_title", "text"), ("latest_mall.mall_name", "text")])
    db.goods.create_index([("last_seen_at", DESCENDING)])

    db.goods_snapshots.create_index([("run_id", ASCENDING), ("goods_id", ASCENDING)], unique=True)
    db.goods_snapshots.create_index([("goods_id", ASCENDING), ("crawl_time", ASCENDING)])
    db.goods_snapshots.create_index([("keyword", ASCENDING), ("crawl_time", ASCENDING), ("rank", ASCENDING)])
    db.goods_snapshots.create_index([("keyword", ASCENDING), ("sales_tip_amount", DESCENDING)])
    db.goods_snapshots.create_index([("crawl_time", ASCENDING)])

    db.sku_snapshots.create_index([("run_id", ASCENDING), ("goods_id", ASCENDING), ("sku_id", ASCENDING)], unique=True)
    db.sku_snapshots.create_index([("goods_id", ASCENDING), ("sku_id", ASCENDING), ("crawl_time", ASCENDING)])
    db.sku_snapshots.create_index([("keyword", ASCENDING), ("crawl_time", ASCENDING)])


def write_ops(collection: Any, ops: list[Any], dry_run: bool) -> int:
    if dry_run or not ops:
        return len(ops)
    for start in range(0, len(ops), BATCH_SIZE):
        collection.bulk_write(ops[start : start + BATCH_SIZE], ordered=False)
    return len(ops)


def import_runs(args: argparse.Namespace) -> None:
    client = MongoClient(args.mongo_uri, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    db = client[args.db]
    ensure_indexes(db)

    data_root = Path(args.data_root)
    only_dir = None if args.dir == "全部" else args.dir
    runs = discover_runs(data_root, only_dir)
    if not runs:
        raise SystemExit(f"No crawl folders found under {data_root}")

    totals = {
        "runs": 0,
        "skipped_runs": 0,
        "goods_ops": 0,
        "snapshot_ops": 0,
        "sku_ops": 0,
    }

    for run in runs:
        if is_run_imported(run):
            totals["skipped_runs"] += 1
            print(f"{run['run_id']}: skipped, DB_status is imported in _搜索结果.json")
            continue

        goods_dir = run["folder"] / "goods"
        search_goods_count = len(run["search_meta"].get("goods", [])) if isinstance(run["search_meta"], dict) else 0
        detail_count = len([p for p in goods_dir.iterdir() if p.is_dir()])

        run_doc = {
            "_id": run["run_id"],
            "run_id": run["run_id"],
            "keyword": run["keyword"],
            "folder": str(run["folder"]),
            "folder_stamp": run["folder_stamp"],
            "crawl_time": run["crawl_time"],
            "source_created_at": parse_iso_datetime(run["search_meta"].get("createdAt")),
            "search_total": as_int(run["search_meta"].get("total")),
            "search_goods_count": search_goods_count,
            "detail_folder_count": detail_count,
            "search_file": str(run["search_file"]) if run["search_file"] else None,
            "list_file": str(run["list_file"]) if run["list_file"] else None,
            "imported_at": datetime.now(timezone.utc),
        }

        goods_ops, snapshot_ops, sku_ops = build_documents(run, goods_dir)

        if not args.dry_run:
            db.crawl_runs.replace_one({"_id": run_doc["_id"]}, run_doc, upsert=True)
        write_ops(db.goods, goods_ops, args.dry_run)
        write_ops(db.goods_snapshots, snapshot_ops, args.dry_run)
        write_ops(db.sku_snapshots, sku_ops, args.dry_run)
        if not args.dry_run:
            write_db_status(run, args, "done", "current_import")

        totals["runs"] += 1
        totals["goods_ops"] += len(goods_ops)
        totals["snapshot_ops"] += len(snapshot_ops)
        totals["sku_ops"] += len(sku_ops)

        print(
            f"{run['run_id']}: goods={len(goods_ops)}, "
            f"snapshots={len(snapshot_ops)}, sku_snapshots={len(sku_ops)}"
        )

    if args.dry_run:
        print("DRY RUN: no MongoDB writes were made.")
    else:
        print("\nMongoDB counts:")
        for name in ["crawl_runs", "goods", "goods_snapshots", "sku_snapshots"]:
            print(f"  {args.db}.{name}: {db[name].count_documents({})}")

    print("\nImported operation totals:")
    for key, value in totals.items():
        print(f"  {key}: {value}")

    client.close()


def main() -> None:
    parser = ChineseArgumentParser(
        description="把拼多多抓取数据导入本地 MongoDB，用于商品销量、排名和 SKU 价格趋势分析。",
        formatter_class=ChineseHelpFormatter,
        usage=(
            "%(prog)s --data_root 目录 --mongo_uri 连接串 --db 库名 "
            "--dir 抓取目录名 --dry_run true|false"
        ),
        add_help=False,
        epilog=(
            "示例:\n"
            "  python import_pdd_to_mongo.py --data_root \"E:\\ds电商\\data\" --mongo_uri \"mongodb://localhost:27017/\" --db pdd_sales_trends --dir \"全部\" --dry_run false\n"
            "  python import_pdd_to_mongo.py --data_root \"E:\\ds电商\\data\" --mongo_uri \"mongodb://localhost:27017/\" --db pdd_sales_trends --dir \"泰山 石敢当_20260526_115329\" --dry_run false\n"
            "  python import_pdd_to_mongo.py --data_root \"E:\\ds电商\\data\" --mongo_uri \"mongodb://localhost:27017/\" --db pdd_sales_trends --dir \"全部\" --dry_run true"
        ),
    )
    parser.add_argument("--help", action="help", help="显示帮助信息并退出。")
    parser.add_argument("--version", action="version", version=f"%(prog)s {SCRIPT_VERSION}", help="显示脚本版本号并退出。")
    parser.add_argument("--data_root", required=True, metavar="目录", help="抓取数据根目录，下面应包含每次抓取的子目录。常用值：E:\\ds电商\\data")
    parser.add_argument("--mongo_uri", required=True, metavar="连接串", help="MongoDB 连接地址。常用值：mongodb://localhost:27017/")
    parser.add_argument("--db", required=True, metavar="库名", help="要写入的 MongoDB 数据库名。常用值：pdd_sales_trends")
    parser.add_argument("--dir", required=True, metavar="抓取目录名", help="导入范围。填写某个抓取子目录完整名称；填写“全部”表示导入所有抓取目录。")
    parser.add_argument("--dry_run", required=True, type=parse_bool, metavar="true|false", help="是否只解析并统计、不写入 MongoDB。true=不写入，false=写入。")
    args = parser.parse_args()
    import_runs(args)


if __name__ == "__main__":
    main()
