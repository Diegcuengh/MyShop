import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
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
  run_id?: string
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
  image_local_file?: string
  goods_url?: string
  detail_file?: string
  rank?: number
  sales_tip_amount?: number
  min_wholesale_price_yuan?: number
  max_wholesale_price_yuan?: number
  sku_count?: number
  skus?: Array<{
    sku_id?: string
    specs?: Array<{ key?: string; value?: string }>
    group_price_yuan?: number
    wholesale_price_yuan?: number
    quantity?: number | null
    piece?: number | null
    thumb_url?: string
  }>
  raw_detail?: {
    queryGoodsDetail?: {
      result?: {
        salesTipAmount?: string | number
      }
    }
    queryGoodsShareInfo?: {
      result?: {
        salesTipAmount?: string | number
      }
    }
    queryGoodsReviewList?: {
      result?: {
        total?: number
        totalText?: string
      }
    }
  }
  raw_search_item?: {
    mallUrl?: string
    storeHref?: string
    _mallUrl?: string
    _displayIndex?: number
    _source?: string
  }
}

type CrawlRun = {
  run_id: string
  folder?: string
}

function serializeSku(sku: NonNullable<SnapshotProduct['skus']>[number]) {
  return {
    skuId: sku.sku_id ?? '',
    specs: (sku.specs ?? []).map((spec) => ({
      key: spec.key ?? '',
      value: spec.value ?? ''
    })),
    groupPriceYuan: sku.group_price_yuan ?? null,
    wholesalePriceYuan: sku.wholesale_price_yuan ?? null,
    quantity: sku.quantity ?? null,
    piece: sku.piece ?? null,
    thumbUrl: sku.thumb_url ?? ''
  }
}

function buildLocalImageUrl(product: SnapshotProduct) {
  if (!product.run_id || !product.image_local_file) {
    return ''
  }

  const params = new URLSearchParams({
    runId: product.run_id,
    path: product.image_local_file
  })

  return `/api/assets/image?${params.toString()}`
}

function buildLocalDetailUrl(product: SnapshotProduct) {
  if (!product.run_id || !product.goods_id || !product.detail_file) {
    return ''
  }

  const params = new URLSearchParams({
    runId: product.run_id,
    goodsId: product.goods_id
  })

  return `/api/assets/detail?${params.toString()}`
}

function parseHumanAmount(value: string | number | undefined) {
  if (typeof value === 'number') {
    return value
  }

  if (!value) {
    return null
  }

  const normalizedText = value.replace(/,/g, '').trim()
  const numericPart = normalizedText.match(/\d+(?:\.\d+)?/)?.[0]

  if (!numericPart) {
    return null
  }

  const parsed = Number(numericPart)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return normalizedText.includes('万') ? Math.round(parsed * 10000) : Math.round(parsed)
}

function getSalesTipAmount(product: SnapshotProduct) {
  return (
    parseHumanAmount(product.raw_detail?.queryGoodsDetail?.result?.salesTipAmount) ??
    parseHumanAmount(product.raw_detail?.queryGoodsShareInfo?.result?.salesTipAmount) ??
    product.sales_tip_amount ??
    null
  )
}

function getCommentCount(product: SnapshotProduct) {
  const total = product.raw_detail?.queryGoodsReviewList?.result?.total
  const totalText = product.raw_detail?.queryGoodsReviewList?.result?.totalText

  if (totalText) {
    const parsed = parseHumanAmount(totalText)

    if (parsed !== null) {
      return parsed
    }
  }

  if (typeof total === 'number') {
    return total
  }

  return null
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
    salesTipAmount: getSalesTipAmount(point) ?? 0,
    product: serializeSnapshotProduct(point)
  }
}

