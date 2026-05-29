<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type ProductCountTrend = {
  runId: string
  keyword: string
  crawlTime: string
  productCount: number
}

type ShopCountTrend = {
  runId: string
  keyword: string
  crawlTime: string
  shopCount: number
}

type TotalSalesTrend = {
  runId: string
  keyword: string
  crawlTime: string
  totalSales: number
}

type TopSalesTrend = {
  runId: string
  keyword: string
  crawlTime: string
  salesTipAmount: number
  product: DiffProduct
}

type TrendMetric = 'product' | 'shop' | 'sales' | 'salesDelta'

type ChartPoint = {
  runId: string
  keyword: string
  crawlTime: string
  value: number
}

type DiffProduct = {
  goodsId: string
  title: string
  shopName: string
  mallUrl: string
  imageUrl: string
  goodsUrl: string
  rank: number | null
  salesTipAmount: number | null
  commentCount: number | null
  minWholesalePriceYuan: number | null
  maxWholesalePriceYuan: number | null
  skuCount: number | null
}

type ProductDiff = {
  previousRun: {
    runId: string
    keyword: string
    crawlTime: string
  } | null
  currentRun: {
    runId: string
    keyword: string
    crawlTime: string
  } | null
  removed: DiffProduct[]
  added: DiffProduct[]
}

type ProductOverlapItem = {
  goodsId: string
  title: string
  shopName: string
  mallUrl: string
  imageUrl: string
  goodsUrl: string
  skuCount: number | null
  commentCount: number | null
  previous: {
    rank: number | null
    salesTipAmount: number | null
    minWholesalePriceYuan: number | null
    maxWholesalePriceYuan: number | null
  }
  current: {
    rank: number | null
    salesTipAmount: number | null
    minWholesalePriceYuan: number | null
    maxWholesalePriceYuan: number | null
  }
  changes: {
    rankDelta: number | null
    salesDelta: number | null
    minPriceDelta: number | null
    maxPriceDelta: number | null
  }
}

type ProductOverlap = {
  previousRun: ProductDiff['previousRun']
  currentRun: ProductDiff['currentRun']
  products: ProductOverlapItem[]
}

type ProductList = {
  currentRun: ProductDiff['currentRun']
  products: DiffProduct[]
}

type ShopDiffProduct = {
  goodsId: string
  title: string
  rank: number | null
  salesTipAmount: number | null
  minWholesalePriceYuan: number | null
  maxWholesalePriceYuan: number | null
}

type DiffShop = {
  shopKey: string
  shopName: string
  mallLogo: string
  mallUrl: string
  productCount: number
  topRank: number | null
  totalSalesTipAmount: number
  products: ShopDiffProduct[]
}

type ShopDiff = {
  previousRun: ProductDiff['previousRun']
  currentRun: ProductDiff['currentRun']
  removed: DiffShop[]
  added: DiffShop[]
}

const productTrendPoints = ref<ProductCountTrend[]>([])
const shopTrendPoints = ref<ShopCountTrend[]>([])
const topSalesTrendPoints = ref<TopSalesTrend[]>([])
const totalSalesTrendPoints = ref<TotalSalesTrend[]>([])
const productDiff = ref<ProductDiff | null>(null)
const productOverlap = ref<ProductOverlap | null>(null)
const productAll = ref<ProductList | null>(null)
const shopDiff = ref<ShopDiff | null>(null)
const selectedMetric = ref<TrendMetric>('product')
const productResultTab = ref<'removed' | 'added' | 'overlap' | 'all'>('removed')
const productSortMode = ref<'rank' | 'sales' | 'comments'>('rank')
const selectedRunIds = ref<string[]>([])
const selectionMode = ref(false)
const openedShopInfoKey = ref('')
const openedShopProductKey = ref('')
const loading = ref(false)
const diffLoading = ref(false)
const error = ref('')
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

const metricLabels: Record<TrendMetric, { title: string; unit: string }> = {
  product: {
    title: '商品数量',
    unit: '个商品'
  },
  shop: {
    title: '店铺数量',
    unit: '个店铺'
  },
  sales: {
    title: '最高销量商品',
    unit: '销量'
  },
  salesDelta: {
    title: '商品总销量增量',
    unit: '销量'
  }
}

