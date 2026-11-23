<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { findSimilarCovers } from './wholesale-image-search'

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
type ProductResultTab = 'removed' | 'added' | 'overlap' | 'all'
type ProductFilterItem = {
  material?: string
  tags?: string[]
}

type ProductMedia = {
  id: string
  type: 'image' | 'video'
  imageSrc: string
  videoSrc: string
  title: string
}

type ChartPoint = {
  runId: string
  keyword: string
  crawlTime: string
  value: number
}

type DiffProduct = {
  runId: string
  goodsId: string
  title: string
  shopName: string
  shopLogo?: string
  serviceTags?: string[]
  questionCount?: number | null
  address?: string
  priceTiers?: Array<{ stageStartValue: number; stageDiscount: number }>
  properties?: Array<{ name: string; values: string[] }>
  mallUrl: string
  imageUrl: string
  listingImageUrl?: string
  listingTitle?: string
  imageLocalFile: string
  detailFile: string
  detailUrl: string
  goodsUrl: string
  rank: number | null
  displayIndex: number | null
  source: string
  salesTipAmount: number | null
  commentCount: number | null
  minWholesalePriceYuan: number | null
  maxWholesalePriceYuan: number | null
  skuCount: number | null
  material: string
  materialAuto: string
  materialSource: string
  carouselMedia: ProductMedia[]
  detailMedia: ProductMedia[]
  tags: string[]
  tagsAuto: string[]
  tagsSource: string
  skus: ProductSku[]
}

type ProductSku = {
  skuId: string
  specs: Array<{
    key: string
    value: string
  }>
  groupPriceYuan: number | null
  wholesalePriceYuan: number | null
  quantity: number | null
  piece: number | null
  thumbUrl: string
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

type ProductOverlapItem = DiffProduct & {
  previous: {
    rank: number | null
    displayIndex: number | null
    source: string
    salesTipAmount: number | null
    minWholesalePriceYuan: number | null
    maxWholesalePriceYuan: number | null
  }
  current: {
    rank: number | null
    displayIndex: number | null
    source: string
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
  all: DiffShop[]
}

const productTrendPoints = ref<ProductCountTrend[]>([])
const shopTrendPoints = ref<ShopCountTrend[]>([])
const topSalesTrendPoints = ref<TopSalesTrend[]>([])
const totalSalesTrendPoints = ref<TotalSalesTrend[]>([])
const productDiff = ref<ProductDiff | null>(null)
const productOverlap = ref<ProductOverlap | null>(null)
const productAll = ref<ProductList | null>(null)
const shopDiff = ref<ShopDiff | null>(null)
const shopView = ref<'comparison' | 'all'>('comparison')
const allShopQuery = ref('')
const filteredShops = computed(() => {
  const query = allShopQuery.value.trim().toLowerCase()
  return (shopDiff.value?.all ?? []).filter((shop) => `${shop.shopName} ${shop.shopKey}`.toLowerCase().includes(query))
})
const selectedMetric = ref<TrendMetric>('product')
const productResultTab = ref<ProductResultTab>('all')
const wholesaleAnalysisOpen = ref(true)
const productSortMode = ref<'rank' | 'sales' | 'comments'>('rank')
const shopSearchQuery = ref('')
const selectedShop = ref<{ name: string; url: string } | null>(null)
const productIdSearchQuery = ref('')
const selectedProductMaterial = ref('')
const selectedProductTags = ref<string[]>([])
const selectedRunIds = ref<string[]>([])
const selectionMode = ref(false)
const focusedRunId = ref('')
const openedShopInfoKey = ref('')
const openedShopProductKey = ref('')
const currentProductPage = ref(1)
const previewMedia = ref<{ type: 'image' | 'video'; src: string; poster: string; title: string } | null>(null)
const loading = ref(false)
const diffLoading = ref(false)
const tagAutoLoading = ref(false)
const tagSavingKey = ref('')
const materialSavingKey = ref('')
const tagDrafts = ref<Record<string, string[]>>({})
const newTagDrafts = ref<Record<string, string>>({})
const materialDrafts = ref<Record<string, string>>({})
const error = ref('')
const syncStatus = ref('')
const syncError = ref('')
const syncing = ref(false)
const newDataAvailable = ref(false)
const isDesktop = '__TAURI_INTERNALS__' in window
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || (isDesktop ? 'http://127.0.0.1:43121' : '')).replace(/\/$/, '')
const merchantStatus = ref('')
const merchantBusy = ref(false)
const listedGoodsKey = 'myshop.listed-goods.v1'
function readListedGoods(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(listedGoodsKey) ?? '[]')
    if (Array.isArray(saved)) return new Set(saved.filter((id): id is string => typeof id === 'string'))
  } catch { /* Invalid or unavailable storage starts with an empty list. */ }
  return new Set()
}
const listedGoods = ref(readListedGoods())
function confirmListedGoods(goodsId: string) {
  if (!window.confirm('确认这款商品已经在拼多多商家后台发布成功？')) return
  const updated = new Set(listedGoods.value).add(goodsId)
  try {
    localStorage.setItem(listedGoodsKey, JSON.stringify([...updated]))
    listedGoods.value = updated
  } catch {
    error.value = '无法保存铺货状态，请检查本地存储后重试。'
  }
}
type ListingProduct = Pick<DiffProduct, 'goodsId' | 'title' | 'imageUrl' | 'carouselMedia'>
const titleCorrection = ref<{ product: ListingProduct; title: string } | null>(null)
const imageChoice = ref<{ product: ListingProduct; urls: string[]; selected: string; message: string } | null>(null)
const correctedTitleLength = computed(() => Array.from(titleCorrection.value?.title ?? '').reduce((total, char) => total + (char.codePointAt(0)! > 127 ? 2 : 1), 0))
let stopMerchantStatus: (() => void) | undefined
type DesktopBridge = {
  core: { invoke: (name: string, args?: Record<string, unknown>) => Promise<void> }
  event: { listen: (name: string, listener: (event: { payload: { message: string; isError: boolean; state?: string } }) => void) => Promise<() => void> }
}
function desktopBridge() {
  return (window as unknown as { __TAURI__?: DesktopBridge }).__TAURI__
}

async function openWholesaleOriginal(event: MouseEvent, url: string) {
  if (!isDesktop) return
  event.preventDefault()
  try {
    const bridge = desktopBridge()
    if (!bridge) throw new Error('无法连接桌面程序')
    await bridge.core.invoke('open_external_url', { url })
  } catch (requestError) {
    error.value = `打开浏览器失败：${requestError instanceof Error ? requestError.message : String(requestError)}`
  }
}
const PRODUCT_PAGE_SIZE = 40

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
  const points = selectedComparePoints.value
  if (points.length !== 2) return null
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

function mallId(url: string) {
  try {
    return new URL(url).searchParams.get('mid')
  } catch {
    return null
  }
}

function filterByShop<T extends { goodsId: string; shopName?: string; mallUrl?: string }>(products: T[]) {
  const query = shopSearchQuery.value.trim().toLowerCase()
  const productId = productIdSearchQuery.value.trim()

  if (!query && !productId) {
    return products
  }

  return products.filter((product) => {
    const selectedMallId = selectedShop.value ? mallId(selectedShop.value.url) : null
    const productMallId = mallId(product.mallUrl ?? '')
    const shopMatches = selectedShop.value
      ? selectedMallId && productMallId ? selectedMallId === productMallId : product.shopName === selectedShop.value.name
      : `${product.shopName ?? ''} ${product.mallUrl ?? ''}`.toLowerCase().includes(query)
    return shopMatches && String(product.goodsId).includes(productId)
  })
}

function filterByTags<T extends ProductFilterItem>(products: T[]) {
  if (selectedProductTags.value.length === 0) {
    return products
  }

  return products.filter((product) => {
    const tags = product.tags ?? []
    return selectedProductTags.value.every((tag) => tags.includes(tag) &&
      !tags.some((other) => other !== tag && other.startsWith(tag) && !selectedProductTags.value.includes(other)))
  })
}

function filterByMaterial<T extends ProductFilterItem>(products: T[]) {
  if (!selectedProductMaterial.value) {
    return products
  }

  return products.filter((product) => (product.material || '未填写') === selectedProductMaterial.value)
}

const wholesaleProducts = computed<DiffProduct[]>(() => {
  if (productResultTab.value === 'removed') return productDiff.value?.removed ?? []
  if (productResultTab.value === 'added') return productDiff.value?.added ?? []
  if (productResultTab.value === 'overlap') return productOverlap.value?.products ?? []
  return productAll.value?.products ?? []
})

const activeProductListBeforeFilters = computed(() => filterByShop(wholesaleProducts.value))