function serializeSnapshotProduct(product: SnapshotProduct) {
  return {
    goodsId: product.goods_id,
    title: product.title ?? '',
    shopName: product.shop_name ?? '',
    mallUrl: getMallUrl(product),
    imageUrl: buildLocalImageUrl(product),
    imageLocalFile: product.image_local_file ?? '',
    detailFile: product.detail_file ?? '',
    detailUrl: buildLocalDetailUrl(product),
    goodsUrl: product.goods_url ?? '',
    rank: product.rank ?? null,
    displayIndex: product.raw_search_item?._displayIndex ?? null,
    source: product.raw_search_item?._source ?? '',
    salesTipAmount: getSalesTipAmount(product),
    commentCount: getCommentCount(product),
    minWholesalePriceYuan: product.min_wholesale_price_yuan ?? null,
    maxWholesalePriceYuan: product.max_wholesale_price_yuan ?? null,
    skuCount: product.sku_count ?? null,
    skus: (product.skus ?? []).map(serializeSku)
  }
}

function serializeComparableProduct(product: SnapshotProduct) {
  return {
    rank: product.rank ?? null,
    displayIndex: product.raw_search_item?._displayIndex ?? null,
    source: product.raw_search_item?._source ?? '',
    salesTipAmount: getSalesTipAmount(product),
    minWholesalePriceYuan: product.min_wholesale_price_yuan ?? null,
    maxWholesalePriceYuan: product.max_wholesale_price_yuan ?? null
  }
}

function getShopKey(product: SnapshotProduct) {
  const mallUrl = product.mall?.mall_url ?? ''
  const mallUrlMid = mallUrl.match(/[?&]mid=([^&]+)/)?.[1] ?? ''

  return product.mall?.mall_id || mallUrlMid || product.mall?.real_mall_id || product.shop_name || ''
}

function getMallUrl(product: SnapshotProduct) {
  return (
    product.mall?.mall_url ||
    product.raw_search_item?.mallUrl ||
    product.raw_search_item?.storeHref ||
    product.raw_search_item?._mallUrl ||
    ''
  )
}