const trendPoints = computed<ChartPoint[]>(() => {
  if (selectedMetric.value === 'salesDelta') {
    return totalSalesTrendPoints.value.map((point, index, points) => ({
      runId: point.runId,
      keyword: point.keyword,
      crawlTime: point.crawlTime,
      value: index === 0 ? 0 : point.totalSales - points[index - 1].totalSales
    }))
  }

  if (selectedMetric.value === 'sales') {
    return topSalesTrendPoints.value.map((point) => ({
      runId: point.runId,
      keyword: point.keyword,
      crawlTime: point.crawlTime,
      value: point.salesTipAmount
    }))
  }

  if (selectedMetric.value === 'shop') {
    return shopTrendPoints.value.map((point) => ({
      runId: point.runId,
      keyword: point.keyword,
      crawlTime: point.crawlTime,
      value: point.shopCount
    }))
  }

  return productTrendPoints.value.map((point) => ({
    runId: point.runId,
    keyword: point.keyword,
    crawlTime: point.crawlTime,
    value: point.productCount
  }))
})

const selectedComparePoints = computed(() => {
  return selectedRunIds.value
    .map((runId) => trendPoints.value.find((point) => point.runId === runId))
    .filter((point): point is ChartPoint => Boolean(point))
    .sort((a, b) => new Date(a.crawlTime).getTime() - new Date(b.crawlTime).getTime())
})

const trendSummary = computed(() => {
  const points = selectedComparePoints.value.length === 2 ? selectedComparePoints.value : trendPoints.value
  const first = points[0]
  const last = points[points.length - 1]

  if (!first || !last) {
    return null
  }

  const change = last.value - first.value
  const percent = first.value === 0 ? 0 : (change / first.value) * 100

  return {
    change,
    percent
  }
})

const currentKeyword = computed(() => {
  return trendPoints.value[trendPoints.value.length - 1]?.keyword || productDiff.value?.currentRun?.keyword || '当前关键词'
})

const activeRunDiff = computed(() => {
  if (selectedMetric.value === 'sales') {
    return null
  }

  return selectedMetric.value === 'shop' ? shopDiff.value : productDiff.value
})

function sortBySelectedMode<T extends { rank?: number | null; salesTipAmount?: number | null; commentCount?: number | null }>(products: T[]) {
  return [...products].sort((a, b) => {
    if (productSortMode.value === 'sales') {
      return (b.salesTipAmount ?? -1) - (a.salesTipAmount ?? -1)
    }

    if (productSortMode.value === 'comments') {
      return (b.commentCount ?? -1) - (a.commentCount ?? -1)
    }

    return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
  })
}

const removedProducts = computed(() => sortBySelectedMode(productDiff.value?.removed ?? []))
const addedProducts = computed(() => sortBySelectedMode(productDiff.value?.added ?? []))
const overlapProducts = computed(() =>
  sortBySelectedMode(
    (productOverlap.value?.products ?? []).map((product) => ({
      ...product,
      rank: product.current.rank,
      salesTipAmount: product.current.salesTipAmount
    }))
  )
)
const allProducts = computed(() => sortBySelectedMode(productAll.value?.products ?? []))

const trendChart = computed(() => {
  const width = 720
  const height = 260
  const padding = {
    top: 24,
    right: 28,
    bottom: 48,
    left: 58
  }
  const values = trendPoints.value.map((point) => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const yPadding = Math.max(1, Math.ceil((maxValue - minValue || Math.abs(maxValue) || 1) * 0.2))
  const yMin = minValue < 0 ? minValue - yPadding : Math.max(0, minValue - yPadding)
  const yMax = maxValue + yPadding
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const scaleX = (index: number) =>
    padding.left + (trendPoints.value.length === 1 ? plotWidth / 2 : (index / (trendPoints.value.length - 1)) * plotWidth)
  const scaleY = (value: number) => padding.top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight
  const bottomY = padding.top + plotHeight
  const zeroY = yMin < 0 && yMax > 0 ? scaleY(0) : bottomY

  const points = trendPoints.value.map((point, index) => ({
    ...point,
    selected: selectedRunIds.value.includes(point.runId),
    labelAnchor: index === 0 ? 'start' : index === trendPoints.value.length - 1 ? 'end' : 'middle',
    valueLabelY: scaleY(point.value) > bottomY - 14 ? scaleY(point.value) - 12 : scaleY(point.value) - 12,
    x: scaleX(index),
    y: scaleY(point.value)
  }))

  return {
    width,
    height,
    yMin,
    yMax,
    zeroY,
    bottomY,
    leftX: padding.left,
    rightX: padding.left + plotWidth,
    points,
    linePath: points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  }
})

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message || '请求失败')
  }

  return response.json()
}