const productMaterialOptions = computed(() => {
  const counts = new Map<string, number>()

  for (const product of activeProductListBeforeFilters.value) {
    const material = product.material || '未填写'
    counts.set(material, (counts.get(material) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([material, count]) => ({ material, count }))
    .sort((a, b) => b.count - a.count || a.material.localeCompare(b.material, 'zh-CN'))
})

const activeProductListBeforeTagFilter = computed<ProductFilterItem[]>(() =>
  filterByMaterial(activeProductListBeforeFilters.value as ProductFilterItem[])
)

const productTagOptions = computed(() => {
  const counts = new Map<string, number>()

  for (const product of activeProductListBeforeTagFilter.value) {
    for (const tag of product.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'))
})

const wholesaleSearch = ref('')
const wholesaleImageInput = ref<HTMLInputElement | null>(null)
const wholesaleImageBusy = ref(false)
const wholesaleImageError = ref('')
const wholesaleImageMatches = ref<string[] | null>(null)
let wholesaleImageRequest: AbortController | null = null
function clearWholesaleImageSearch() {
  wholesaleImageRequest?.abort()
  wholesaleImageRequest = null
  wholesaleImageBusy.value = false
  wholesaleImageError.value = ''
  wholesaleImageMatches.value = null
}
async function searchWholesaleImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  clearWholesaleImageSearch()
  if (file.size > 20 * 1024 * 1024) {
    wholesaleImageError.value = '图片不能超过 20 MB。'
    return
  }
  const controller = new AbortController()
  wholesaleImageRequest = controller
  wholesaleImageBusy.value = true
  wholesaleOrder.value = 'default'
  wholesaleSearch.value = ''
  wholesaleKeyword.value = ''
  try {
    const covers = wholesaleProducts.value.map(product => ({
      id: product.goodsId, url: product.listingImageUrl || product.imageUrl, fallback: product.imageUrl,
    }))
    const assetOrigin = new URL(apiBaseUrl || location.origin, location.href).origin
    wholesaleImageMatches.value = await findSimilarCovers(file, covers, assetOrigin, controller.signal)
    currentProductPage.value = 1
  } catch {
    if (!controller.signal.aborted) wholesaleImageError.value = '无法读取这张图片。'
  } finally {
    if (wholesaleImageRequest === controller) wholesaleImageBusy.value = false
  }
}
watch(wholesaleProducts, clearWholesaleImageSearch)
onUnmounted(clearWholesaleImageSearch)
const wholesaleKeyword = ref('')
const wholesaleMin = ref<number | ''>('')
const wholesaleMax = ref<number | ''>('')
const wholesaleShape = ref('')
function productShapes(product: DiffProduct) {
  return product.properties?.find(property => property.name === '外观造型')?.values ?? []
}
const wholesaleShapes = computed(() => {
  const counts = new Map<string, number>()
  for (const product of activeProductListBeforeFilters.value) {
    for (const value of new Set(productShapes(product))) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([value]) => value)
})
watch(wholesaleShapes, values => {
  if (!values.includes(wholesaleShape.value)) wholesaleShape.value = ''
})
const wholesaleOrder = ref<'default' | 'sales' | 'price-asc' | 'price-desc'>('default')
const allProducts = computed(() => {
  const keyword = wholesaleKeyword.value.trim().toLowerCase()
  const matches = wholesaleImageMatches.value ? new Map(wholesaleImageMatches.value.map((id, index) => [id, index])) : null
  const items = filterByTags(filterByMaterial(activeProductListBeforeFilters.value)).filter(product => {
    const price = product.minWholesalePriceYuan
    return (!matches || matches.has(product.goodsId))
      && (!keyword || [product.title, product.listingTitle ?? '', product.shopName, product.goodsId].some(value => value.toLowerCase().includes(keyword)))
      && (!wholesaleShape.value || productShapes(product).includes(wholesaleShape.value))
      && (wholesaleMin.value === '' || (price !== null && price >= wholesaleMin.value))
      && (wholesaleMax.value === '' || (price !== null && price <= wholesaleMax.value))
  })
  if (matches && wholesaleOrder.value === 'default') {
    return [...items].sort((a, b) => (matches.get(a.goodsId) ?? 0) - (matches.get(b.goodsId) ?? 0))
  }
  if (wholesaleOrder.value === 'sales') return [...items].sort((a, b) => (b.salesTipAmount ?? -1) - (a.salesTipAmount ?? -1))
  if (wholesaleOrder.value === 'default' && productResultTab.value !== 'all' && productSortMode.value === 'comments') {
    return [...items].sort((a, b) => (b.commentCount ?? -1) - (a.commentCount ?? -1))
  }
  if (wholesaleOrder.value === 'default') return [...items].sort((a, b) =>
    (a.displayIndex ?? a.rank ?? Number.MAX_SAFE_INTEGER) - (b.displayIndex ?? b.rank ?? Number.MAX_SAFE_INTEGER))
  const direction = wholesaleOrder.value === 'price-asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const left = a.minWholesalePriceYuan
    const right = b.minWholesalePriceYuan
    return left === null ? (right === null ? 0 : 1) : right === null ? -1 : direction * (left - right)
  })
})

const totalProductPages = computed(() => Math.max(1, Math.ceil(allProducts.value.length / PRODUCT_PAGE_SIZE)))

function pageSlice<T>(items: T[]) {
  const start = (currentProductPage.value - 1) * PRODUCT_PAGE_SIZE
  return items.slice(start, start + PRODUCT_PAGE_SIZE)
}

const pagedAllProducts = computed(() => pageSlice(allProducts.value))
const wholesaleProduct = ref<DiffProduct | null>(null)
let wholesaleListScroll = 0
function closeWholesale() {
  wholesaleProduct.value = null
  void nextTick(() => window.scrollTo(0, wholesaleListScroll))
}
function scrollWholesaleTop() {
  document.querySelector('.wholesale-detail')?.scrollIntoView({ behavior: 'smooth' })
}
function scrollWholesaleListTop() {
  document.querySelector('.wholesale-header')?.scrollIntoView({ behavior: 'smooth' })
}
watch([productResultTab, selectedMetric, productAll], () => { wholesaleProduct.value = null })
const wholesaleImage = ref('')
const wholesaleShareStatus = ref('')
async function copyWholesaleLink() {
  const product = wholesaleProduct.value
  if (!product?.goodsUrl) return
  try {
    await navigator.clipboard.writeText(product.goodsUrl)
    if (wholesaleProduct.value === product) wholesaleShareStatus.value = '已复制'
  } catch {
    if (wholesaleProduct.value === product) wholesaleShareStatus.value = '复制失败'
  }
}
const wholesaleThumbStrip = ref<HTMLElement | null>(null)
function scrollWholesaleThumbs(direction: number) {
  const strip = wholesaleThumbStrip.value
  if (strip) strip.scrollBy({ left: direction * strip.clientWidth, behavior: 'smooth' })
}
const wholesaleSpecSelection = ref(new Map<string, string>())
const wholesaleSkuPage = ref(1)
const wholesaleQuantities = ref<Record<string, number>>({})
const wholesaleCartOpen = ref(false)
const wholesaleCartDialog = ref<HTMLDialogElement | null>(null)
watch(wholesaleCartOpen, (open) => {
  const dialog = wholesaleCartDialog.value
  if (!dialog) return
  if (open && !dialog.open) dialog.showModal()
  if (!open && dialog.open) dialog.close()
}, { flush: 'post' })
type WholesaleCartItem = { goodsId: string; skuId: string; title: string; specs: string; goodsUrl: string; count: number }
const wholesaleCartKey = 'myshop.wholesale-cart.v1'
function readWholesaleCart(): WholesaleCartItem[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(wholesaleCartKey) || '[]')
    if (!Array.isArray(items)) return []
    return items.filter((item): item is WholesaleCartItem => item &&
      typeof item.goodsId === 'string' && typeof item.skuId === 'string' &&
      typeof item.title === 'string' && typeof item.specs === 'string' &&
      typeof item.goodsUrl === 'string' && (!item.goodsUrl || /^https?:\/\//i.test(item.goodsUrl)) &&
      Number.isInteger(item.count) && item.count > 0 && item.count <= 99999)
  } catch {
    return []
  }
}
const wholesaleCart = ref(readWholesaleCart())
watch(wholesaleCart, items => {
  try { localStorage.setItem(wholesaleCartKey, JSON.stringify(items)) } catch { /* The active cart remains available. */ }
}, { deep: true })
const wholesaleCartCount = computed(() => wholesaleCart.value.reduce((total, item) => total + item.count, 0))
function addWholesaleSelection() {
  const product = wholesaleProduct.value
  if (!product) return
  for (const sku of product.skus) {
    const count = wholesaleQuantities.value[sku.skuId] ?? 0
    if (!count || sku.wholesalePriceYuan === null) continue
    const index = wholesaleCart.value.findIndex(item => item.goodsId === product.goodsId && item.skuId === sku.skuId)
    const item = {
      goodsId: product.goodsId, skuId: sku.skuId, title: product.title,
      specs: formatSkuSpecs(sku), goodsUrl: product.goodsUrl || '',
      count: Math.min((wholesaleCart.value[index]?.count ?? 0) + count, sku.quantity ?? 99999, 99999),
    }
    if (index < 0) wholesaleCart.value.push(item)
    else wholesaleCart.value[index] = item
  }
  wholesaleQuantities.value = {}
  wholesaleCartOpen.value = true
}
function setWholesaleQuantity(sku: ProductSku, value: number) {
  const max = sku.quantity && sku.quantity > 0 ? Math.min(sku.quantity, 99999) : sku.quantity === 0 ? 0 : 99999
  wholesaleQuantities.value[sku.skuId] = Math.min(max, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0))
}
const wholesaleSelection = computed(() => (wholesaleProduct.value?.skus ?? []).reduce((sum, sku) => {
  const count = wholesaleQuantities.value[sku.skuId] ?? 0
  sum.count += count
  sum.cents += count * Math.round((sku.wholesalePriceYuan ?? 0) * 100)
  return sum
}, { count: 0, cents: 0 }))
const wholesaleSkuPageSize = 10
const wholesaleSpecGroups = computed(() => {
  const groups = new Map<string, Set<string>>()
  for (const sku of wholesaleProduct.value?.skus ?? []) {
    for (const { key, value } of sku.specs) {
      if (!key || !value) continue
      if (!groups.has(key)) groups.set(key, new Set())
      groups.get(key)?.add(value)
    }
  }
  return [...groups].map(([key, values]) => ({ key, values: [...values] }))
})
const wholesaleSkuRows = computed(() => (wholesaleProduct.value?.skus ?? []).filter(sku =>
  [...wholesaleSpecSelection.value].every(([key, value]) => sku.specs.some(spec => spec.key === key && spec.value === value))))
const wholesaleSkuPageCount = computed(() => Math.ceil(wholesaleSkuRows.value.length / wholesaleSkuPageSize))
const wholesaleMinimumOrder = computed(() => {
  for (const tag of wholesaleProduct.value?.serviceTags ?? []) {
    const count = tag.match(/(?:^|全店)([1-9]\d*)\s*件起批$/)?.[1]
    if (count) return count
  }
  return ''
})
const wholesaleOriginalPrice = computed(() => {
  const prices = (wholesaleProduct.value?.skus ?? []).flatMap(sku => sku.groupPriceYuan === null ? [] : [sku.groupPriceYuan])
  if (!prices.length) return ''
  const min = Math.min(...prices).toFixed(2)
  const max = Math.max(...prices).toFixed(2)
  return min === max ? '¥' + min : '¥' + min + ' - ' + max
})
function selectWholesaleSpec(key: string, value: string) {
  if (value) wholesaleSpecSelection.value.set(key, value)
  else wholesaleSpecSelection.value.delete(key)
  wholesaleSkuPage.value = 1
  const [sku] = wholesaleSkuRows.value
  if (value && wholesaleSkuRows.value.length === 1 && sku?.thumbUrl) wholesaleImage.value = sku.thumbUrl
}
const wholesaleTab = ref<'intro' | 'reviews' | 'questions'>('intro')
type WholesaleReview = { name: string; comment: string; time: number | null; specs: string; images: string[] }
const wholesaleDiscussion = ref<{ reviews: WholesaleReview[]; questions: Array<{ question: string; answer: string }> } | null>(null)
function wholesaleReviewDate(time: number | null) {
  if (time === null) return ''
  const date = new Date(time * 1000)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN')
}
const wholesaleDiscussionState = ref<'idle' | 'loading' | 'error'>('idle')
let wholesaleDiscussionRequest = 0
async function selectWholesaleTab(tab: typeof wholesaleTab.value) {
  wholesaleTab.value = tab
  const product = wholesaleProduct.value
  if (tab === 'intro' || !product || wholesaleDiscussion.value || wholesaleDiscussionState.value === 'loading') return
  const request = ++wholesaleDiscussionRequest
  wholesaleDiscussionState.value = 'loading'
  try {
    const query = new URLSearchParams({ runId: product.runId, goodsId: product.goodsId })
    const response = await fetchWithTimeout('/api/trends/product-discussion?' + query, {}, 10000)
    if (!response.ok) throw new Error('Unable to load product discussion')
    const discussion = await response.json()
    if (request === wholesaleDiscussionRequest) wholesaleDiscussion.value = normalizeApiAssets(discussion) as NonNullable<typeof wholesaleDiscussion.value>
  } catch {
    if (request === wholesaleDiscussionRequest) wholesaleDiscussionState.value = 'error'
  } finally {
    if (request === wholesaleDiscussionRequest && wholesaleDiscussionState.value === 'loading') wholesaleDiscussionState.value = 'idle'
  }
}
function openWholesale(product: DiffProduct) {
  wholesaleShareStatus.value = ''
  wholesaleListScroll = window.scrollY
  wholesaleQuantities.value = {}
  wholesaleDiscussionRequest++
  wholesaleDiscussion.value = null
  wholesaleDiscussionState.value = 'idle'
  wholesaleTab.value = 'intro'
  wholesaleImage.value = product.imageUrl || product.carouselMedia.find(media => media.imageSrc)?.imageSrc || ''
  wholesaleSpecSelection.value.clear()
  wholesaleSkuPage.value = 1
  wholesaleProduct.value = product
  void nextTick(() => document.querySelector('.wholesale-detail')?.scrollIntoView())
}

watch([productResultTab, productSortMode, shopSearchQuery, productIdSearchQuery, selectedProductMaterial, selectedProductTags, wholesaleKeyword, wholesaleMin, wholesaleMax, wholesaleOrder, wholesaleShape, wholesaleImageMatches], () => {
  currentProductPage.value = 1
})