function serializeShopProduct(product: SnapshotProduct) {
  return {
    goodsId: product.goods_id,
    title: product.title ?? '',
    rank: product.rank ?? null,
    salesTipAmount: getSalesTipAmount(product),
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
    mallUrl: getMallUrl(first),
    productCount: products.length,
    topRank: productsSortedByRank[0]?.rank ?? null,
    totalSalesTipAmount: products.reduce((total, product) => total + (getSalesTipAmount(product) ?? 0), 0),
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
  app.get('/api/assets/image', async (request, reply) => {
    const query = request.query as { runId?: string; path?: string }

    if (!query.runId || !query.path || path.isAbsolute(query.path) || query.path.includes('..')) {
      return reply.status(400).send({ error: 'Invalid image path' })
    }

    const db = await getTrendsDb()
    const run = await db.collection<CrawlRun>('crawl_runs').findOne({ run_id: query.runId })

    if (!run?.folder) {
      return reply.status(404).send({ error: 'Run folder not found' })
    }

    const normalizedRelativePath = query.path.replace(/[\\/]+/g, path.sep)
    const runFolder = path.resolve(run.folder)
    const dataFolder = path.dirname(runFolder)
    const candidates = [
      path.resolve(runFolder, normalizedRelativePath),
      path.resolve(dataFolder, normalizedRelativePath)
    ]
    const imagePath = candidates.find((candidate) => {
      const insideRunFolder = candidate.startsWith(runFolder + path.sep)
      const insideDataFolder = candidate.startsWith(dataFolder + path.sep)

      return (insideRunFolder || insideDataFolder) && existsSync(candidate)
    })

    if (!imagePath) {
      return reply.status(404).send({ error: 'Image not found' })
    }

    const extension = path.extname(imagePath).toLowerCase()
    const contentType =
      extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : extension === '.gif'
            ? 'image/gif'
            : 'image/jpeg'

    return reply.type(contentType).send(createReadStream(imagePath))
  })

  app.get('/api/assets/detail', async (request, reply) => {
    const query = request.query as { runId?: string; goodsId?: string }

    if (!query.runId || !query.goodsId) {
      return reply.status(400).send({ error: 'Invalid detail request' })
    }

    const db = await getTrendsDb()
    const product = await db
      .collection<SnapshotProduct>('goods_snapshots')
      .findOne({ run_id: query.runId, goods_id: query.goodsId }, { projection: { detail_file: 1 } })

    if (!product?.detail_file || !path.isAbsolute(product.detail_file) || product.detail_file.includes('..')) {
      return reply.status(404).send({ error: 'Detail file not found' })
    }

    const detailPath = path.resolve(product.detail_file)
    const run = await db.collection<CrawlRun>('crawl_runs').findOne({ run_id: query.runId })

    if (run?.folder) {
      const runFolder = path.resolve(run.folder)

      if (!detailPath.startsWith(runFolder + path.sep)) {
        return reply.status(403).send({ error: 'Detail file is outside run folder' })
      }
    }

    if (!existsSync(detailPath)) {
      return reply.status(404).send({ error: 'Detail file not found' })
    }

    return reply.type('application/json; charset=utf-8').send(createReadStream(detailPath))
  })

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
    const snapshots = (await db
      .collection<SnapshotProduct & { run_id: string; keyword: string; crawl_time: Date }>('goods_snapshots')
      .find()
      .project({
        run_id: 1,
        keyword: 1,
        crawl_time: 1,
        sales_tip_amount: 1,
        raw_detail: 1
      })
      .toArray()
    ) as Array<SnapshotProduct & { run_id: string; keyword: string; crawl_time: Date }>
    const runMap = new Map<string, TotalSalesTrend>()

    for (const snapshot of snapshots) {
      const point = runMap.get(snapshot.run_id) ?? {
        runId: snapshot.run_id,
        keyword: snapshot.keyword,
        crawlTime: snapshot.crawl_time,
        totalSales: 0
      }
      point.totalSales += getSalesTipAmount(snapshot) ?? 0
      runMap.set(snapshot.run_id, point)
    }

    const points = [...runMap.values()].sort((a, b) => a.crawlTime.getTime() - b.crawlTime.getTime())

    return points.map(serializeTotalSalesTrendPoint)
  })

  app.get('/api/trends/top-sales', async () => {
    const db = await getTrendsDb()
    const snapshots = (await db
      .collection<TopSalesTrend>('goods_snapshots')
      .find()
      .project({
        run_id: 1,
        keyword: 1,
        crawl_time: 1,
        goods_id: 1,
        title: 1,
        shop_name: 1,
        mall: 1,
        raw_search_item: 1,
        image_url: 1,
        image_local_file: 1,
        detail_file: 1,
        goods_url: 1,
        rank: 1,
        sales_tip_amount: 1,
        raw_detail: 1,
        min_wholesale_price_yuan: 1,
        max_wholesale_price_yuan: 1,
        sku_count: 1,
        skus: 1
      })
      .toArray()
    ) as TopSalesTrend[]
    const runMap = new Map<string, TopSalesTrend>()

    for (const snapshot of snapshots) {
      const current = runMap.get(snapshot.run_id)
      const snapshotSales = getSalesTipAmount(snapshot) ?? -1
      const currentSales = current ? getSalesTipAmount(current) ?? -1 : -1

      if (
        !current ||
        snapshotSales > currentSales ||
        (snapshotSales === currentSales && (snapshot.rank ?? Number.MAX_SAFE_INTEGER) < (current.rank ?? Number.MAX_SAFE_INTEGER))
      ) {
        runMap.set(snapshot.run_id, snapshot)
      }
    }

    const points = [...runMap.values()].sort((a, b) => a.crawl_time.getTime() - b.crawl_time.getTime())

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
        run_id: 1,
        goods_id: 1,
        title: 1,
        shop_name: 1,
        mall: 1,
        raw_search_item: 1,
        image_url: 1,
        image_local_file: 1,
        detail_file: 1,
        goods_url: 1,
        rank: 1,
        sales_tip_amount: 1,
        raw_detail: 1,
        min_wholesale_price_yuan: 1,
        max_wholesale_price_yuan: 1,
        sku_count: 1,
        skus: 1
      })
      .toArray()) as SnapshotProduct[]
    const currentProducts = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: currentRun.run_id })
      .project({
        run_id: 1,
        goods_id: 1,
        title: 1,
        shop_name: 1,
        mall: 1,
        raw_search_item: 1,
        image_url: 1,
        image_local_file: 1,
        detail_file: 1,
        goods_url: 1,
        rank: 1,
        sales_tip_amount: 1,
        raw_detail: 1,
        min_wholesale_price_yuan: 1,
        max_wholesale_price_yuan: 1,
        sku_count: 1,
        skus: 1
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
      run_id: 1,
      goods_id: 1,
      title: 1,
      shop_name: 1,
      mall: 1,
      raw_search_item: 1,
      image_url: 1,
      image_local_file: 1,
      detail_file: 1,
      goods_url: 1,
      rank: 1,
      sales_tip_amount: 1,
      raw_detail: 1,
      min_wholesale_price_yuan: 1,
      max_wholesale_price_yuan: 1,
      sku_count: 1,
      skus: 1
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

        const previousSales = getSalesTipAmount(previousProduct)
        const currentSales = getSalesTipAmount(currentProduct)
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
          mallUrl: getMallUrl(currentProduct) || getMallUrl(previousProduct),
          displayIndex: currentProduct.raw_search_item?._displayIndex ?? previousProduct.raw_search_item?._displayIndex ?? null,
          source: currentProduct.raw_search_item?._source ?? previousProduct.raw_search_item?._source ?? '',
          imageUrl: buildLocalImageUrl(currentProduct) || buildLocalImageUrl(previousProduct),
          imageLocalFile: currentProduct.image_local_file || previousProduct.image_local_file || '',
          detailFile: currentProduct.detail_file || previousProduct.detail_file || '',
          detailUrl: buildLocalDetailUrl(currentProduct) || buildLocalDetailUrl(previousProduct),
          goodsUrl: currentProduct.goods_url || previousProduct.goods_url || '',
          skuCount: currentProduct.sku_count ?? previousProduct.sku_count ?? null,
          skus: (currentProduct.skus ?? previousProduct.skus ?? []).map(serializeSku),
          commentCount: getCommentCount(currentProduct) ?? getCommentCount(previousProduct),
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

  app.get('/api/trends/product-list', async (request) => {
    const db = await getTrendsDb()
    const compareRuns = await resolveCompareRuns(db, request.query)

    if (!compareRuns) {
      return {
        currentRun: null,
        products: []
      }
    }

    const { currentRun } = compareRuns
    const products = (await db
      .collection<SnapshotProduct>('goods_snapshots')
      .find({ run_id: currentRun.run_id })
      .project({
        run_id: 1,
        goods_id: 1,
        title: 1,
        shop_name: 1,
        mall: 1,
        raw_search_item: 1,
        image_url: 1,
        image_local_file: 1,
        detail_file: 1,
        goods_url: 1,
        rank: 1,
        sales_tip_amount: 1,
        raw_detail: 1,
        min_wholesale_price_yuan: 1,
        max_wholesale_price_yuan: 1,
        sku_count: 1,
        skus: 1
      })
      .sort({ rank: 1, sales_tip_amount: -1 })
      .toArray()) as SnapshotProduct[]

    return {
      currentRun: {
        runId: currentRun.run_id,
        keyword: currentRun.keyword,
        crawlTime: currentRun.crawl_time.toISOString()
      },
      products: products.map(serializeSnapshotProduct)
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
      raw_search_item: 1,
      rank: 1,
      sales_tip_amount: 1,
      raw_detail: 1,
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
