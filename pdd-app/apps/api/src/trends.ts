import type { FastifyInstance } from 'fastify'
import { getTrendsDb } from './db.js'

type ProductCountTrend = {
  runId: string
  keyword: string
  crawlTime: Date
  productCount: number
}

type SnapshotProduct = {
  goods_id: string
  title?: string
  shop_name?: string
  image_url?: string
  goods_url?: string
  rank?: number
  sales_tip_amount?: number
  min_wholesale_price_yuan?: number
  max_wholesale_price_yuan?: number
  sku_count?: number
}

function serializeTrendPoint(point: ProductCountTrend) {
  return {
    runId: point.runId,
    keyword: point.keyword,
    crawlTime: point.crawlTime.toISOString(),
    productCount: point.productCount
  }
}

function serializeSnapshotProduct(product: SnapshotProduct) {
  return {
    goodsId: product.goods_id,
    title: product.title ?? '',
    shopName: product.shop_name ?? '',
    imageUrl: product.image_url ?? '',
    goodsUrl: product.goods_url ?? '',
    rank: product.rank ?? null,
    salesTipAmount: product.sales_tip_amount ?? null,
    minWholesalePriceYuan: product.min_wholesale_price_yuan ?? null,
    maxWholesalePriceYuan: product.max_wholesale_price_yuan ?? null,
    skuCount: product.sku_count ?? null
  }
}

export async function registerTrendRoutes(app: FastifyInstance) {
  app.get('/api/trends/product-count', async () => {
    const db = await getTrendsDb()
    const points = await db
      .collection('goods_snapshots')
      .aggregate<ProductCountTrend>([
        {
          $group: {
            _id: '$run_id',
            runId: { $first: '$run_id' },
            keyword: { $first: '$keyword' },
            crawlTime: { $first: '$crawl_time' },
            productCount: { $sum: 1 }
          }
        },
        { $sort: { crawlTime: 1 } },
        {
          $project: {
            _id: 0,
            runId: 1,
            keyword: 1,
            crawlTime: 1,
            productCount: 1
          }
        }
      ])
      .toArray()

    return points.map(serializeTrendPoint)
  })

  app.get('/api/trends/product-diff', async () => {
    const db = await getTrendsDb()
    const runs = await db
      .collection('crawl_runs')
      .find()
      .sort({ crawl_time: -1 })
      .limit(2)
      .toArray()

    if (runs.length < 2) {
      return {
        previousRun: null,
        currentRun: null,
        removed: [],
        added: []
      }
    }

    const [currentRun, previousRun] = runs
    const previousProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: previousRun.run_id })
      .project({
        goods_id: 1,
        title: 1,
        shop_name: 1,
        image_url: 1,
        goods_url: 1,
        rank: 1,
        sales_tip_amount: 1,
        min_wholesale_price_yuan: 1,
        max_wholesale_price_yuan: 1,
        sku_count: 1
      })
      .toArray()) as SnapshotProduct[]
    const currentProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: currentRun.run_id })
      .project({
        goods_id: 1,
        title: 1,
        shop_name: 1,
        image_url: 1,
        goods_url: 1,
        rank: 1,
        sales_tip_amount: 1,
        min_wholesale_price_yuan: 1,
        max_wholesale_price_yuan: 1,
        sku_count: 1
      })
      .toArray()) as SnapshotProduct[]

    const previousById = new Map(previousProducts.map((product) => [product.goods_id, product]))
    const currentById = new Map(currentProducts.map((product) => [product.goods_id, product]))
    const removed = previousProducts
      .filter((product) => !currentById.has(product.goods_id))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
      .map(serializeSnapshotProduct)
    const added = currentProducts
      .filter((product) => !previousById.has(product.goods_id))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
      .map(serializeSnapshotProduct)

    return {
      previousRun: {
        runId: previousRun.run_id,
        keyword: previousRun.keyword,
        crawlTime: previousRun.crawl_time.toISOString()
      },
      currentRun: {
        runId: currentRun.run_id,
        keyword: currentRun.keyword,
        crawlTime: currentRun.crawl_time.toISOString()
      },
      removed,
      added
    }
  })
}
