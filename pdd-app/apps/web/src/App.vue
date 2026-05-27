<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type ProductCountTrend = {
  runId: string
  keyword: string
  crawlTime: string
  productCount: number
}

type DiffProduct = {
  goodsId: string
  title: string
  shopName: string
  imageUrl: string
  goodsUrl: string
  rank: number | null
  salesTipAmount: number | null
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

const trendPoints = ref<ProductCountTrend[]>([])
const productDiff = ref<ProductDiff | null>(null)
const loading = ref(false)
const error = ref('')
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

const trendSummary = computed(() => {
  const first = trendPoints.value[0]
  const last = trendPoints.value[trendPoints.value.length - 1]

  if (!first || !last) {
    return null
  }

  const change = last.productCount - first.productCount
  const percent = first.productCount === 0 ? 0 : (change / first.productCount) * 100

  return {
    change,
    percent
  }
})

const trendChart = computed(() => {
  const width = 720
  const height = 260
  const padding = {
    top: 24,
    right: 28,
    bottom: 48,
    left: 58
  }
  const values = trendPoints.value.map((point) => point.productCount)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const yPadding = Math.max(1, Math.ceil((maxValue - minValue) * 0.2))
  const yMin = Math.max(0, minValue - yPadding)
  const yMax = maxValue + yPadding
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const scaleX = (index: number) =>
    padding.left + (trendPoints.value.length === 1 ? plotWidth / 2 : (index / (trendPoints.value.length - 1)) * plotWidth)
  const scaleY = (value: number) => padding.top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight

  const points = trendPoints.value.map((point, index) => ({
    ...point,
    x: scaleX(index),
    y: scaleY(point.productCount)
  }))

  return {
    width,
    height,
    yMin,
    yMax,
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

async function loadDashboard() {
  loading.value = true
  error.value = ''

  try {
    const [trend, diff] = await Promise.all([
      apiFetch<ProductCountTrend[]>('/api/trends/product-count'),
      apiFetch<ProductDiff>('/api/trends/product-diff')
    ])
    trendPoints.value = trend
    productDiff.value = diff
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : '加载数据失败'
  } finally {
    loading.value = false
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
      <div class="panel-heading">
        <div>
          <p class="eyebrow">MongoDB 抓取数据</p>
          <h2>商品数量趋势</h2>
        </div>
        <span v-if="trendSummary">
          {{ formatChange(trendSummary.change) }} 个，{{ trendSummary.percent.toFixed(2) }}%
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
          aria-label="商品数量趋势图"
        >
          <line x1="58" y1="24" x2="58" y2="212" class="chart-axis" />
          <line x1="58" y1="212" x2="692" y2="212" class="chart-axis" />
          <text x="14" y="31" class="chart-label">{{ trendChart.yMax }}</text>
          <text x="14" y="216" class="chart-label">{{ trendChart.yMin }}</text>
          <path :d="trendChart.linePath" class="chart-line" />

          <g v-for="point in trendChart.points" :key="point.runId">
            <line :x1="point.x" y1="212" :x2="point.x" :y2="point.y" class="chart-guide" />
            <circle :cx="point.x" :cy="point.y" r="5" class="chart-dot" />
            <text :x="point.x" :y="point.y - 12" text-anchor="middle" class="chart-value">
              {{ point.productCount }}
            </text>
            <text :x="point.x" y="239" text-anchor="middle" class="chart-label">
              {{ formatShortDate(point.crawlTime) }}
            </text>
          </g>
        </svg>

        <div class="trend-table">
          <div v-for="point in trendPoints" :key="point.runId" class="trend-row">
            <span>{{ formatDate(point.crawlTime) }}</span>
            <strong>{{ point.productCount }} 个商品</strong>
          </div>
        </div>
      </div>
    </section>

    <section v-if="productDiff?.previousRun && productDiff.currentRun" class="compare-header panel">
      <div>
        <span>上一轮</span>
        <strong>{{ formatDate(productDiff.previousRun.crawlTime) }}</strong>
      </div>
      <div>
        <span>最新一轮</span>
        <strong>{{ formatDate(productDiff.currentRun.crawlTime) }}</strong>
      </div>
    </section>

    <section class="diff-grid">
      <section class="panel diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">上一轮有，最新一轮没有</p>
            <h2>少了的商品</h2>
          </div>
          <span>{{ productDiff?.removed.length ?? 0 }} 个</span>
        </div>

        <p v-if="loading && !productDiff" class="muted">正在加载商品差异...</p>
        <p v-else-if="productDiff && productDiff.removed.length === 0" class="muted">没有减少的商品。</p>

        <article v-for="product in productDiff?.removed" :key="product.goodsId" class="diff-card">
          <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.title" loading="lazy" />
          <div class="diff-card-body">
            <div class="diff-card-title">
              <h3>{{ product.title || product.goodsId }}</h3>
              <strong>{{ formatPrice(product) }}</strong>
            </div>
            <p class="muted">
              商品ID：{{ product.goodsId }} · 排名：{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }}
            </p>
            <p class="muted">
              店铺：{{ product.shopName || '-' }} · SKU：{{ product.skuCount ?? '-' }}
            </p>
            <a v-if="product.goodsUrl" :href="product.goodsUrl" target="_blank" rel="noreferrer">打开商品</a>
          </div>
        </article>
      </section>

      <section class="panel diff-section">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">最新一轮有，上一轮没有</p>
            <h2>新增的商品</h2>
          </div>
          <span>{{ productDiff?.added.length ?? 0 }} 个</span>
        </div>

        <p v-if="loading && !productDiff" class="muted">正在加载商品差异...</p>
        <p v-else-if="productDiff && productDiff.added.length === 0" class="muted">没有新增的商品。</p>

        <article v-for="product in productDiff?.added" :key="product.goodsId" class="diff-card">
          <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.title" loading="lazy" />
          <div class="diff-card-body">
            <div class="diff-card-title">
              <h3>{{ product.title || product.goodsId }}</h3>
              <strong>{{ formatPrice(product) }}</strong>
            </div>
            <p class="muted">
              商品ID：{{ product.goodsId }} · 排名：{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }}
            </p>
            <p class="muted">
              店铺：{{ product.shopName || '-' }} · SKU：{{ product.skuCount ?? '-' }}
            </p>
            <a v-if="product.goodsUrl" :href="product.goodsUrl" target="_blank" rel="noreferrer">打开商品</a>
          </div>
        </article>
      </section>
    </section>
  </main>
</template>