watch(totalProductPages, (nextPageCount) => {
  if (currentProductPage.value > nextPageCount) {
    currentProductPage.value = nextPageCount
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
    selected: selectionMode.value ? selectedRunIds.value.includes(point.runId) : focusedRunId.value === point.runId,
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

async function fetchWithTimeout(path: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${apiBaseUrl}${path}`, { ...options, signal: controller.signal })
  } catch (requestError) {
    if (controller.signal.aborted) throw new Error('请求超时，请检查后端和 MongoDB 是否运行，然后点击刷新。')
    throw new Error(`无法连接后端服务 ${apiBaseUrl || '当前地址'}，请检查服务是否启动。`, { cause: requestError })
  } finally {
    clearTimeout(timeout)
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(path, {
    headers: {
      'Content-Type': 'application/json'
    }
  }, 15000)

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message || payload?.error || `请求失败（${response.status}）`)
  }

  return normalizeApiAssets(await response.json()) as T
}

function normalizeApiAssets(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith('/api/assets/') ? `${apiBaseUrl}${value}` : value
  if (Array.isArray(value)) return value.map(normalizeApiAssets)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeApiAssets(item)]))
  return value
}

async function apiSend<T>(path: string, method: 'POST' | 'PATCH', body?: unknown): Promise<T> {
  const response = await fetchWithTimeout(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, path.startsWith('/api/trends/sync') ? 120000 : 15000)

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message || payload?.error || '请求失败')
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

function goPrevProductPage() {
  if (currentProductPage.value > 1) {
    currentProductPage.value -= 1
  }
}

function goNextProductPage() {
  if (currentProductPage.value < totalProductPages.value) {
    currentProductPage.value += 1
  }
}

let diffRequestVersion = 0
async function loadDiffs(preserveEdits = false) {
  const requestVersion = ++diffRequestVersion
  diffLoading.value = true

  try {
    const query = buildCompareQuery()
    tagAutoLoading.value = true
    await apiSend<{ matched: number; modified: number }>(`/api/trends/product-tags/auto${query}`, 'POST')
    if (requestVersion !== diffRequestVersion) return
    tagAutoLoading.value = false
    const [diff, overlap, all, shopDiffData] = await Promise.all([
      apiFetch<ProductDiff>(`/api/trends/product-diff${query}`),
      apiFetch<ProductOverlap>(`/api/trends/product-overlap${query}`),
      apiFetch<ProductList>(`/api/trends/product-list${query}`),
      apiFetch<ShopDiff>(`/api/trends/shop-diff${query}`)
    ])
    if (requestVersion !== diffRequestVersion) return
    productDiff.value = diff
    productOverlap.value = overlap
    productAll.value = all
    shopDiff.value = shopDiffData
    if (!preserveEdits) {
      clearProductTags()
      clearProductMaterial()
      tagDrafts.value = {}
      newTagDrafts.value = {}
      materialDrafts.value = {}
    }
  } finally {
    if (requestVersion === diffRequestVersion) {
      tagAutoLoading.value = false
      diffLoading.value = false
    }
  }
}

async function readDashboard(preserveEdits = false) {
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

    if (productTrend.length >= 2 && !selectionMode.value) {
      selectedRunIds.value = productTrend.slice(-2).map((point) => point.runId)
      focusedRunId.value = productTrend[productTrend.length - 1].runId
    } else if (productTrend.length === 1 && !selectionMode.value) {
      focusedRunId.value = productTrend[0].runId
    }

    await loadDiffs(preserveEdits)
}

async function syncInBackground() {
  if (syncing.value) return
  syncing.value = true
  syncError.value = ''
  syncStatus.value = '正在后台检查新抓取，已有数据可继续查看。'
  try {
    const result = await apiSend<{ importedRuns: number; buildInfo: string }>('/api/trends/sync', 'POST', {})
    if (result.buildInfo) console.info(result.buildInfo)
    syncStatus.value = result.importedRuns > 0 ? `已同步 ${result.importedRuns} 轮抓取。` : ''
    if (result.importedRuns > 0) {
      if (loading.value || selectionMode.value || Object.keys(tagDrafts.value).length || Object.keys(materialDrafts.value).length || Object.values(newTagDrafts.value).some(Boolean)) {
        newDataAvailable.value = true
      } else {
        loading.value = true
        try {
          await readDashboard(true)
          newDataAvailable.value = false
        } catch (requestError) {
          newDataAvailable.value = true
          syncError.value = requestError instanceof Error ? requestError.message : '新数据已同步，但更新页面失败。'
        } finally {
          loading.value = false
        }
      }
    }
  } catch (requestError) {
    syncStatus.value = ''
    syncError.value = requestError instanceof Error ? requestError.message : '同步抓取失败'
  } finally {
    syncing.value = false
  }
}

async function loadDashboard() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await readDashboard(true)
    newDataAvailable.value = false
    void syncInBackground()
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : '加载数据失败'
  } finally {
    loading.value = false
  }
}

async function toggleRunSelection(runId: string) {
  if (!selectionMode.value) {
    const index = productTrendPoints.value.findIndex((point) => point.runId === runId)
    if (index < 0) return
    focusedRunId.value = runId
    if (index === 0) {
      const requestVersion = ++diffRequestVersion
      tagAutoLoading.value = false
      diffLoading.value = false
      selectedRunIds.value = [runId]
      productDiff.value = null
      productOverlap.value = null
      shopDiff.value = null
      productAll.value = null
      try {
        const result = await apiFetch<ProductList>(`/api/trends/product-list?${new URLSearchParams({ runId })}`)
        if (requestVersion === diffRequestVersion) productAll.value = result
      } catch (requestError) {
        error.value = requestError instanceof Error ? requestError.message : '加载商品数据失败'
      }
      return
    }
    selectedRunIds.value = [productTrendPoints.value[index - 1].runId, runId]
    try {
      await loadDiffs()
    } catch (requestError) {
      error.value = requestError instanceof Error ? requestError.message : '加载对比数据失败'
    }
    return
  }

  if (selectedRunIds.value.includes(runId)) {
    ++diffRequestVersion
    tagAutoLoading.value = false
    diffLoading.value = false
    selectedRunIds.value = selectedRunIds.value.filter((id) => id !== runId)
    return
  }

  selectedRunIds.value = [...selectedRunIds.value, runId].slice(-2)

  if (selectedRunIds.value.length === 2) {
    try {
      await loadDiffs()
    } catch (requestError) {
      error.value = requestError instanceof Error ? requestError.message : '加载对比数据失败'
    }
  }
}

function toggleSelectionMode() {
  const selectedLast = [...selectedRunIds.value].sort((a, b) => productTrendPoints.value.findIndex((point) => point.runId === a) - productTrendPoints.value.findIndex((point) => point.runId === b)).at(-1)
  selectionMode.value = !selectionMode.value

  if (selectionMode.value) {
    ++diffRequestVersion
    tagAutoLoading.value = false
    diffLoading.value = false
    selectedRunIds.value = []
    return
  }

  const current = selectedLast || focusedRunId.value || productTrendPoints.value.at(-1)?.runId
  if (current) void toggleRunSelection(current)
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

function formatWholesaleSales(sales: number) {
  return sales < 10000 ? String(sales) : (Math.floor(sales / 1000) / 10) + '万+'
}

function formatWholesalePriceRange(product: DiffProduct) {
  const price = formatPrice(product)
  return price.replace(' - ¥', ' - ')
}

function formatWholesaleSku(sku: ProductSku) {
  return sku.specs.map(spec => spec.value).filter(Boolean).join(' / ') || formatSkuSpecs(sku)
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

function formatSkuSpecs(sku: ProductSku) {
  if (sku.specs.length === 0) {
    return '默认规格'
  }

  return sku.specs.map((spec) => `${spec.key}：${spec.value}`).join(' / ')
}

function clearProductTags() {
  selectedProductTags.value = []
}

function clearProductMaterial() {
  selectedProductMaterial.value = ''
}

function setProductResultTab(tab: ProductResultTab) {
  productResultTab.value = tab
  productSortMode.value = 'rank'
  wholesaleOrder.value = 'default'
  clearProductTags()
  clearProductMaterial()
}

async function showShopProducts(shop: DiffShop) {
  shopSearchQuery.value = shop.shopName || shop.shopKey
  selectedShop.value = { name: shop.shopName, url: shop.mallUrl }
  productIdSearchQuery.value = ''
  setProductResultTab('all')
  selectedMetric.value = 'product'
  await nextTick()
  document.querySelector('.product-result-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function getProductKey(product: { runId: string; goodsId: string }) {
  return `${product.runId}:${product.goodsId}`
}

function getInputValue(event: Event) {
  return event.target instanceof HTMLInputElement ? event.target.value : ''
}

function openImagePreview(src: string, title: string) {
  previewMedia.value = {
    type: 'image',
    src,
    poster: '',
    title
  }
}

function openMediaPreview(media: ProductMedia, fallbackTitle: string) {
  previewMedia.value = {
    type: media.type,
    src: media.type === 'video' ? media.videoSrc : media.imageSrc,
    poster: media.imageSrc,
    title: media.title || fallbackTitle
  }
}

function closeMediaPreview() {
  previewMedia.value = null
}

function handlePreviewKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && previewMedia.value) {
    closeMediaPreview()
  }
}

function getEditableTags(product: DiffProduct | ProductOverlapItem) {
  return tagDrafts.value[getProductKey(product)] ?? product.tags
}

function getEditableMaterial(product: DiffProduct | ProductOverlapItem) {
  return materialDrafts.value[getProductKey(product)] ?? product.material
}

function normalizeMaterial(material: string) {
  return material.trim()
}

function normalizeEditableTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

function hasTagChanges(product: DiffProduct | ProductOverlapItem) {
  const currentTags = normalizeEditableTags(product.tags)
  const editableTags = normalizeEditableTags(getEditableTags(product))

  return currentTags.length !== editableTags.length || currentTags.some((tag, index) => tag !== editableTags[index])
}

function hasMaterialChanges(product: DiffProduct | ProductOverlapItem) {
  return normalizeMaterial(product.material) !== normalizeMaterial(getEditableMaterial(product))
}

function setEditableMaterial(product: DiffProduct | ProductOverlapItem, value: string) {
  materialDrafts.value = {
    ...materialDrafts.value,
    [getProductKey(product)]: value
  }
}

function setEditableTag(product: DiffProduct | ProductOverlapItem, index: number, value: string) {
  const key = getProductKey(product)
  const tags = [...getEditableTags(product)]
  tags[index] = value
  tagDrafts.value = {
    ...tagDrafts.value,
    [key]: tags
  }
}

function removeEditableTag(product: DiffProduct | ProductOverlapItem, index: number) {
  const key = getProductKey(product)
  tagDrafts.value = {
    ...tagDrafts.value,
    [key]: getEditableTags(product).filter((_, tagIndex) => tagIndex !== index)
  }
}

function setNewTag(product: DiffProduct | ProductOverlapItem, value: string) {
  newTagDrafts.value = {
    ...newTagDrafts.value,
    [getProductKey(product)]: value
  }
}

function addEditableTag(product: DiffProduct | ProductOverlapItem) {
  const key = getProductKey(product)
  const tag = (newTagDrafts.value[key] ?? '').trim()

  if (!tag) {
    return
  }

  tagDrafts.value = {
    ...tagDrafts.value,
    [key]: [...new Set([...getEditableTags(product), tag])]
  }
  newTagDrafts.value = {
    ...newTagDrafts.value,
    [key]: ''
  }
}

function updateLocalProductTags(runId: string, goodsId: string, tags: string[], tagsSource: string) {
  const updateList = (products: DiffProduct[]) => {
    for (const product of products) {
      if (product.runId === runId && product.goodsId === goodsId) {
        product.tags = tags
        product.tagsSource = tagsSource
      }
    }
  }

  updateList(productDiff.value?.removed ?? [])
  updateList(productDiff.value?.added ?? [])
  updateList(productAll.value?.products ?? [])

  for (const product of productOverlap.value?.products ?? []) {
    if (product.runId === runId && product.goodsId === goodsId) {
      product.tags = tags
      product.tagsSource = tagsSource
    }
  }
}

function updateLocalProductMaterial(runId: string, goodsId: string, material: string, materialSource: string) {
  const updateList = (products: DiffProduct[]) => {
    for (const product of products) {
      if (product.runId === runId && product.goodsId === goodsId) {
        product.material = material
        product.materialSource = materialSource
      }
    }
  }

  updateList(productDiff.value?.removed ?? [])
  updateList(productDiff.value?.added ?? [])
  updateList(productAll.value?.products ?? [])

  for (const product of productOverlap.value?.products ?? []) {
    if (product.runId === runId && product.goodsId === goodsId) {
      product.material = material
      product.materialSource = materialSource
    }
  }
}

const cardTagKey = ref('')
const cardTagText = ref('')
const cardTagError = ref('')
const cardTagHistoryOpen = ref(false)
const cardTagHistoryKey = 'myshop.card-tag-history'
const cardTagHistory = ref<string[]>([])
try {
  const stored: unknown = JSON.parse(localStorage.getItem(cardTagHistoryKey) ?? '[]')
  if (Array.isArray(stored)) {
    cardTagHistory.value = [...new Set(stored.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())))]
  }
} catch {
  // The editor still works when storage is unavailable.
}

function openCardTag(product: DiffProduct) {
  cardTagKey.value = getProductKey(product)
  cardTagText.value = cardTagHistory.value[0] ?? ''
  cardTagError.value = ''
  cardTagHistoryOpen.value = false
}

function pickCardTag(tag: string) {
  cardTagText.value = tag
  cardTagError.value = ''
  cardTagHistoryOpen.value = false
}

async function addCardTag(product: DiffProduct) {
  const tag = cardTagText.value.trim()
  if (!tag || tagSavingKey.value) return
  const tags = product.tags ?? []
  if (tags.includes(tag)) {
    cardTagError.value = '该标签已存在'
    return
  }
  const saved = await saveProductTags(product, [...tags, tag])
  if (saved) {
    cardTagHistory.value = [tag, ...cardTagHistory.value.filter(item => item !== tag)]
    try {
      localStorage.setItem(cardTagHistoryKey, JSON.stringify(cardTagHistory.value))
    } catch {
      // Keep the history available for this session.
    }
    cardTagKey.value = ''
  }
}

async function saveProductTags(product: DiffProduct | ProductOverlapItem, tags?: string[]) {
  if (!tags && !hasTagChanges(product)) {
    return
  }

  const key = getProductKey(product)
  tagSavingKey.value = key

  try {
    const updated = await apiSend<DiffProduct>(
      `/api/trends/products/${encodeURIComponent(product.runId)}/${encodeURIComponent(product.goodsId)}/tags`,
      'PATCH',
      {
        tags: normalizeEditableTags(tags ?? getEditableTags(product))
      }
    )
    updateLocalProductTags(updated.runId, updated.goodsId, updated.tags, updated.tagsSource)
    if (!tags) {
      const { [key]: _removedTagDraft, ...remainingTagDrafts } = tagDrafts.value
      tagDrafts.value = remainingTagDrafts
    }
    return true
  } catch (requestError) {
    const message = requestError instanceof Error ? requestError.message : '保存标签失败'
    if (tags) cardTagError.value = message
    else error.value = message
    return false
  } finally {
    tagSavingKey.value = ''
  }
}

async function saveProductMaterial(product: DiffProduct | ProductOverlapItem) {
  if (!hasMaterialChanges(product)) {
    return
  }

  const key = getProductKey(product)
  materialSavingKey.value = key

  try {
    const updated = await apiSend<DiffProduct>(
      `/api/trends/products/${encodeURIComponent(product.runId)}/${encodeURIComponent(product.goodsId)}/material`,
      'PATCH',
      {
        material: normalizeMaterial(getEditableMaterial(product))
      }
    )
    updateLocalProductMaterial(updated.runId, updated.goodsId, updated.material, updated.materialSource)
    const { [key]: _removedMaterialDraft, ...remainingMaterialDrafts } = materialDrafts.value
    materialDrafts.value = remainingMaterialDrafts
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : '保存材质失败'
  } finally {
    materialSavingKey.value = ''
  }
}

function toggleShopInfo(shopKey: string) {
  openedShopInfoKey.value = openedShopInfoKey.value === shopKey ? '' : shopKey
  openedShopProductKey.value = ''
}

function toggleShopProduct(productKey: string) {
  openedShopProductKey.value = openedShopProductKey.value === productKey ? '' : productKey
}

async function openMerchantBrowser() {
  try {
    const tauri = desktopBridge()
    if (!tauri) throw new Error('请使用桌面程序打开商家后台')
    error.value = ''
    merchantBusy.value = true
    merchantStatus.value = '正在打开商家后台...'
    await tauri.core.invoke('open_merchant_browser')
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : String(requestError)
    merchantBusy.value = false
    merchantStatus.value = ''
  }
}

async function prepareMerchantProduct(product: ListingProduct) {
  const length = Array.from(product.title).reduce((total, char) => total + (char.codePointAt(0)! > 127 ? 2 : 1), 0)
  if (length > 60) {
    titleCorrection.value = { product, title: product.title }
    return
  }
  await chooseMerchantImage(product)
}

async function sendCorrectedTitle() {
  const correction = titleCorrection.value
  if (!correction || !correction.title.trim() || correctedTitleLength.value > 60) return
  titleCorrection.value = null
  await chooseMerchantImage({ ...correction.product, title: correction.title.trim() })
}

function localImageUrl(url: string) {
  try {
    const parsed = new URL(url, location.href)
    return parsed.origin === new URL(apiBaseUrl || location.origin).origin && parsed.pathname === '/api/assets/image'
  } catch {
    return false
  }
}

function checkListingImage(src: string): Promise<string> {
  if (!src || !localImageUrl(src)) return Promise.resolve('没有可用的本地图片。')
  return new Promise((resolve) => {
    const image = new Image()
    const timer = window.setTimeout(() => resolve('图片加载超时，请重试。'), 10000)
    image.onload = () => {
      clearTimeout(timer)
      const { naturalWidth: w, naturalHeight: h } = image
      if (w <= 480 || h <= 480) resolve(`图片尺寸 ${w}×${h}，宽高须大于 480 像素。`)
      else if (w !== h && Math.abs(w * 4 - h * 3) > 4) resolve(`图片尺寸 ${w}×${h}，比例须为 1:1 或 3:4。`)
      else resolve('')
    }
    image.onerror = () => { clearTimeout(timer); resolve('图片无法加载，请选择其他本地图片。') }
    image.src = src
  })
}

async function chooseMerchantImage(product: ListingProduct) {
  error.value = ''
  merchantBusy.value = true
  const message = await checkListingImage(product.imageUrl)
  merchantBusy.value = false
  if (!message) return sendMerchantProduct(product)
  const urls = [...new Set([product.imageUrl, ...product.carouselMedia.filter((item) => item.type === 'image').map((item) => item.imageSrc)].filter((url) => url && localImageUrl(url)))]
  imageChoice.value = { product, urls, selected: '', message }
}

async function sendChosenImage() {
  const choice = imageChoice.value
  if (!choice?.selected) return
  merchantBusy.value = true
  const message = await checkListingImage(choice.selected)
  merchantBusy.value = false
  if (message) { choice.message = message; return }
  imageChoice.value = null
  await sendMerchantProduct({ ...choice.product, imageUrl: choice.selected })
}

async function sendMerchantProduct(product: ListingProduct) {
  try {
    const tauri = desktopBridge()
    if (!tauri) throw new Error('请使用桌面程序准备铺货')
    if (!product.imageUrl || !product.title) throw new Error('商品标题或本地主图缺失，无法准备铺货')
    error.value = ''
    merchantBusy.value = true
    merchantStatus.value = '正在打开商家后台...'
    await tauri.core.invoke('prepare_merchant_product', { product: {
      goodsId: product.goodsId, title: product.title, imageUrl: new URL(product.imageUrl, location.href).href,
      apiOrigin: new URL(apiBaseUrl || location.origin).origin,
    } })
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : String(requestError)
    merchantStatus.value = ''
    merchantBusy.value = false
  }
}

onMounted(() => {
  if (isDesktop) {
    void desktopBridge()?.event.listen('merchant-status', ({ payload }) => {
      if (payload.isError) error.value = payload.message
      merchantStatus.value = payload.isError ? '' : payload.message
      merchantBusy.value = payload.state === 'working'
    }).then((stop) => { stopMerchantStatus = stop })
  }
  window.addEventListener('keydown', handlePreviewKeydown)
  loadDashboard()
})

onUnmounted(() => {
  stopMerchantStatus?.()
  window.removeEventListener('keydown', handlePreviewKeydown)
})
</script>

<template>
  <main class="app-shell" :class="{ 'wholesale-shell': selectedMetric === 'product', 'wholesale-detail-shell': wholesaleProduct }">
    <section v-show="!wholesaleProduct && (selectedMetric !== 'product' || productResultTab !== 'all' || !productAll || wholesaleAnalysisOpen)" class="toolbar">
      <div>
        <p class="eyebrow">PDD Local MVP</p>
        <h1>抓取商品对比</h1>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="secondary-button" @click="selectedMetric = 'product'; setProductResultTab('all'); wholesaleAnalysisOpen = false">商品浏览</button>
        <button v-if="isDesktop" type="button" class="secondary-button" :disabled="merchantBusy" @click="openMerchantBrowser">商家后台</button>
        <button type="button" class="secondary-button" :disabled="loading" @click="loadDashboard">{{ loading ? '加载中…' : '刷新' }}</button>
      </div>
    </section>

    <div v-if="error" class="error status-message" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="secondary-button" :disabled="loading" @click="loadDashboard">重试</button>
    </div>
    <div v-if="syncError && !error" class="error status-message" role="alert">
      <span>后台同步失败：{{ syncError }} 已加载的数据仍可查看。</span>
      <button type="button" class="secondary-button" :disabled="syncing" @click="syncInBackground">重试同步</button>
    </div>
    <p v-if="syncStatus && (selectedMetric !== 'product' || productResultTab !== 'all' || wholesaleAnalysisOpen)" class="muted" role="status">{{ syncStatus }}</p>
    <div v-if="newDataAvailable" class="status-message" role="status">
      <span>新抓取已同步。当前操作保留中，点击刷新可查看新数据。</span>
      <button type="button" class="secondary-button" :disabled="loading" @click="loadDashboard">查看新数据</button>
    </div>
    <p v-if="merchantStatus" class="muted" role="status">{{ merchantStatus }}</p>

    <div v-if="titleCorrection" class="image-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="listing-title-heading" @click.self="titleCorrection = null">
      <div class="listing-title-dialog">
        <h2 id="listing-title-heading">修改商品标题</h2>
        <label for="listing-title-input">商品标题（汉字按 2 个字符计算）</label>
        <textarea id="listing-title-input" v-model="titleCorrection.title" rows="3"></textarea>
        <p class="muted" :class="{ 'listing-title-error': correctedTitleLength > 60 }">{{ correctedTitleLength }} / 60</p>
        <div class="listing-title-actions">
          <button type="button" class="secondary-button" @click="titleCorrection = null">取消</button>
          <button type="button" :disabled="!titleCorrection.title.trim() || correctedTitleLength > 60" @click="sendCorrectedTitle">继续</button>
        </div>
      </div>
    </div>

    <div v-if="imageChoice" class="image-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="listing-image-heading" @click.self="imageChoice = null">
      <div class="listing-title-dialog listing-image-dialog">
        <h2 id="listing-image-heading">选择商品主图</h2>
        <p class="listing-title-error">{{ imageChoice.message }}</p>
        <div class="listing-image-grid">
          <button v-for="(url, index) in imageChoice.urls" :key="url" type="button" :class="{ selected: imageChoice.selected === url }" :aria-label="`选择图片 ${index + 1}`" :aria-pressed="imageChoice.selected === url" @click="imageChoice.selected = url">
            <img :src="url" :alt="`图片 ${index + 1}`" loading="lazy" />
          </button>
        </div>
        <p v-if="!imageChoice.urls.length" class="muted">没有可用的本地图片。</p>
        <div class="listing-title-actions">
          <button type="button" class="secondary-button" @click="imageChoice = null">取消</button>
          <button type="button" :disabled="!imageChoice.selected || merchantBusy" @click="sendChosenImage">继续</button>
        </div>
      </div>
    </div>

    <section v-show="!wholesaleProduct && (selectedMetric !== 'product' || productResultTab !== 'all' || !productAll || wholesaleAnalysisOpen)" class="panel trend-panel">
      <div class="trend-topbar">
        <div class="metric-controls trend-tabs" aria-label="切换趋势指标">
          <button type="button" :class="{ active: selectedMetric === 'product' }" @click="selectedMetric = 'product'">
            商品数量
          </button>
          <button type="button" :class="{ active: selectedMetric === 'shop' }" @click="selectedMetric = 'shop'">
            店铺数量
          </button>
          <button type="button" :class="{ active: selectedMetric === 'sales' }" @click="selectedMetric = 'sales'">
            最高销量商品          </button>
          <button type="button" :class="{ active: selectedMetric === 'salesDelta' }" @click="selectedMetric = 'salesDelta'">
            总销量增量          </button>
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
          {{ formatChange(trendSummary.change) }} {{ metricLabels[selectedMetric].unit }}, {{ trendSummary.percent.toFixed(2) }}%
        </span>
        <span v-else-if="!selectionMode && focusedRunId">首次抓取，没有上次数据</span>
        <span v-if="selectionMode" class="selection-hint">
          已选择 {{ selectedRunIds.length }}/2 个日期        </span>
      </div>

      <p v-if="loading && trendPoints.length === 0" class="muted">正在加载趋势数据...</p>
      <p v-else-if="trendPoints.length === 0 && !error" class="muted">暂无抓取数据。</p>

      <div v-else-if="trendPoints.length > 0" class="trend-chart-wrap">
        <svg
          class="trend-chart"
          :viewBox="'0 0 ' + trendChart.width + ' ' + trendChart.height"
          role="img"
          :aria-label="metricLabels[selectedMetric].title + '趋势图'"
        >
          <line :x1="trendChart.leftX" y1="24" :x2="trendChart.leftX" :y2="trendChart.bottomY" class="chart-axis" />
          <line :x1="trendChart.leftX" :y1="trendChart.zeroY" :x2="trendChart.rightX" :y2="trendChart.zeroY" class="chart-axis" />
          <text x="14" y="31" class="chart-label">{{ trendChart.yMax }}</text>
          <text x="14" :y="trendChart.bottomY + 4" class="chart-label">{{ trendChart.yMin }}</text>
          <path :d="trendChart.linePath" class="chart-line" />

          <g
            v-for="point in trendChart.points"
            :key="point.runId"
            class="chart-point-group selectable"
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


    <p v-if="diffLoading" class="muted">
      {{ tagAutoLoading ? '正在自动打标签并写回 MongoDB...' : '正在更新对比结果...' }}
    </p>

    <section v-if="selectedMetric === 'product' && productDiff && productAll" class="panel product-result-panel wholesale-results">
      <div v-if="!wholesaleProduct" class="wholesale-header">
        <strong class="wholesale-brand">MyShop <span>批发</span></strong>
        <form class="wholesale-search" role="search" @submit.prevent="clearWholesaleImageSearch(); wholesaleKeyword = wholesaleSearch">
          <svg class="wholesale-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input v-model="wholesaleSearch" type="search" aria-label="搜索商品" :placeholder="currentKeyword" @search="!wholesaleSearch && (wholesaleKeyword = '')" />
          <input ref="wholesaleImageInput" type="file" accept="image/*" hidden @change="searchWholesaleImage" />
          <button class="wholesale-image-search" type="button" aria-label="本地图片搜索" title="本地图片搜索" @click="wholesaleImageInput?.click()">
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.5"/></svg>
          </button>
          <button type="submit">搜索</button>
        </form>
        <button v-if="!wholesaleAnalysisOpen" type="button" class="wholesale-analysis-return" @click="wholesaleAnalysisOpen = true; scrollWholesaleListTop()">返回抓取分析</button>
        <button type="button" class="wholesale-cart-button" @click="wholesaleCartOpen = true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 3h2l2.5 12h12l2.5-9H5"/><circle cx="8" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>
          <span>本地购物车（{{ wholesaleCartCount }}）</span>
        </button>
      </div>
      <div v-show="!wholesaleProduct && (productResultTab !== 'all' || wholesaleAnalysisOpen)" class="result-tabs">
        <button type="button" :class="{ active: productResultTab === 'removed' }" @click="setProductResultTab('removed')">
          本次未出现          <span>{{ productDiff?.removed.length ?? 0 }}</span>
        </button>
        <button type="button" :class="{ active: productResultTab === 'added' }" @click="setProductResultTab('added')">
          本次新出现          <span>{{ productDiff?.added.length ?? 0 }}</span>
        </button>
        <button type="button" :class="{ active: productResultTab === 'overlap' }" @click="setProductResultTab('overlap')">
          持续存在
          <span>{{ productOverlap?.products.length ?? 0 }}</span>
        </button>
        <button type="button" :class="{ active: productResultTab === 'all' }" @click="setProductResultTab('all')">
          所有商品          <span>{{ productAll?.products.length ?? 0 }}</span>
        </button>
      </div>

      <div v-show="!wholesaleProduct && (productResultTab !== 'all' || wholesaleAnalysisOpen || shopSearchQuery || productIdSearchQuery)" class="product-sort-controls">
        <span v-if="productResultTab !== 'all'">排序</span>
        <button v-if="productResultTab !== 'all'" type="button" :class="{ active: productSortMode === 'rank' }" @click="productSortMode = 'rank'; wholesaleOrder = 'default'">
          按排名排序
        </button>
        <button v-if="productResultTab !== 'all'" type="button" :class="{ active: productSortMode === 'comments' }" @click="productSortMode = 'comments'; wholesaleOrder = 'default'">
          按评论数排序
        </button>
        <button v-if="productResultTab !== 'all'" type="button" :class="{ active: productSortMode === 'sales' }" @click="productSortMode = 'sales'; wholesaleOrder = 'sales'">
          按销量排序
        </button>
        <label class="shop-search-control">
          <span>搜索店铺</span>
          <input v-model="shopSearchQuery" type="search" placeholder="输入店铺名" @input="selectedShop = null" />
        </label>
        <label class="shop-search-control">
          <span>商品 ID</span>
          <input v-model="productIdSearchQuery" type="search" placeholder="输入商品 ID" />
        </label>
      </div>

      <div v-if="productMaterialOptions.length > 0" v-show="!wholesaleProduct && (productResultTab !== 'all' || wholesaleAnalysisOpen || selectedProductMaterial)" class="product-material-filter">
        <span>材质</span>
        <button type="button" :class="{ active: selectedProductMaterial === '' }" @click="clearProductMaterial">
          全部
        </button>
        <button
          v-for="option in productMaterialOptions"
          :key="option.material"
          type="button"
          :class="{ active: selectedProductMaterial === option.material }"
          @click="selectedProductMaterial = option.material"
        >
          {{ option.material }}
          <small>{{ option.count }}</small>
        </button>
      </div>

      <div v-if="productTagOptions.length > 0" v-show="!wholesaleProduct && (productResultTab !== 'all' || wholesaleAnalysisOpen || selectedProductTags.length)" class="product-tag-filter">
        <span>标签</span>
        <button type="button" :class="{ active: selectedProductTags.length === 0 }" @click="clearProductTags">
          全部
        </button>
        <label
          v-for="option in productTagOptions"
          :key="option.tag"
          class="tag-filter-chip"
          :class="{ active: selectedProductTags.includes(option.tag) }"
        >
          <input v-model="selectedProductTags" type="checkbox" :value="option.tag" />
          {{ option.tag }}
          <small>{{ option.count }}</small>
        </label>
      </div>

      <section v-if="wholesaleProduct" class="wholesale-detail">
        <aside class="wholesale-side-tools" aria-label="商品快捷操作">
          <button type="button" @click="wholesaleCartOpen = true">本地购物车</button>
          <button type="button" @click="scrollWholesaleTop">回到顶部</button>
        </aside>
        <nav>
          <button type="button" @click="closeWholesale">{{ productResultTab === 'all' ? '返回所有商品' : '返回商品列表' }}</button>
          <a v-if="wholesaleProduct.goodsUrl" :href="wholesaleProduct.goodsUrl" target="_blank" rel="noreferrer" @click="openWholesaleOriginal($event, wholesaleProduct.goodsUrl)">查看批发原页</a>
          <button type="button" @click="wholesaleCartOpen = true">本地购物车（{{ wholesaleCartCount }}）</button>
        </nav>
        <div class="wholesale-detail-columns">
          <aside>
            <button v-if="wholesaleImage" class="wholesale-main-image-button" type="button" aria-label="放大商品主图" title="放大商品主图"
              @click="openImagePreview(wholesaleImage, wholesaleProduct.title || wholesaleProduct.goodsId)">
              <img class="wholesale-main-image" :src="wholesaleImage" :alt="wholesaleProduct.title" />
            </button>
            <div v-if="wholesaleProduct.carouselMedia.length" class="wholesale-gallery">
              <button type="button" aria-label="上一组商品图片" @click="scrollWholesaleThumbs(-1)">‹</button>
              <div ref="wholesaleThumbStrip" class="wholesale-thumbs">
              <button v-for="media in wholesaleProduct.carouselMedia" :key="media.id" type="button"
                :aria-label="media.title" :aria-pressed="media.type === 'image' && wholesaleImage === media.imageSrc"
                @click="media.type === 'video' ? openMediaPreview(media, wholesaleProduct.title) : wholesaleImage = media.imageSrc">
                <img v-if="media.imageSrc" :src="media.imageSrc" :alt="media.title" />
                <span v-else>播放视频</span>
              </button>
              </div>
              <button type="button" aria-label="下一组商品图片" @click="scrollWholesaleThumbs(1)">›</button>
            </div>
            <div class="wholesale-shop">
              <strong>店铺信息</strong>
              <div class="wholesale-shop-profile">
                <img v-if="wholesaleProduct.shopLogo" :src="wholesaleProduct.shopLogo" alt="" />
                <a v-if="wholesaleProduct.mallUrl" :href="wholesaleProduct.mallUrl" target="_blank" rel="noreferrer">{{ wholesaleProduct.shopName || '查看店铺' }} ›</a>
                <span v-else>{{ wholesaleProduct.shopName || '未记录店铺' }}</span>
              </div>
            </div>
            <details class="wholesale-local-edit">
              <summary>编辑本地资料</summary>
              <div class="product-material-editor">
                <label>
                  <span>材质</span>
                  <input :value="getEditableMaterial(wholesaleProduct)" type="text"
                    @input="setEditableMaterial(wholesaleProduct, getInputValue($event))" />
                </label>
                <button type="button" :disabled="materialSavingKey === getProductKey(wholesaleProduct) || !hasMaterialChanges(wholesaleProduct)"
                  @click="saveProductMaterial(wholesaleProduct)">保存材质</button>
              </div>
              <div class="product-tags-editor">
                <span>标签</span>
                <div class="editable-tags">
                  <label v-for="(tag, index) in getEditableTags(wholesaleProduct)" :key="index" class="editable-tag">
                    <input :value="tag" type="text" :aria-label="'标签 ' + (index + 1)"
                      @input="setEditableTag(wholesaleProduct, index, getInputValue($event))" />
                    <button type="button" aria-label="删除标签" @click="removeEditableTag(wholesaleProduct, index)">×</button>
                  </label>
                </div>
                <div class="tag-add-row">
                  <input :value="newTagDrafts[getProductKey(wholesaleProduct)] ?? ''" type="text" aria-label="新增标签" placeholder="新增标签"
                    @input="setNewTag(wholesaleProduct, getInputValue($event))" @keydown.enter.prevent="addEditableTag(wholesaleProduct)" />
                  <button type="button" @click="addEditableTag(wholesaleProduct)">添加</button>
                  <button type="button" :disabled="tagSavingKey === getProductKey(wholesaleProduct) || !hasTagChanges(wholesaleProduct)"
                    @click="saveProductTags(wholesaleProduct)">保存标签</button>
                </div>
              </div>
            </details>
          </aside>
          <div>
            <div class="wholesale-title-row">
              <h2>{{ wholesaleProduct.title || wholesaleProduct.goodsId }}</h2>
              <button v-if="wholesaleProduct.goodsUrl" type="button" aria-label="复制原商品链接" @click="copyWholesaleLink">分享商品</button>
              <span v-if="wholesaleShareStatus" role="status">{{ wholesaleShareStatus }}</span>
            </div>
            <div class="wholesale-price-panel">
              <dl class="wholesale-tiers wholesale-price-head">
                <dt>批发价</dt><dd><strong>{{ formatWholesalePriceRange(wholesaleProduct) }}</strong></dd>
              </dl>
              <span v-if="wholesaleProduct.salesTipAmount !== null" class="wholesale-detail-sales">已售<b>{{ formatWholesaleSales(wholesaleProduct.salesTipAmount) }}</b>件</span>
              <dl v-if="wholesaleOriginalPrice" class="wholesale-tiers wholesale-original">
                <dt>原价</dt><dd>{{ wholesaleOriginalPrice }}</dd>
              </dl>
              <dl v-if="wholesaleProduct.priceTiers?.length" class="wholesale-tiers">
                <dt>批发规则</dt>
                <dd>
                  <span v-for="tier in wholesaleProduct.priceTiers" :key="tier.stageStartValue">
                    ≥{{ tier.stageStartValue }}件 <b>{{ tier.stageDiscount / 10 }}折</b>
                  </span>
                </dd>
              </dl>
              <dl v-if="wholesaleMinimumOrder" class="wholesale-tiers wholesale-minimum">
                <dt>起批量</dt><dd>{{ wholesaleMinimumOrder }}件</dd>
              </dl>
              <dl v-if="wholesaleProduct.serviceTags?.length" class="wholesale-tiers wholesale-services">
                <dt>专享服务</dt>
                <dd class="wholesale-badges"><small v-for="tag in wholesaleProduct.serviceTags" :key="tag">{{ tag }}</small></dd>
              </dl>
            </div>
            <div v-if="wholesaleSpecGroups.length" class="wholesale-options">
              <div v-for="group in wholesaleSpecGroups" :key="group.key" class="wholesale-option-group" role="group" :aria-label="group.key">
                <span>{{ group.key }}</span>
                <button type="button" :aria-pressed="!wholesaleSpecSelection.has(group.key)" @click="selectWholesaleSpec(group.key, '')">全部</button>
                <div>
                  <button v-for="value in group.values" :key="value" type="button"
                    :aria-pressed="wholesaleSpecSelection.get(group.key) === value" @click="selectWholesaleSpec(group.key, value)">{{ value }}</button>
                </div>
              </div>
            </div>
            <p v-if="wholesaleSpecSelection.size && !wholesaleSkuRows.length">没有符合所选条件的规格。</p>
            <div v-for="sku in wholesaleSkuRows.slice((wholesaleSkuPage - 1) * wholesaleSkuPageSize, wholesaleSkuPage * wholesaleSkuPageSize)" :key="sku.skuId" class="wholesale-sku-row">
              <img v-if="sku.thumbUrl" :src="sku.thumbUrl" :alt="formatWholesaleSku(sku)" />
              <span class="wholesale-sku-title">{{ formatWholesaleSku(sku) }}</span>
              <span class="wholesale-sku-price">{{ sku.wholesalePriceYuan === null ? '暂无报价' : '¥' + sku.wholesalePriceYuan.toFixed(2) }}</span>
              <div v-if="sku.wholesalePriceYuan !== null" class="wholesale-quantity">
                <button type="button" aria-label="减少数量" :disabled="!wholesaleQuantities[sku.skuId]" @click="setWholesaleQuantity(sku, (wholesaleQuantities[sku.skuId] ?? 0) - 1)">−</button>
                <input type="number" min="0" step="1" :aria-label="formatSkuSpecs(sku) + ' 数量'" :value="wholesaleQuantities[sku.skuId] ?? 0"
                  :disabled="sku.quantity === 0" @change="setWholesaleQuantity(sku, Number(getInputValue($event))); ($event.target as HTMLInputElement).value = String(wholesaleQuantities[sku.skuId])" />
                <button type="button" aria-label="增加数量" :disabled="sku.quantity !== null && (wholesaleQuantities[sku.skuId] ?? 0) >= sku.quantity" @click="setWholesaleQuantity(sku, (wholesaleQuantities[sku.skuId] ?? 0) + 1)">+</button>
              </div>
            </div>
            <div v-if="wholesaleSkuPageCount > 1" class="wholesale-sku-pages" aria-label="规格分页">
              <button v-for="page in wholesaleSkuPageCount" :key="page" type="button" :aria-current="page === wholesaleSkuPage ? 'page' : undefined" @click="wholesaleSkuPage = page">{{ page }}</button>
            </div>
            <div class="wholesale-actions">
              <button v-if="isDesktop || listedGoods.has(wholesaleProduct.goodsId)" type="button" class="wholesale-list-now"
                :disabled="merchantBusy || listedGoods.has(wholesaleProduct.goodsId)" @click="prepareMerchantProduct(wholesaleProduct)">
                {{ listedGoods.has(wholesaleProduct.goodsId) ? '已经铺货' : '立即铺货' }}
              </button>
              <a v-if="wholesaleProduct.goodsUrl" class="wholesale-buy-now" :href="wholesaleProduct.goodsUrl" target="_blank"
                rel="noreferrer" @click="openWholesaleOriginal($event, wholesaleProduct.goodsUrl)">立即购买</a>
              <button v-if="isDesktop && !listedGoods.has(wholesaleProduct.goodsId)" type="button" class="wholesale-confirm-listed"
                :disabled="merchantBusy" @click="confirmListedGoods(wholesaleProduct.goodsId)">确认已发布</button>
            </div>
            <div v-if="wholesaleSelection.count" class="wholesale-selection">
              <span>已选规格：{{ wholesaleSelection.count }} 件</span>
              <strong v-if="wholesaleSelection.count">参考合计 ¥{{ (wholesaleSelection.cents / 100).toFixed(2) }}</strong>
              <button type="button" :disabled="!wholesaleSelection.count" @click="addWholesaleSelection">加入本地购物车</button>
            </div>
          </div>
        </div>
        <div class="wholesale-intro">
          <button type="button" :aria-pressed="wholesaleTab === 'intro'" @click="selectWholesaleTab('intro')">商品介绍</button>
          <button type="button" :aria-pressed="wholesaleTab === 'reviews'" @click="selectWholesaleTab('reviews')">商品评价{{ wholesaleProduct.commentCount === null ? '' : '(' + wholesaleProduct.commentCount + ')' }}</button>
          <button type="button" :aria-pressed="wholesaleTab === 'questions'" @click="selectWholesaleTab('questions')">客服答疑{{ wholesaleProduct.questionCount == null ? '' : '(' + wholesaleProduct.questionCount + ')' }}</button>
        </div>
        <template v-if="wholesaleTab === 'intro'">
        <dl v-if="wholesaleProduct.properties?.length || wholesaleProduct.material" class="wholesale-properties">
          <div v-for="property in wholesaleProduct.properties" :key="property.name">
            <dt>{{ property.name }}</dt>
            <dd>{{ property.values.join('；') }}</dd>
          </div>
          <div v-if="wholesaleProduct.material && !wholesaleProduct.properties?.some(property => property.name === '材质')">
            <dt>材质</dt><dd>{{ wholesaleProduct.material }}</dd>
          </div>
        </dl>
        <div class="wholesale-detail-media">
          <template v-for="media in wholesaleProduct.detailMedia" :key="media.id">
            <video v-if="media.type === 'video' && media.videoSrc" :src="media.videoSrc" :poster="media.imageSrc || undefined" controls preload="none" />
            <img v-else-if="media.imageSrc" :src="media.imageSrc" :alt="media.title" loading="lazy" />
          </template>
        </div>
        </template>
        <div v-else class="wholesale-discussion" aria-live="polite">
          <p v-if="wholesaleDiscussionState === 'loading'">正在读取本地记录…</p>
          <p v-else-if="wholesaleDiscussionState === 'error'">读取失败。<button type="button" @click="selectWholesaleTab(wholesaleTab)">重试</button></p>
          <template v-else-if="wholesaleTab === 'reviews' && wholesaleDiscussion?.reviews.length">
            <article v-for="(review, index) in wholesaleDiscussion.reviews" :key="index">
              <div class="wholesale-review-meta">
                <strong v-if="review.name">{{ review.name }}</strong>
                <span>{{ review.specs }}</span>
                <time>{{ wholesaleReviewDate(review.time) }}</time>
              </div>
              <p v-if="review.comment">{{ review.comment }}</p>
              <div v-if="review.images.length" class="wholesale-review-images">
                <button v-for="src in review.images" :key="src" type="button" aria-label="查看评价图片" @click="openImagePreview(src, '评价图片')">
                  <img :src="src" alt="" loading="lazy" />
                </button>
              </div>
            </article>
          </template>
          <template v-else-if="wholesaleTab === 'questions' && wholesaleDiscussion?.questions.length">
            <article v-for="(item, index) in wholesaleDiscussion.questions" :key="index">
              <strong>{{ item.question }}</strong><p v-if="item.answer">{{ item.answer }}</p>
            </article>
          </template>
          <p v-else>本地没有保存这部分内容。</p>
        </div>
      </section>
      <section v-else class="diff-section wholesale-catalogue">
        <aside class="wholesale-list-tools" aria-label="列表快捷操作">
          <button type="button" @click="wholesaleCartOpen = true">本地购物车</button>
          <button type="button" @click="scrollWholesaleListTop">回到顶部</button>
        </aside>
        <div v-if="wholesaleShapes.length" class="wholesale-shapes" aria-label="外观造型">
          <button type="button" :aria-pressed="!wholesaleShape" @click="wholesaleShape = ''">外观造型</button>
          <button v-for="shape in wholesaleShapes" :key="shape" type="button" :aria-pressed="wholesaleShape === shape" @click="wholesaleShape = wholesaleShape === shape ? '' : shape">{{ shape }}</button>
        </div>
        <div class="wholesale-sort">
          <button type="button" :aria-pressed="wholesaleOrder === 'default'" @click="wholesaleOrder = 'default'">{{ wholesaleImageMatches ? '相似度' : '默认排序' }}</button>
          <button type="button" :aria-pressed="wholesaleOrder === 'sales'" @click="wholesaleOrder = 'sales'">销量</button>
          <button type="button" :aria-pressed="wholesaleOrder.startsWith('price')" @click="wholesaleOrder = wholesaleOrder === 'price-asc' ? 'price-desc' : 'price-asc'">
            价格 {{ wholesaleOrder === 'price-asc' ? '↑' : wholesaleOrder === 'price-desc' ? '↓' : '↕' }}
          </button>
          <label><input v-model.number="wholesaleMin" type="number" min="0" step="0.01" aria-label="起始价" placeholder="起始价" /> 元</label>
          <label><input v-model.number="wholesaleMax" type="number" min="0" step="0.01" aria-label="最高价" placeholder="最高价" /> 元</label>
          <span class="wholesale-result-count" aria-live="polite">{{ allProducts.length }} 个商品</span>
          <button type="button" class="wholesale-analysis-toggle" :aria-expanded="wholesaleAnalysisOpen" @click="wholesaleAnalysisOpen = !wholesaleAnalysisOpen; scrollWholesaleListTop()">{{ wholesaleAnalysisOpen ? '收起抓取分析' : '返回抓取分析' }}</button>
        </div>
        <p v-if="wholesaleImageBusy" role="status">正在比对本地封面…</p>
        <p v-else-if="wholesaleImageError" role="status">{{ wholesaleImageError }}</p>
        <p v-else-if="wholesaleImageMatches" role="status">相似封面：{{ allProducts.length }} 个 <button type="button" @click="clearWholesaleImageSearch">清除</button></p>
        <p v-else-if="!pagedAllProducts.length">没有符合条件的商品</p>
        <div class="wholesale-grid">
          <article v-for="product in pagedAllProducts" :key="product.goodsId" class="wholesale-card-item">
          <button type="button" class="wholesale-card" :data-goods-id="product.goodsId" @click="openWholesale(product)">
            <span class="wholesale-card-image">
              <img v-if="product.listingImageUrl || product.imageUrl" :src="product.listingImageUrl || product.imageUrl" alt="" loading="lazy"
                @error="(event) => { const img = event.currentTarget as HTMLImageElement; if (product.imageUrl && img.getAttribute('src') !== product.imageUrl) img.src = product.imageUrl }" />
              <span v-else class="wholesale-image-missing">暂无图片</span>
            </span>
            <span class="wholesale-card-title" :title="product.listingTitle || product.title">{{ product.listingTitle || product.title || product.goodsId }}</span>
            <span class="wholesale-badges">
              <small v-for="tag in product.serviceTags?.slice(0, 2)" :key="tag">{{ tag }}</small>
            </span>
            <span class="wholesale-card-price">
              <strong v-if="product.minWholesalePriceYuan !== null"><span class="wholesale-currency">¥</span>{{ product.minWholesalePriceYuan.toFixed(2) }}</strong>
              <strong v-else class="wholesale-unpriced">暂无报价</strong>
              <small v-if="product.salesTipAmount !== null">已售{{ formatWholesaleSales(product.salesTipAmount) }}件</small>
            </span>
            <span class="wholesale-card-shop">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 9l2-5h14l2 5s0 3-3 3-3-3-3-3 0 3-3 3-3-3-3-3 0 3-3 3-3-3-3-3zM5 12v8h14v-8M9 16h6"/></svg>
              <span>{{ product.shopName || '未记录店铺' }}</span><small v-if="product.address">{{ product.address }}</small>
            </span>
          </button>
          <div class="wholesale-card-tools">
            <form v-if="cardTagKey === getProductKey(product)" @submit.prevent="addCardTag(product)">
              <div class="card-tag-combobox" @focusout="(event) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) cardTagHistoryOpen = false }" @keydown.esc="cardTagHistoryOpen = false">
                <input v-model="cardTagText" aria-label="标签名称" placeholder="标签名称" @input="cardTagError = ''" />
                <button v-if="cardTagHistory.length" type="button" class="card-tag-arrow" aria-label="选择历史标签" :aria-expanded="cardTagHistoryOpen" :disabled="!!tagSavingKey" @click="cardTagHistoryOpen = !cardTagHistoryOpen">▾</button>
                <div v-if="cardTagHistoryOpen" class="card-tag-options">
                  <button v-for="tag in cardTagHistory" :key="tag" type="button" @click="pickCardTag(tag)">{{ tag }}</button>
                </div>
              </div>
              <button type="submit" :disabled="!!tagSavingKey || !cardTagText.trim()">保存</button>
              <button type="button" :disabled="!!tagSavingKey" @click="cardTagKey = ''">取消</button>
              <small v-if="cardTagError" role="alert">{{ cardTagError }}</small>
            </form>
            <template v-else>
              <button type="button" :disabled="!!tagSavingKey" @click="openCardTag(product)">添加标签</button>
              <span class="wholesale-card-tags">{{ product.tags?.join('、') }}</span>
            </template>
          </div>
          </article>
        </div>
      </section>

      <div v-if="!wholesaleProduct" class="product-pager">
        <button type="button" :disabled="currentProductPage <= 1" @click="goPrevProductPage">上一页</button>
        <span>第 {{ currentProductPage }} / {{ totalProductPages }} 页</span>
        <button type="button" :disabled="currentProductPage >= totalProductPages" @click="goNextProductPage">下一页</button>
      </div>
    </section>

    <section v-if="selectedMetric === 'shop'" class="panel">
      <div class="result-tabs">
        <button type="button" :class="{ active: shopView === 'comparison' }" @click="shopView = 'comparison'">店铺对比</button>
        <button type="button" :class="{ active: shopView === 'all' }" @click="shopView = 'all'">所有店铺 <span>{{ shopDiff?.all?.length ?? 0 }}</span></button>
      </div>
      <template v-if="shopView === 'all'">
        <div class="product-sort-controls">
          <label class="shop-search-control"><span>搜索店铺</span><input v-model="allShopQuery" type="search" placeholder="输入店铺名或标识" /></label>
        </div>
        <div class="panel-heading"><div><p class="eyebrow">对比终点这一轮抓取</p><h2>所有店铺</h2></div><span>{{ filteredShops.length }} 个</span></div>
        <p v-if="!filteredShops.length" class="muted">没有找到店铺。</p>
        <article v-for="shop in filteredShops" :key="shop.shopKey" class="shop-card">
          <div class="shop-card-heading">
            <img v-if="shop.mallLogo" :src="shop.mallLogo" :alt="shop.shopName" loading="lazy" />
            <div><h3>{{ shop.shopName || shop.shopKey }}</h3><div class="shop-stats"><button type="button" class="shop-product-count" @click="showShopProducts(shop)">商品数：{{ shop.productCount }}</button><span>最好排名：{{ shop.topRank ?? '-' }}</span><span>总销量：{{ shop.totalSalesTipAmount }}</span></div></div>
          </div>
          <div class="shop-products"><div v-for="product in shop.products" :key="product.goodsId" class="shop-product-row"><span>{{ product.title || product.goodsId }}</span><strong>{{ formatProductPrice(product) }}</strong></div></div>
          <div class="shop-actions"><button type="button" class="link-button" @click="toggleShopInfo('all:' + shop.shopKey)">店铺信息</button><a v-if="shop.mallUrl" :href="shop.mallUrl" target="_blank" rel="noreferrer">打开店铺</a></div>
          <div v-if="openedShopInfoKey === 'all:' + shop.shopKey" class="shop-info-panel"><dl><div><dt>店铺标识</dt><dd>{{ shop.shopKey }}</dd></div><div><dt>本轮商品数</dt><dd>{{ shop.productCount }}</dd></div><div><dt>商品总销量</dt><dd>{{ shop.totalSalesTipAmount }}</dd></div></dl></div>
        </article>
      </template>
    </section>
    <section v-if="selectedMetric === 'shop' && shopView === 'comparison'" class="diff-grid">
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
          <div v-if="openedShopInfoKey === 'removed:' + shop.shopKey" class="shop-info-panel">
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
                  <button type="button" class="inline-link" @click="toggleShopProduct('removed:' + shop.shopKey + ':' + product.goodsId)">
                    {{ product.goodsId }}
                  </button>
                  · 排名:{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }}
                </p>
                <div v-if="openedShopProductKey === 'removed:' + shop.shopKey + ':' + product.goodsId" class="product-info-panel">
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
            <button type="button" class="link-button" @click="toggleShopInfo('removed:' + shop.shopKey)">
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
          <div v-if="openedShopInfoKey === 'added:' + shop.shopKey" class="shop-info-panel">
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
                  <button type="button" class="inline-link" @click="toggleShopProduct('added:' + shop.shopKey + ':' + product.goodsId)">
                    {{ product.goodsId }}
                  </button>
                  · 排名:{{ product.rank ?? '-' }} · 销量：{{ product.salesTipAmount ?? '-' }}
                </p>
                <div v-if="openedShopProductKey === 'added:' + shop.shopKey + ':' + product.goodsId" class="product-info-panel">
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
            <button type="button" class="link-button" @click="toggleShopInfo('added:' + shop.shopKey)">
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
          <button
            v-if="point.product.imageUrl"
            type="button"
            class="product-image-button"
            @click="openImagePreview(point.product.imageUrl, point.product.title || point.product.goodsId)"
          >
            <img :src="point.product.imageUrl" :alt="point.product.title" loading="lazy" />
          </button>
          <div class="sales-card-body">
            <div>
              <p class="eyebrow">{{ formatDate(point.crawlTime) }}</p>
              <h3>{{ point.product.title || point.product.goodsId }}</h3>
            </div>
            <strong>{{ point.salesTipAmount }} 销量</strong>
            <p class="muted">
              商品ID:{{ point.product.goodsId }} · 排名:{{ point.product.rank ?? '-' }} · 店铺:{{ point.product.shopName || '-' }}
            </p>
            <p class="muted">
              价格:{{ formatPrice(point.product) }} · SKU:{{ point.product.skuCount ?? '-' }}
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

    <div v-if="previewMedia" class="image-preview-overlay" role="dialog" aria-modal="true" @click.self="closeMediaPreview">
      <div class="image-preview-dialog">
        <div class="image-preview-toolbar">
          <strong>{{ previewMedia.title }}</strong>
          <button type="button" aria-label="关闭媒体预览" @click="closeMediaPreview">关闭</button>
        </div>
        <img v-if="previewMedia.type === 'image'" :src="previewMedia.src" :alt="previewMedia.title" />
        <video v-else :src="previewMedia.src" :poster="previewMedia.poster || undefined" controls autoplay />
      </div>
    </div>
    <Teleport to="body">
      <dialog ref="wholesaleCartDialog" class="wholesale-cart" aria-label="本地购物车" @close="wholesaleCartOpen = false">
          <header><strong>本地购物车（{{ wholesaleCartCount }}）</strong><button type="button" aria-label="关闭购物车" @click="wholesaleCartOpen = false">×</button></header>
          <p v-if="!wholesaleCart.length">购物车为空</p>
          <article v-for="(item, index) in wholesaleCart" :key="item.goodsId + ':' + item.skuId">
            <div><strong>{{ item.title }}</strong><p>{{ item.specs }} · {{ item.count }} 件</p></div>
            <a v-if="item.goodsUrl" :href="item.goodsUrl" target="_blank" rel="noreferrer">批发原页</a>
            <button type="button" @click="wholesaleCart.splice(index, 1)">移除</button>
          </article>
      </dialog>
    </Teleport>
  </main>
</template>

<style scoped>
.wholesale-header { position:relative; isolation:isolate; display:grid; grid-template-columns:minmax(140px,1fr) minmax(0,775px) minmax(160px,1fr); align-items:center; gap:20px; min-height:83px; padding:0 12px; background:white; }
.wholesale-header::before { content:""; position:absolute; z-index:-1; inset:0; background:white; box-shadow:0 0 0 100vmax white; clip-path:inset(0 -100vmax); pointer-events:none; }
.wholesale-brand { color:#ff3030; font-size:26px; }
.wholesale-brand span { font-size:18px; margin-left:8px; }
.wholesale-cart-button { justify-self:end; display:flex; align-items:center; justify-content:center; gap:8px; border:1px solid #eee; border-radius:28px; color:#ff3030; background:white; padding:10px 16px; }
@media (min-width:1666px) {
  .wholesale-header { padding-inline:0; }
  .wholesale-cart-button { width:min(100%,303px); min-height:53px; }
}
:global(body:has(.wholesale-shell:not(.wholesale-detail-shell))) { background:#f2f2f2; }
:global(body:has(.wholesale-detail-shell)) { background:white; }
.wholesale-cart { width:min(650px,calc(100% - 32px)); max-height:85vh; overflow:auto; background:white; padding:16px; border:0; border-radius:6px; }
.wholesale-cart::backdrop { background:#0006; }
.wholesale-cart header, .wholesale-cart article { display:flex; align-items:center; gap:12px; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eee; }
.wholesale-cart article div { flex:1; min-width:0; overflow-wrap:anywhere; }
.wholesale-cart article p { margin:4px 0; }
@media (max-width:680px) { .wholesale-header { grid-template-columns:1fr auto; gap:8px; } .wholesale-header .wholesale-search { grid-row:2; grid-column:1 / -1; margin:0 0 8px; } }
.app-shell.wholesale-shell { width:min(1500px, calc(100% - 32px)); }
.app-shell.wholesale-shell:not(.wholesale-detail-shell) { padding-top:14px; }
.wholesale-list-tools { display:none; }
@media (min-width:1666px) {
  .app-shell.wholesale-shell:not(.wholesale-detail-shell) { margin-left:calc((100% - 1634px) / 2); }
  .wholesale-list-tools { position:fixed; left:calc((100% - 1634px) / 2 + 1524px); bottom:48px; z-index:3; display:grid; width:80px; border:1px solid #ebebeb; background:white; }
  .wholesale-list-tools button { border:0; border-radius:0; background:white; padding:12px 3px; font-size:12px; color:#666; }
  .wholesale-list-tools button:first-child { color:#fb3434; border-bottom:1px solid #ebebeb; }
}
.app-shell.wholesale-detail-shell { width:min(1200px, 100%); padding-top:0; }
.wholesale-results { grid-template-columns:minmax(0,1fr); gap:0; padding:0; border:0; border-radius:0; box-shadow:none; }
.wholesale-results .wholesale-catalogue { gap:0; }
.wholesale-results .product-pager { padding-block:12px; }
.wholesale-search { display:flex; width:min(100%,775px); min-height:53px; margin:12px auto; border:2px solid #fb3434; border-radius:27px; overflow:hidden; background:white; }
.wholesale-search input { flex:1; min-width:0; padding:10px 18px; border:0; background:white; }
.wholesale-search-icon { flex:none; align-self:center; margin-left:15px; color:#aaa; }
.wholesale-search input[type="search"] { padding-left:10px; }
.wholesale-search button[type="submit"] { flex:0 0 120px; background:#fb3434; color:white; border:0; border-radius:0; padding:10px 16px; }
.wholesale-search .wholesale-image-search { flex:0 0 44px; display:grid; place-items:center; padding:0; border:0; background:white; color:#777; }
@media (max-width:680px) { .wholesale-search button[type="submit"] { flex-basis:72px; } }
.wholesale-sort { display:flex; align-items:center; flex-wrap:wrap; min-height:50px; background:white; border:1px solid #e8e8e8; }
.wholesale-shapes { display:flex; gap:8px; overflow-x:auto; min-height:43px; border:1px solid #e8e8e8; background:white; margin-bottom:15px; }
.wholesale-shapes button { flex:none; padding:10px 18px; border:0; border-radius:0; background:white; color:#333; }
.wholesale-shapes button:first-child { border-right:1px solid #e8e8e8; background:#f8f8f8; }
.wholesale-shapes button[aria-pressed="true"]:not(:first-child) { color:#ff3030; }
.wholesale-sort button { background:white; border:1px solid transparent; border-right-color:#e8e8e8; border-radius:0; padding:12px 20px; }
.wholesale-sort button[aria-pressed="true"] { color:#ff3030; border-color:#ff3030; }
.wholesale-sort label { display:inline-flex; flex-direction:row; align-items:center; gap:6px; margin:5px 10px; white-space:nowrap; }
.wholesale-sort input { width:78px; padding:4px 8px; border-radius:2px; }
.wholesale-result-count { margin-inline:auto 12px; color:#666; padding:6px 0; white-space:nowrap; }
.wholesale-sort .wholesale-analysis-toggle { border-right:0; border-left:1px solid #e8e8e8; }
.wholesale-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:24px; padding:27px 0 24px; background:#f2f2f2; }
.wholesale-card { display:block; width:100%; padding:0; border:0; border-radius:0; color:#222; background:white; text-align:left; cursor:pointer; overflow:hidden; }
.wholesale-card-image { display:block; width:100%; aspect-ratio:1; overflow:hidden; background:#eee; }
.wholesale-card-image img, .wholesale-image-missing { display:block; width:100%; height:100%; object-fit:cover; }
@media (hover:hover) and (prefers-reduced-motion:no-preference) {
  .wholesale-card-image img { transition:transform .25s; }
  .wholesale-card-image:hover img { transform:scale(1.2); }
}
.wholesale-card-title, .wholesale-card-shop { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding:11px 14px; }
.wholesale-card:hover .wholesale-card-title, .wholesale-card-price strong { color:#fb3434; }
.wholesale-card-price { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:4px; padding:0 14px 12px; }
.wholesale-card-price strong { font-size:22px; font-weight:500; }
.wholesale-card-price .wholesale-currency, .wholesale-card-price .wholesale-unpriced { font-size:14px; }
.wholesale-card-price small, .wholesale-card-shop { color:#777; }
.wholesale-card-shop { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:45px; border-top:1px solid #ebebeb; }
.wholesale-card-shop > svg { flex:none; color:#999; }
.wholesale-card-shop > span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.wholesale-card-shop small { flex:none; font-size:inherit; }
.wholesale-card-item { min-width:0; background:#fff; }
.wholesale-card-tools { display:flex; align-items:center; gap:8px; min-height:42px; padding:6px 12px; border-top:1px solid #ebebeb; }
.wholesale-card-tools form { display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%; }
.wholesale-card-tools input { flex:1 1 80px; min-width:0; padding:4px 6px; }
.card-tag-combobox { position:relative; display:flex; flex:1 1 110px; min-width:0; }
.card-tag-combobox input { width:100%; padding-right:30px; }
.wholesale-card-tools .card-tag-arrow { position:absolute; right:1px; top:1px; bottom:1px; border:0; padding:0 8px; background:transparent; }
.card-tag-options { position:absolute; z-index:20; top:100%; left:0; right:0; max-height:180px; overflow:auto; background:#fff; border:1px solid #cfd8e5; box-shadow:0 4px 12px #0002; }
.wholesale-card-tools .card-tag-options button { display:block; width:100%; border:0; text-align:left; border-radius:0; overflow-wrap:anywhere; }
.wholesale-card-tools .card-tag-options button:hover, .wholesale-card-tools .card-tag-options button:focus { background:#eef4ff; }
.wholesale-card-tools button { flex:none; border:1px solid #cfd8e5; border-radius:4px; padding:4px 8px; background:#fff; color:#253246; }
.wholesale-card-tools [role="alert"] { flex-basis:100%; color:#b91c1c; }
.wholesale-card-tags { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#637083; font-size:12px; }
.wholesale-badges { display:flex; align-items:center; gap:8px; min-height:20px; padding:0 14px; margin:0 0 9px; overflow:hidden; }
.wholesale-badges small { flex:none; border:1px solid #ffd2c5; color:#d34827; padding:0 4px; line-height:18px; }
.wholesale-services { flex-basis:100%; flex-wrap:wrap; padding:12px 0 0; margin:0; border-top:1px solid #e8e8e8; }
.wholesale-detail { background:white; color:#222; }
.wholesale-side-tools { position:fixed; right:12px; bottom:48px; z-index:3; display:grid; width:76px; background:white; border:1px solid #eee; box-shadow:0 2px 8px #0001; }
.wholesale-side-tools button { padding:12px 4px; background:white; border:0; border-radius:0; color:#555; font-size:12px; }
.wholesale-side-tools button + button { border-top:1px solid #eee; }
.wholesale-side-tools button:first-child, .wholesale-side-tools button:hover { color:#ff3030; }
@media (max-width:1350px) { .wholesale-side-tools { display:none; } }
.wholesale-detail nav { position:sticky; top:0; z-index:4; display:flex; flex-wrap:nowrap; align-items:center; gap:8px 22px; height:46px; box-sizing:border-box; padding:5px 12px; background:#f3f3f3; border-bottom:1px solid #eee; font-size:13px; overflow-x:auto; white-space:nowrap; }
.wholesale-detail nav button, .wholesale-detail nav a { padding:3px 0; border:0; border-radius:0; background:transparent; color:#666; text-decoration:none; font:inherit; }
.wholesale-detail nav button { cursor:pointer; }
.wholesale-detail nav button:last-child { margin-left:auto; }
.wholesale-detail nav button:hover, .wholesale-detail nav a:hover { color:#ff3030; }
.wholesale-detail nav :focus-visible { outline:2px solid #ff3030; outline-offset:2px; }
.wholesale-detail-columns { display:grid; grid-template-columns:minmax(0,min(30%,360px)) minmax(0,1fr); gap:24px; margin-top:24px; }
@media (min-width:1000px) and (max-width:1199px) {
  .app-shell.wholesale-detail-shell { width:calc(100% - 14px); margin-left:0; }
  .wholesale-detail-columns { grid-template-columns:minmax(0,29.65%) minmax(0,1fr); }
}
@media (max-width:600px) { .app-shell.wholesale-detail-shell { width:calc(100% - 32px); } }
.wholesale-detail h2 { font-size:18px; margin:0 0 12px; }
.wholesale-title-row { display:flex; align-items:baseline; gap:8px; margin-bottom:8px; }
.wholesale-title-row h2 { flex:1; min-width:0; margin:0; overflow-wrap:anywhere; }
.wholesale-title-row button, .wholesale-title-row span { flex:none; font-size:13px; }
.wholesale-title-row button { padding:2px; border:0; background:transparent; color:#d33; }
.wholesale-main-image-button { display:block; width:100%; padding:0; border:0; background:transparent; border-radius:0; cursor:zoom-in; }
.wholesale-main-image { display:block; width:100%; aspect-ratio:1; object-fit:contain; }
.wholesale-gallery { display:grid; grid-template-columns:24px minmax(0,1fr) 24px; align-items:center; gap:5px; margin:14px 0; }
.wholesale-gallery > button { padding:0; border:0; background:white; color:#888; font-size:24px; }
.wholesale-thumbs { display:flex; overflow:auto; scrollbar-width:none; gap:8px; }
.wholesale-thumbs button { flex:0 0 52px; padding:0; border:1px solid #eee; background:white; }
.wholesale-thumbs button[aria-pressed="true"] { border-color:#ff3030; }
.wholesale-thumbs img { width:100%; aspect-ratio:1; object-fit:cover; display:block; }
.wholesale-shop { border:1px solid #eee; }
.wholesale-shop strong, .wholesale-shop-profile { margin:0; padding:12px; }
.wholesale-shop strong { display:block; }
.wholesale-shop-profile { display:flex; align-items:center; gap:12px; }
.wholesale-shop-profile img { width:48px; height:48px; object-fit:cover; }
.wholesale-shop-profile a { color:inherit; text-decoration:none; font-weight:600; overflow-wrap:anywhere; }
.wholesale-shop-profile a:hover { color:#ff3030; }
.wholesale-local-edit { margin-top:12px; border:1px solid #eee; padding:10px; }
.wholesale-local-edit summary { cursor:pointer; }
.wholesale-local-edit .product-material-editor, .wholesale-local-edit .tag-add-row { flex-wrap:wrap; }
.wholesale-local-edit .product-material-editor label { flex:1 1 130px; min-width:0; }
.wholesale-local-edit input { max-width:100%; }
.wholesale-shop strong, .wholesale-price-panel { background:#f3f3f3; }
.wholesale-price-panel { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; min-height:218px; padding:24px; }
.wholesale-price-head { color:#777; font-size:12px; }
.wholesale-detail-sales { grid-column:2; grid-row:1 / span 3; align-self:center; white-space:nowrap; padding-left:16px; border-left:1px solid #e8e8e8; font-size:14px; }
.wholesale-detail-sales b { color:#ff3030; font-weight:500; }
.wholesale-price-panel > dl { grid-column:1; }
.wholesale-price-panel > .wholesale-services { grid-column:1 / -1; padding-top:12px; border-top:1px dashed #ebebeb; }
@media (max-width:600px) { .wholesale-price-panel { grid-template-columns:minmax(0,1fr); padding:16px; } .wholesale-detail-sales { grid-column:1; grid-row:auto; border:0; padding:0; } }
.wholesale-price-panel strong { color:#fb3434; font-size:28px; line-height:28px; font-weight:600; }
.wholesale-tiers { display:grid; grid-template-columns:50px minmax(0,1fr); align-items:baseline; gap:20px; margin:0; font-size:12px; }
.wholesale-tiers dt { color:#777; text-align:right; }
.wholesale-tiers dd { display:flex; flex-wrap:wrap; gap:8px; margin:0; padding:0; }
.wholesale-tiers dd.wholesale-badges { overflow:visible; }
@media (max-width:600px) { .wholesale-tiers { grid-template-columns:48px minmax(0,1fr); gap:10px; } }
.wholesale-tiers b { color:#ff3030; }
.wholesale-original dd { color:#888; }
.wholesale-sku-pages { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; padding:10px 0; }
.wholesale-sku-pages button { padding:3px 10px; border-radius:2px; border:1px solid #ddd; background:white; }
.wholesale-sku-pages button[aria-current="page"] { color:#ff3030; border-color:#ff3030; }
.wholesale-analysis-return { flex: 0 0 auto; border: 1px solid #ff3030; background: #fff; color: #d82020; padding: 10px 14px; border-radius: 4px; font-weight: 700; }
.wholesale-options { display:grid; gap:8px; padding:20px 0 12px; }
.wholesale-option-group { display:grid; grid-template-columns:68px auto minmax(0,1fr); align-items:start; gap:12px; }
.wholesale-option-group > span { text-align:right; padding-top:6px; font-size:12px; color:#777; overflow-wrap:anywhere; }
.wholesale-option-group > div { display:flex; flex-wrap:wrap; gap:12px; }
.wholesale-option-group button { max-width:100%; overflow-wrap:anywhere; }
.wholesale-options button { min-height:28px; border:1px solid #ddd; border-radius:2px; background:white; color:#333; padding:4px 10px; font-size:12px; }
.wholesale-options button[aria-pressed="true"] { color:#ff3030; border-color:#ff3030; }
@media (max-width:600px) { .wholesale-option-group { grid-template-columns:44px auto minmax(0,1fr); gap:6px; } .wholesale-option-group > div { gap:6px; } }
.wholesale-sku-row { display:grid; grid-template-columns:32px minmax(0,1fr) minmax(56px,96px) auto; gap:12px; align-items:center; border-top:1px dashed #ebebeb; padding:8px 8% 8px 10%; min-height:51px; font-size:12px; }
.wholesale-sku-row img { width:32px; aspect-ratio:1; object-fit:cover; }
.wholesale-sku-title { grid-column:2; font-weight:600; overflow-wrap:anywhere; }
.wholesale-sku-price { text-align:center; }
@media (max-width:750px) { .wholesale-sku-row { grid-template-columns:32px minmax(0,1fr) 62px auto; padding-inline:8px; } }
.wholesale-quantity { display:grid; grid-template-columns:28px 48px 28px; }
.wholesale-quantity button, .wholesale-quantity input { min-width:0; padding:2px; border:1px solid #ddd; border-radius:0; text-align:center; background:white; }
.wholesale-quantity input { width:100%; appearance:textfield; }
.wholesale-quantity input::-webkit-inner-spin-button { appearance:none; }
.wholesale-selection { display:flex; flex-wrap:wrap; justify-content:flex-end; align-items:center; gap:12px; padding:12px 0; }
.wholesale-selection strong { color:#d33; }
.wholesale-actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px 16px; margin-top:0; padding:24px clamp(0px, 7vw, 88px) 22px; border-top:1px solid #e8e8e8; }
.wholesale-actions .wholesale-list-now, .wholesale-actions .wholesale-buy-now { display:inline-grid; place-items:center; box-sizing:border-box; min-width:128px; height:40px; padding:0 12px; border-radius:4px; border:1px solid #ff3030; font-size:16px; text-decoration:none; }
.wholesale-actions .wholesale-list-now { background:#ff3030; color:white; }
.wholesale-actions .wholesale-list-now:disabled { background:#eee; color:#666; border-color:#ddd; opacity:1; }
.wholesale-actions .wholesale-buy-now { color:#ff3030; background:white; }
.wholesale-actions .wholesale-confirm-listed { background:none; border:0; color:#555; }
@media (max-width:600px) { .wholesale-actions { padding-inline:0; } }
@media (max-width:420px) { .wholesale-quantity { grid-column:2 / -1; justify-self:end; } }
.wholesale-intro { position:sticky; top:46px; z-index:2; display:flex; flex-wrap:wrap; background:#f5f5f5; border-bottom:1px solid #fb3434; margin-top:24px; }
.wholesale-intro button { min-height:47px; border:0; border-radius:0; background:transparent; padding:10px 24px; font-size:14px; }
.wholesale-intro button[aria-pressed="true"] { background:#fb3434; color:white; }
.wholesale-discussion { padding:8px 20px; }
.wholesale-discussion > p, .wholesale-discussion > article { padding:12px 0; border-bottom:1px solid #eee; overflow-wrap:anywhere; }
.wholesale-review-meta, .wholesale-review-images { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.wholesale-review-meta span, .wholesale-review-meta time { color:#777; font-size:13px; }
.wholesale-review-meta time { margin-left:auto; }
.wholesale-review-images button { width:72px; height:72px; padding:0; border:1px solid #eee; background:white; }
.wholesale-review-images img { width:100%; height:100%; object-fit:cover; }
.wholesale-properties { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr)); margin:16px auto; padding:16px; gap:12px 24px; max-width:1080px; border:1px solid #eee; }
.wholesale-properties div { display:grid; grid-template-columns: minmax(60px,auto) minmax(0,1fr); gap:12px; }
.wholesale-properties dt { color:#777; }
.wholesale-properties dd { margin:0; overflow-wrap:anywhere; }
.wholesale-detail-media { max-width:750px; margin:auto; padding-top:10px; }
.wholesale-detail-media > * { display:block; width:100%; }
@media (max-width:1000px) { .wholesale-grid { grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; } }
@media (max-width:600px) { .wholesale-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .wholesale-detail-columns { grid-template-columns:minmax(0,1fr); } }
</style>