function buildCompareQuery() {
  if (selectedRunIds.value.length !== 2) {
    return ''
  }

  const [previousRunId, currentRunId] = [...selectedRunIds.value].sort((a, b) => {
    const aTime = productTrendPoints.value.find((point) => point.runId === a)?.crawlTime ?? ''
    const bTime = productTrendPoints.value.find((point) => point.runId === b)?.crawlTime ?? ''
    return new Date(aTime).getTime() - new Date(bTime).getTime()
  })
  const params = new URLSearchParams({
    previousRunId,
    currentRunId
  })

  return `?${params.toString()}`
}

async function loadDiffs() {
  diffLoading.value = true

  try {
    const query = buildCompareQuery()
    const [diff, overlap, all, shopDiffData] = await Promise.all([
      apiFetch<ProductDiff>(`/api/trends/product-diff${query}`),
      apiFetch<ProductOverlap>(`/api/trends/product-overlap${query}`),
      apiFetch<ProductList>(`/api/trends/product-list${query}`),
      apiFetch<ShopDiff>(`/api/trends/shop-diff${query}`)
    ])
    productDiff.value = diff
    productOverlap.value = overlap
    productAll.value = all
    shopDiff.value = shopDiffData
  } finally {
    diffLoading.value = false
  }
}

async function loadDashboard() {
  loading.value = true
  error.value = ''

  try {
    const [productTrend, shopTrend, topSalesTrend, totalSalesTrend] = await Promise.all([
      apiFetch<ProductCountTrend[]>('/api/trends/product-count'),
      apiFetch<ShopCountTrend[]>('/api/trends/shop-count'),
      apiFetch<TopSalesTrend[]>('/api/trends/top-sales'),
      apiFetch<TotalSalesTrend[]>('/api/trends/total-sales')
    ])
    productTrendPoints.value = productTrend
    shopTrendPoints.value = shopTrend
    topSalesTrendPoints.value = topSalesTrend
    totalSalesTrendPoints.value = totalSalesTrend

    if (productTrend.length >= 2 && selectedRunIds.value.length !== 2) {
      selectedRunIds.value = productTrend.slice(-2).map((point) => point.runId)
    }

    await loadDiffs()
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : '加载数据失败'
  } finally {
    loading.value = false
  }
}

async function toggleRunSelection(runId: string) {
  if (!selectionMode.value) {
    return
  }

  if (selectedRunIds.value.includes(runId)) {
    selectedRunIds.value = selectedRunIds.value.filter((id) => id !== runId)
    return
  }

  selectedRunIds.value = [...selectedRunIds.value, runId].slice(-2)

  if (selectedRunIds.value.length === 2) {
    await loadDiffs()
  }
}

