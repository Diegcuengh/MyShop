import type { FastifyInstance } from 'fastify'
import { getTrendsDb } from './db.js'

type ProductCountTrend = {
  runId: string
  keyword: string
  crawlTime: Date
  productCount: number
}

type ShopCountTrend = {
  runId: string
  keyword: string
  crawlTime: Date
  shopCount: number
}

type TotalSalesTrend = {
  runId: string
  keyword: string
  crawlTime: Date
  totalSales: number
}

type TopSalesTrend = SnapshotProduct & {
  run_id: string
  keyword: string
  crawl_time: Date
}

type SnapshotProduct = {
  goods_id: string
  title?: string
  shop_name?: string
  mall?: {
    real_mall_id?: string
    mall_id?: string
    mall_name?: string
    mall_logo?: string
    mall_url?: string
  }
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

function serializeShopTrendPoint(point: ShopCountTrend) {
  return {
    runId: point.runId,
    keyword: point.keyword,
    crawlTime: point.crawlTime.toISOString(),
    shopCount: point.shopCount
  }
}

function serializeTotalSalesTrendPoint(point: TotalSalesTrend) {
  return {
    runId: point.runId,
    keyword: point.keyword,
    crawlTime: point.crawlTime.toISOString(),
    totalSales: point.totalSales
  }
}

function serializeTopSalesTrendPoint(point: TopSalesTrend) {
  return {
    runId: point.run_id,
    keyword: point.keyword,
    crawlTime: point.crawl_time.toISOString(),
    salesTipAmount: point.sales_tip_amount ?? 0,
    product: serializeSnapshotProduct(point)
  }
}

function serializeSnapshotProduct(product: SnapshotProduct) {
  return {
    goodsId: product.goods_id,
    title: product.title ?? '',
    shopName: product.shop_name ?? '',
    mallUrl: product.mall?.mall_url ?? '',
    imageUrl: product.image_url ?? '',
    goodsUrl: product.goods_url ?? '',
    rank: product.rank ?? null,
    salesTipAmount: product.sales_tip_amount ?? null,
    minWholesalePriceYuan: product.min_wholesale_price_yuan ?? null,
    maxWholesalePriceYuan: product.max_wholesale_price_yuan ?? null,
    skuCount: product.sku_count ?? null
  }
}

function serializeComparableProduct(product: SnapshotProduct) {
  return {
    rank: product.rank ?? null,
    salesTipAmount: product.sales_tip_amount ?? null,
    minWholesalePriceYuan: product.min_wholesale_price_yuan ?? null,
    maxWholesalePriceYuan: product.max_wholesale_price_yuan ?? null
  }
}

function getShopKey(product: SnapshotProduct) {
  const mallUrl = product.mall?.mall_url ?? ''
  const mallUrlMid = mallUrl.match(/[?&]mid=([^&]+)/)?.[1] ?? ''

  return product.mall?.mall_id || mallUrlMid || product.mall?.real_mall_id || product.shop_name || ''
}

function serializeShopProduct(product: SnapshotProduct) {
  return {
    goodsId: product.goods_id,
    title: product.title ?? '',
    rank: product.rank ?? null,
    salesTipAmount: product.sales_tip_amount ?? null,
    minWholesalePriceYuan: product.min_wholesale_price_yuan ?? null,
    maxWholesalePriceYuan: product.max_wholesale_price_yuan ?? null
  }
}

function buildShopDiffItem(products: SnapshotProduct[]) {
  const first = products[0]
  const productsSortedByRank = [...products].sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
  )

  return {
    shopKey: getShopKey(first),
    shopName: first.mall?.mall_name || first.shop_name || '',
    mallLogo: first.mall?.mall_logo || '',
    mallUrl: first.mall?.mall_url || '',
    productCount: products.length,
    topRank: productsSortedByRank[0]?.rank ?? null,
    totalSalesTipAmount: products.reduce((total, product) => total + (product.sales_tip_amount ?? 0), 0),
    products: productsSortedByRank.slice(0, 6).map(serializeShopProduct)
  }
}

async function resolveCompareRuns(db: Awaited<ReturnType<typeof getTrendsDb>>, query: unknown) {
  const params = query as { previousRunId?: string; currentRunId?: string }

  if (params.previousRunId && params.currentRunId && params.previousRunId !== params.currentRunId) {
    const runs = await db
      .collection('crawl_runs')
      .find({ run_id: { $in: [params.previousRunId, params.currentRunId] } })
      .toArray()
    const previousRun = runs.find((run) => run.run_id === params.previousRunId)
    const currentRun = runs.find((run) => run.run_id === params.currentRunId)

    if (previousRun && currentRun) {
      return { previousRun, currentRun }
    }
  }

  const runs = await db
    .collection('crawl_runs')
    .find()
    .sort({ crawl_time: -1 })
    .limit(2)
    .toArray()

  if (runs.length < 2) {
    return null
  }

  return {
    currentRun: runs[0],
    previousRun: runs[1]
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

  app.get('/api/trends/shop-count', async () => {
    const db = await getTrendsDb()
    const snapshots = (await db
      .collection<SnapshotProduct & { run_id: string; keyword: string; crawl_time: Date }>('goods_snapshots')
      .find()
      .project({
        run_id: 1,
        keyword: 1,
        crawl_time: 1,
        shop_name: 1,
        mall: 1
      })
      .toArray()) as Array<SnapshotProduct & { run_id: string; keyword: string; crawl_time: Date }>
    const runMap = new Map<string, { runId: string; keyword: string; crawlTime: Date; shopKeys: Set<string> }>()

    for (const snapshot of snapshots) {
      const shopKey = getShopKey(snapshot)

      if (!shopKey) {
        continue
      }

      const run = runMap.get(snapshot.run_id) ?? {
        runId: snapshot.run_id,
        keyword: snapshot.keyword,
        crawlTime: snapshot.crawl_time,
        shopKeys: new Set<string>()
      }
      run.shopKeys.add(shopKey)
      runMap.set(snapshot.run_id, run)
    }

    const points = [...runMap.values()]
      .map((run) => ({
        runId: run.runId,
        keyword: run.keyword,
        crawlTime: run.crawlTime,
        shopCount: run.shopKeys.size
      }))
      .sort((a, b) => a.crawlTime.getTime() - b.crawlTime.getTime())

    return points.map(serializeShopTrendPoint)
  })

  app.get('/api/trends/total-sales', async () => {
    const db = await getTrendsDb()
    const points = await db
      .collection('goods_snapshots')
      .aggregate<TotalSalesTrend>([
        {
          $group: {
            _id: '$run_id',
            runId: { $first: '$run_id' },
            keyword: { $first: '$keyword' },
            crawlTime: { $first: '$crawl_time' },
            totalSales: { $sum: { $ifNull: ['$sales_tip_amount', 0] } }
          }
        },
        { $sort: { crawlTime: 1 } },
        {
          $project: {
            _id: 0,
            runId: 1,
            keyword: 1,
            crawlTime: 1,
            totalSales: 1
          }
        }
      ])
      .toArray()

    return points.map(serializeTotalSalesTrendPoint)
  })

  app.get('/api/trends/top-sales', async () => {
    const db = await getTrendsDb()
    const points = await db
      .collection('goods_snapshots')
      .aggregate<TopSalesTrend>([
        {
          $match: {
            sales_tip_amount: { $type: 'number' }
          }
        },
        {
          $sort: {
            run_id: 1,
            sales_tip_amount: -1,
            rank: 1
          }
        },
        {
          $group: {
            _id: '$run_id',
            doc: { $first: '$$ROOT' }
          }
        },
        {
          $replaceRoot: {
            newRoot: '$doc'
          }
        },
        {
          $sort: {
            crawl_time: 1
          }
        }
      ])
      .toArray()

    return points.map(serializeTopSalesTrendPoint)
  })

  app.get('/api/trends/product-diff', async (request) => {
    const db = await getTrendsDb()
    const compareRuns = await resolveCompareRuns(db, request.query)

    if (!compareRuns) {
      return {
        previousRun: null,
        currentRun: null,
        removed: [],
        added: []
      }
    }

    const { currentRun, previousRun } = compareRuns
    const previousProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: previousRun.run_id })
      .project({
        goods_id: 1,
        title: 1,
        shop_name: 1,
        mall: 1,
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
        mall: 1,
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

  app.get('/api/trends/product-overlap', async (request) => {
    const db = await getTrendsDb()
    const compareRuns = await resolveCompareRuns(db, request.query)

    if (!compareRuns) {
      return {
        previousRun: null,
        currentRun: null,
        products: []
      }
    }

    const { currentRun, previousRun } = compareRuns
    const projection = {
      goods_id: 1,
      title: 1,
      shop_name: 1,
      mall: 1,
      image_url: 1,
      goods_url: 1,
      rank: 1,
      sales_tip_amount: 1,
      min_wholesale_price_yuan: 1,
      max_wholesale_price_yuan: 1,
      sku_count: 1
    }
    const previousProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: previousRun.run_id })
      .project(projection)
      .toArray()) as SnapshotProduct[]
    const currentProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: currentRun.run_id })
      .project(projection)
      .toArray()) as SnapshotProduct[]
    const currentById = new Map(currentProducts.map((product) => [product.goods_id, product]))
    const products = previousProducts
      .map((previousProduct) => {
        const currentProduct = currentById.get(previousProduct.goods_id)

        if (!currentProduct) {
          return null
        }

        const previousSales = previousProduct.sales_tip_amount ?? null
        const currentSales = currentProduct.sales_tip_amount ?? null
        const previousRank = previousProduct.rank ?? null
        const currentRank = currentProduct.rank ?? null
        const previousMinPrice = previousProduct.min_wholesale_price_yuan ?? null
        const currentMinPrice = currentProduct.min_wholesale_price_yuan ?? null
        const previousMaxPrice = previousProduct.max_wholesale_price_yuan ?? null
        const currentMaxPrice = currentProduct.max_wholesale_price_yuan ?? null

        return {
          goodsId: previousProduct.goods_id,
          title: currentProduct.title || previousProduct.title || '',
          shopName: currentProduct.shop_name || previousProduct.shop_name || '',
          mallUrl: currentProduct.mall?.mall_url || previousProduct.mall?.mall_url || '',
          imageUrl: currentProduct.image_url || previousProduct.image_url || '',
          goodsUrl: currentProduct.goods_url || previousProduct.goods_url || '',
          skuCount: currentProduct.sku_count ?? previousProduct.sku_count ?? null,
          previous: serializeComparableProduct(previousProduct),
          current: serializeComparableProduct(currentProduct),
          changes: {
            rankDelta: previousRank !== null && currentRank !== null ? currentRank - previousRank : null,
            salesDelta: previousSales !== null && currentSales !== null ? currentSales - previousSales : null,
            minPriceDelta:
              previousMinPrice !== null && currentMinPrice !== null ? Number((currentMinPrice - previousMinPrice).toFixed(2)) : null,
            maxPriceDelta:
              previousMaxPrice !== null && currentMaxPrice !== null ? Number((currentMaxPrice - previousMaxPrice).toFixed(2)) : null
          }
        }
      })
      .filter((product): product is NonNullable<typeof product> => Boolean(product))
      .sort((a, b) => {
        const aSales = Math.abs(a.changes.salesDelta ?? 0)
        const bSales = Math.abs(b.changes.salesDelta ?? 0)

        if (aSales !== bSales) {
          return bSales - aSales
        }

        return (a.current.rank ?? Number.MAX_SAFE_INTEGER) - (b.current.rank ?? Number.MAX_SAFE_INTEGER)
      })

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
      products
    }
  })

  app.get('/api/trends/shop-diff', async (request) => {
    const db = await getTrendsDb()
    const compareRuns = await resolveCompareRuns(db, request.query)

    if (!compareRuns) {
      return {
        previousRun: null,
        currentRun: null,
        removed: [],
        added: []
      }
    }

    const { currentRun, previousRun } = compareRuns
    const projection = {
      goods_id: 1,
      title: 1,
      shop_name: 1,
      mall: 1,
      rank: 1,
      sales_tip_amount: 1,
      min_wholesale_price_yuan: 1,
      max_wholesale_price_yuan: 1
    }
    const previousProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: previousRun.run_id })
      .project(projection)
      .toArray()) as SnapshotProduct[]
    const currentProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: currentRun.run_id })
      .project(projection)
      .toArray()) as SnapshotProduct[]

    const groupByShop = (products: SnapshotProduct[]) => {
      const shops = new Map<string, SnapshotProduct[]>()

      for (const product of products) {
        const shopKey = getShopKey(product)

        if (!shopKey) {
          continue
        }

        shops.set(shopKey, [...(shops.get(shopKey) ?? []), product])
      }

      return shops
    }

    const previousByShop = groupByShop(previousProducts)
    const currentByShop = groupByShop(currentProducts)
    const removed = [...previousByShop.entries()]
      .filter(([shopKey]) => !currentByShop.has(shopKey))
      .map(([, products]) => buildShopDiffItem(products))
      .sort((a, b) => (a.topRank ?? Number.MAX_SAFE_INTEGER) - (b.topRank ?? Number.MAX_SAFE_INTEGER))
    const added = [...currentByShop.entries()]
      .filter(([shopKey]) => !previousByShop.has(shopKey))
      .map(([, products]) => buildShopDiffItem(products))
      .sort((a, b) => (a.topRank ?? Number.MAX_SAFE_INTEGER) - (b.topRank ?? Number.MAX_SAFE_INTEGER))

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