function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value

  if (selectionMode.value) {
    selectedRunIds.value = []
    return
  }

  if (selectedRunIds.value.length !== 2 && productTrendPoints.value.length >= 2) {
    selectedRunIds.value = productTrendPoints.value.slice(-2).map((point) => point.runId)
    void loadDiffs()
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function formatChange(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function formatPrice(product: DiffProduct) {
  const min = product.minWholesalePriceYuan
  const max = product.maxWholesalePriceYuan

  if (min === null && max === null) {
    return '暂无价格'
  }

  if (min !== null && max !== null && min !== max) {
    return `¥${min.toFixed(2)} - ¥${max.toFixed(2)}`
  }

  return `¥${(min ?? max ?? 0).toFixed(2)}`
}

function formatProductPrice(product: ShopDiffProduct) {
  const min = product.minWholesalePriceYuan
  const max = product.maxWholesalePriceYuan

  if (min === null && max === null) {
    return '暂无价格'
  }

  if (min !== null && max !== null && min !== max) {
    return `¥${min.toFixed(2)} - ¥${max.toFixed(2)}`
  }

  return `¥${(min ?? max ?? 0).toFixed(2)}`
}

function formatOverlapPrice(min: number | null, max: number | null) {
  if (min === null && max === null) {
    return '暂无价格'
  }

  if (min !== null && max !== null && min !== max) {
    return `¥${min.toFixed(2)} - ¥${max.toFixed(2)}`
  }

  return `¥${(min ?? max ?? 0).toFixed(2)}`
}

function formatOptionalChange(value: number | null, suffix = '') {
  if (value === null) {
    return '-'
  }

  return `${value > 0 ? '+' : ''}${value}${suffix}`
}

function toggleShopInfo(shopKey: string) {
  openedShopInfoKey.value = openedShopInfoKey.value === shopKey ? '' : shopKey
  openedShopProductKey.value = ''
}

function toggleShopProduct(productKey: string) {
  openedShopProductKey.value = openedShopProductKey.value === productKey ? '' : productKey
}

onMounted(loadDashboard)
</script>

<template>
  <main class="app-shell">
    <section class="toolbar">
      <div>
        <p class="eyebrow">PDD Local MVP</p>
        <h1>抓取商品对比</h1>
      </div>
      <button type="button" class="secondary-button" :disabled="loading" @click="loadDashboard">
        刷新
      </button>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="panel trend-panel">
      <div class="trend-topbar">
        <div class="metric-controls trend-tabs" aria-label="切换趋势指标">
          <button type="button" :class="{ active: selectedMetric === 'product' }" @click="selectedMetric = 'product'">
            商品数量
          </button>
          <button type="button" :class="{ active: selectedMetric === 'shop' }" @click="selectedMetric = 'shop'">
            店铺数量
          </button>
          <button type="button" :class="{ active: selectedMetric === 'sales' }" @click="selectedMetric = 'sales'">
            最高销量商品
          </button>
          <button type="button" :class="{ active: selectedMetric === 'salesDelta' }" @click="selectedMetric = 'salesDelta'">
            总销量增量
          </button>
        </div>
        <button type="button" class="secondary-button compact-button" :class="{ active: selectionMode }" @click="toggleSelectionMode">
          选择模式
        </button>
      </div>

      <div class="panel-heading trend-heading">
        <div>
          <p class="eyebrow">{{ currentKeyword }}</p>
          <h2>{{ metricLabels[selectedMetric].title }}</h2>
        </div>
      </div>

      <div class="trend-summary-row">
        <span v-if="trendSummary">
          {{ formatChange(trendSummary.change) }} {{ metricLabels[selectedMetric].unit }}，{{ trendSummary.percent.toFixed(2) }}%
        </span>
        <span v-if="selectionMode" class="selection-hint">
          已选择 {{ selectedRunIds.length }}/2 个日期
        </span>
      </div>

      <p v-if="loading && trendPoints.length === 0" class="muted">正在加载趋势数据...</p>
      <p v-else-if="trendPoints.length === 0" class="muted">
        暂无趋势数据，请确认 MongoDB 中有 pdd_sales_trends.goods_snapshots。
      </p>

      <div v-else class="trend-chart-wrap">
        <svg
          class="trend-chart"
          :viewBox="`0 0 ${trendChart.width} ${trendChart.height}`"
          role="img"
          :aria-label="`${metricLabels[selectedMetric].title}趋势图`"
        >
          <line :x1="trendChart.leftX" y1="24" :x2="trendChart.leftX" :y2="trendChart.bottomY" class="chart-axis" />
          <line :x1="trendChart.leftX" :y1="trendChart.zeroY" :x2="trendChart.rightX" :y2="trendChart.zeroY" class="chart-axis" />
          <text x="14" y="31" class="chart-label">{{ trendChart.yMax }}</text>
          <text x="14" :y="trendChart.bottomY + 4" class="chart-label">{{ trendChart.yMin }}</text>
          <path :d="trendChart.linePath" class="chart-line" />

          <g
            v-for="point in trendChart.points"
            :key="point.runId"
            :class="['chart-point-group', { selectable: selectionMode }]"
            @click="toggleRunSelection(point.runId)"
          >
            <line :x1="point.x" :y1="trendChart.zeroY" :x2="point.x" :y2="point.y" class="chart-guide" />
            <circle
              :cx="point.x"
              :cy="point.y"
              :r="point.selected ? 7 : 5"
              :class="['chart-dot', { selected: point.selected }]"
              @click.stop="toggleRunSelection(point.runId)"
            />
            <circle
              v-if="selectionMode"
              :cx="point.x"
              :cy="point.y"
              r="22"
              class="chart-hit-area"
              @click.stop="toggleRunSelection(point.runId)"
            />
            <text
              :x="point.x"
              :y="point.valueLabelY"
              :text-anchor="point.labelAnchor"
              class="chart-value"
              @click.stop="toggleRunSelection(point.runId)"
            >
              {{ point.value }}
            </text>
            <text
              :x="point.x"
              y="239"
              :text-anchor="point.labelAnchor"
              class="chart-label"
              @click.stop="toggleRunSelection(point.runId)"
            >
              {{ formatShortDate(point.crawlTime) }}
            </text>
          </g>
        </svg>
      </div>
    </section>

    <section v-if="activeRunDiff?.previousRun && activeRunDiff.currentRun" class="compare-header panel">
      <div>
        <span>对比起点</span>
        <strong>{{ formatDate(activeRunDiff.previousRun.crawlTime) }}</strong>
      </div>
      <div>
        <span>对比终点</span>
        <strong>{{ formatDate(activeRunDiff.currentRun.crawlTime) }}</strong>
      </div>
    </section>

    <p v-if="diffLoading" class="muted">正在更新对比结果...</p>

    <section v-if="selectedMetric === 'product'" class="panel product-result-panel">
      <div class="result-tabs">
        <button type="button" :class="{ active: productResultTab === 'removed' }" @click="productResultTab = 'removed'">
          本次未出现
          <span>{{ productDiff?.removed.length ?? 0 }}</span>
        </button>
        <button type="button" :class="{ active: productResultTab === 'added' }" @click="productResultTab = 'added'">
          本次新出现
          <span>{{ productDiff?.added.length ?? 0 }}</span>
        </button>
        <button type="button" :class="{ active: productResultTab === 'overlap' }" @click="productResultTab = 'overlap'">
          持续存在
          <span>{{ productOverlap?.products.length ?? 0 }}</span>
        </button>
        <button type="button" :class="{ active: productResultTab === 'all' }" @click="productResultTab = 'all'">
          所有商品
          <span>{{ productAll?.products.length ?? 0 }}</span>
        </button>
      </div>

      <div class="product-sort-controls">
        <span>排序</span>
        <button type="button" :class="{ active: productSortMode === 'rank' }" @click="productSortMode = 'rank'">
          按排名排序
        </button>
        <button type="button" :class="{ active: productSortMode === 'comments' }" @click="productSortMode = 'comments'">
          按评论数排序
        </button>
        <button type="button" :class="{ active: productSortMode === 'sales' }" @click="productSortMode = 'sales'">
          按销量排序
        </button>
      </div>

      <section v-if="productResultTab === 'removed'" class="diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">起点有，终点没有</p>
            <h2>本次未出现的商品</h2>
          </div>
          <span>{{ productDiff?.removed.length ?? 0 }} 个</span>
        </div>
        <article v-for="product in removedProducts" :key="product.goodsId" class="diff-card">
          <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.title" loading="lazy" />
          <div class="diff-card-body">
            <div class="diff-card-title">
              <h3>{{ product.title || product.goodsId }}</h3>
              <strong>{{ formatPrice(product) }}</strong>
            </div>
            <p class="muted">商品ID：{{ product.goodsId }} · 排名：{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }} · 评论：{{ product.commentCount ?? '-' }}</p>
            <p class="muted">
              店铺：
              <a v-if="product.mallUrl" class="inline-shop-link" :href="product.mallUrl" target="_blank" rel="noreferrer">
                {{ product.shopName || product.mallUrl }}
              </a>
              <span v-else>{{ product.shopName || '-' }}</span>
              · SKU：{{ product.skuCount ?? '-' }}
            </p>
            <a v-if="product.goodsUrl" :href="product.goodsUrl" target="_blank" rel="noreferrer">打开商品</a>
          </div>
        </article>
      </section>

      <section v-else-if="productResultTab === 'added'" class="diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">终点有，起点没有</p>
            <h2>本次新出现的商品</h2>
          </div>
          <span>{{ productDiff?.added.length ?? 0 }} 个</span>
        </div>
        <article v-for="product in addedProducts" :key="product.goodsId" class="diff-card">
          <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.title" loading="lazy" />
          <div class="diff-card-body">
            <div class="diff-card-title">
              <h3>{{ product.title || product.goodsId }}</h3>
              <strong>{{ formatPrice(product) }}</strong>
            </div>
            <p class="muted">商品ID：{{ product.goodsId }} · 排名：{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }} · 评论：{{ product.commentCount ?? '-' }}</p>
            <p class="muted">
              店铺：
              <a v-if="product.mallUrl" class="inline-shop-link" :href="product.mallUrl" target="_blank" rel="noreferrer">
                {{ product.shopName || product.mallUrl }}
              </a>
              <span v-else>{{ product.shopName || '-' }}</span>
              · SKU：{{ product.skuCount ?? '-' }}
            </p>
            <a v-if="product.goodsUrl" :href="product.goodsUrl" target="_blank" rel="noreferrer">打开商品</a>
          </div>
        </article>
      </section>

      <section v-else-if="productResultTab === 'overlap'" class="diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">起点和终点都存在</p>
            <h2>持续存在的商品</h2>
          </div>
          <span>{{ productOverlap?.products.length ?? 0 }} 个</span>
        </div>
        <article v-for="product in overlapProducts" :key="product.goodsId" class="overlap-card">
          <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.title" loading="lazy" />
          <div class="overlap-card-body">
            <div class="diff-card-title">
              <h3>{{ product.title || product.goodsId }}</h3>
              <strong>{{ formatOptionalChange(product.changes.salesDelta) }} 销量</strong>
            </div>
            <p class="muted">
              商品ID：{{ product.goodsId }} · 评论：{{ product.commentCount ?? '-' }} · 店铺：
              <a v-if="product.mallUrl" class="inline-shop-link" :href="product.mallUrl" target="_blank" rel="noreferrer">
                {{ product.shopName || product.mallUrl }}
              </a>
              <span v-else>{{ product.shopName || '-' }}</span>
              · SKU：{{ product.skuCount ?? '-' }}
            </p>
            <div class="overlap-metrics">
              <span>排名：{{ product.previous.rank ?? '-' }} → {{ product.current.rank ?? '-' }}</span>
              <span>销量：{{ product.previous.salesTipAmount ?? '-' }} → {{ product.current.salesTipAmount ?? '-' }}</span>
              <span>价格：{{ formatOverlapPrice(product.previous.minWholesalePriceYuan, product.previous.maxWholesalePriceYuan) }} → {{ formatOverlapPrice(product.current.minWholesalePriceYuan, product.current.maxWholesalePriceYuan) }}</span>
              <span>排名变化：{{ formatOptionalChange(product.changes.rankDelta) }}</span>
            </div>
            <a v-if="product.goodsUrl" :href="product.goodsUrl" target="_blank" rel="noreferrer">打开商品</a>
          </div>
        </article>
      </section>

      <section v-else class="diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">对比终点这一轮抓取</p>
            <h2>所有商品</h2>
          </div>
          <span>{{ productAll?.products.length ?? 0 }} 个</span>
        </div>
        <article v-for="product in allProducts" :key="product.goodsId" class="diff-card">
          <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.title" loading="lazy" />
          <div class="diff-card-body">
            <div class="diff-card-title">
              <h3>{{ product.title || product.goodsId }}</h3>
              <strong>{{ formatPrice(product) }}</strong>
            </div>
            <p class="muted">商品ID：{{ product.goodsId }} · 排名：{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }} · 评论：{{ product.commentCount ?? '-' }}</p>
            <p class="muted">
              店铺：
              <a v-if="product.mallUrl" class="inline-shop-link" :href="product.mallUrl" target="_blank" rel="noreferrer">
                {{ product.shopName || product.mallUrl }}
              </a>
              <span v-else>{{ product.shopName || '-' }}</span>
              · SKU：{{ product.skuCount ?? '-' }}
            </p>
            <a v-if="product.goodsUrl" :href="product.goodsUrl" target="_blank" rel="noreferrer">打开商品</a>
          </div>
        </article>
      </section>
    </section>

    <section v-if="selectedMetric === 'shop'" class="diff-grid">
      <section class="panel diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">起点有，终点没有</p>
            <h2>本次未出现的店铺</h2>
          </div>
          <span>{{ shopDiff?.removed.length ?? 0 }} 个</span>
        </div>

        <p v-if="loading && !shopDiff" class="muted">正在加载店铺差异...</p>
        <p v-else-if="shopDiff && shopDiff.removed.length === 0" class="muted">没有本次未出现的店铺。</p>

        <article v-for="shop in shopDiff?.removed" :key="shop.shopKey" class="shop-card">
          <div class="shop-card-heading">
            <img v-if="shop.mallLogo" :src="shop.mallLogo" :alt="shop.shopName" loading="lazy" />
            <div>
              <h3>{{ shop.shopName || shop.shopKey }}</h3>
              <div class="shop-stats">
                <span>商品数：{{ shop.productCount }}</span>
                <span>最好排名：{{ shop.topRank ?? '-' }}</span>
                <span>总销量：{{ shop.totalSalesTipAmount }}</span>
              </div>
            </div>
          </div>
          <div class="shop-products">
            <div v-for="product in shop.products" :key="product.goodsId" class="shop-product-row">
              <span>{{ product.title || product.goodsId }}</span>
              <strong>{{ formatProductPrice(product) }}</strong>
            </div>
          </div>
          <div v-if="openedShopInfoKey === `removed:${shop.shopKey}`" class="shop-info-panel">
            <dl>
              <div>
                <dt>店铺标识</dt>
                <dd>{{ shop.shopKey }}</dd>
              </div>
              <div>
                <dt>本轮商品数</dt>
                <dd>{{ shop.productCount }}</dd>
              </div>
              <div>
                <dt>最好排名</dt>
                <dd>{{ shop.topRank ?? '-' }}</dd>
              </div>
              <div>
                <dt>商品总销量</dt>
                <dd>{{ shop.totalSalesTipAmount }}</dd>
              </div>
            </dl>
            <div class="shop-info-products">
              <strong>代表商品</strong>
              <div v-for="product in shop.products" :key="product.goodsId" class="shop-info-product">
                <p class="muted">
                  <button type="button" class="inline-link" @click="toggleShopProduct(`removed:${shop.shopKey}:${product.goodsId}`)">
                    {{ product.goodsId }}
                  </button>
                  · 排名：{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }}
                </p>
                <div v-if="openedShopProductKey === `removed:${shop.shopKey}:${product.goodsId}`" class="product-info-panel">
                  <h4>{{ product.title || product.goodsId }}</h4>
                  <dl>
                    <div>
                      <dt>商品ID</dt>
                      <dd>{{ product.goodsId }}</dd>
                    </div>
                    <div>
                      <dt>价格</dt>
                      <dd>{{ formatProductPrice(product) }}</dd>
                    </div>
                    <div>
                      <dt>排名</dt>
                      <dd>{{ product.rank ?? '-' }}</dd>
                    </div>
                    <div>
                      <dt>销量</dt>
                      <dd>{{ product.salesTipAmount ?? '-' }}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>
          <div class="shop-actions">
            <button type="button" class="link-button" @click="toggleShopInfo(`removed:${shop.shopKey}`)">
              店铺信息
            </button>
            <a v-if="shop.mallUrl" :href="shop.mallUrl" target="_blank" rel="noreferrer">打开店铺</a>
          </div>
        </article>
      </section>

      <section class="panel diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">终点有，起点没有</p>
            <h2>本次新出现的店铺</h2>
          </div>
          <span>{{ shopDiff?.added.length ?? 0 }} 个</span>
        </div>

        <p v-if="loading && !shopDiff" class="muted">正在加载店铺差异...</p>
        <p v-else-if="shopDiff && shopDiff.added.length === 0" class="muted">没有本次新出现的店铺。</p>

        <article v-for="shop in shopDiff?.added" :key="shop.shopKey" class="shop-card">
          <div class="shop-card-heading">
            <img v-if="shop.mallLogo" :src="shop.mallLogo" :alt="shop.shopName" loading="lazy" />
            <div>
              <h3>{{ shop.shopName || shop.shopKey }}</h3>
              <div class="shop-stats">
                <span>商品数：{{ shop.productCount }}</span>
                <span>最好排名：{{ shop.topRank ?? '-' }}</span>
                <span>总销量：{{ shop.totalSalesTipAmount }}</span>
              </div>
            </div>
          </div>
          <div class="shop-products">
            <div v-for="product in shop.products" :key="product.goodsId" class="shop-product-row">
              <span>{{ product.title || product.goodsId }}</span>
              <strong>{{ formatProductPrice(product) }}</strong>
            </div>
          </div>
          <div v-if="openedShopInfoKey === `added:${shop.shopKey}`" class="shop-info-panel">
            <dl>
              <div>
                <dt>店铺标识</dt>
                <dd>{{ shop.shopKey }}</dd>
              </div>
              <div>
                <dt>本轮商品数</dt>
                <dd>{{ shop.productCount }}</dd>
              </div>
              <div>
                <dt>最好排名</dt>
                <dd>{{ shop.topRank ?? '-' }}</dd>
              </div>
              <div>
                <dt>商品总销量</dt>
                <dd>{{ shop.totalSalesTipAmount }}</dd>
              </div>
            </dl>
            <div class="shop-info-products">
              <strong>代表商品</strong>
              <div v-for="product in shop.products" :key="product.goodsId" class="shop-info-product">
                <p class="muted">
                  <button type="button" class="inline-link" @click="toggleShopProduct(`added:${shop.shopKey}:${product.goodsId}`)">
                    {{ product.goodsId }}
                  </button>
                  · 排名：{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }}
                </p>
                <div v-if="openedShopProductKey === `added:${shop.shopKey}:${product.goodsId}`" class="product-info-panel">
                  <h4>{{ product.title || product.goodsId }}</h4>
                  <dl>
                    <div>
                      <dt>商品ID</dt>
                      <dd>{{ product.goodsId }}</dd>
                    </div>
                    <div>
                      <dt>价格</dt>
                      <dd>{{ formatProductPrice(product) }}</dd>
                    </div>
                    <div>
                      <dt>排名</dt>
                      <dd>{{ product.rank ?? '-' }}</dd>
                    </div>
                    <div>
                      <dt>销量</dt>
                      <dd>{{ product.salesTipAmount ?? '-' }}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>
          <div class="shop-actions">
            <button type="button" class="link-button" @click="toggleShopInfo(`added:${shop.shopKey}`)">
              店铺信息
            </button>
            <a v-if="shop.mallUrl" :href="shop.mallUrl" target="_blank" rel="noreferrer">打开店铺</a>
          </div>
        </article>
      </section>
    </section>

    <section v-if="selectedMetric === 'sales'" class="panel sales-section">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">每次抓取的销量最高商品</p>
          <h2>商品销售趋势</h2>
        </div>
        <span>{{ topSalesTrendPoints.length }} 次抓取</span>
      </div>

      <div class="sales-grid">
        <article v-for="point in topSalesTrendPoints" :key="point.runId" class="sales-card">
          <img v-if="point.product.imageUrl" :src="point.product.imageUrl" :alt="point.product.title" loading="lazy" />
          <div class="sales-card-body">
            <div>
              <p class="eyebrow">{{ formatDate(point.crawlTime) }}</p>
              <h3>{{ point.product.title || point.product.goodsId }}</h3>
            </div>
            <strong>{{ point.salesTipAmount }} 销量</strong>
            <p class="muted">
              商品ID：{{ point.product.goodsId }} · 排名：{{ point.product.rank ?? '-' }} · 店铺：{{ point.product.shopName || '-' }}
            </p>
            <p class="muted">
              价格：{{ formatPrice(point.product) }} · SKU：{{ point.product.skuCount ?? '-' }}
            </p>
            <a v-if="point.product.goodsUrl" :href="point.product.goodsUrl" target="_blank" rel="noreferrer">打开商品</a>
          </div>
        </article>
      </div>
    </section>

    <section v-if="selectedMetric === 'salesDelta'" class="panel sales-section">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">每次抓取商品总销量变化</p>
          <h2>商品总销量增量趋势</h2>
        </div>
        <span>{{ totalSalesTrendPoints.length }} 次抓取</span>
      </div>

      <div class="sales-grid">
        <article v-for="(point, index) in totalSalesTrendPoints" :key="point.runId" class="sales-delta-card">
          <div>
            <p class="eyebrow">{{ formatDate(point.crawlTime) }}</p>
            <h3>{{ point.totalSales }} 总销量</h3>
          </div>
          <strong :class="{ negative: index > 0 && point.totalSales - totalSalesTrendPoints[index - 1].totalSales < 0 }">
            {{ index === 0 ? '基准' : formatChange(point.totalSales - totalSalesTrendPoints[index - 1].totalSales) }}
          </strong>
        </article>
      </div>
    </section>
  </main>
</template>
