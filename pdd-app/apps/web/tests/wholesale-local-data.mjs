import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { chromium } from 'playwright'

const stamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium',
}).format(statSync(new URL(import.meta.url)).mtime).replace(' ', '/')
console.log(`MyShop local catalogue verification v0.0.5/${stamp}`)

const base = process.env.MYSHOP_TEST_URL ?? 'http://localhost:5173/'
const goodsId = '505562248188'
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1802, height: 1142 } })
  page.setDefaultTimeout(12000)
  const health = await page.request.get(new URL('/api/trends/product-count', base).href)
  assert.equal(health.status(), 200, `Local catalogue unavailable: ${await health.text()}`)
  // Test reads the running API and skips background writes to the user's database.
  await page.route('**/api/trends/product-tags/auto**', route => route.fulfill({ json: { matched: 0, modified: 0 } }))
  await page.route('**/api/trends/sync', route => route.fulfill({ json: { importedRuns: 0 } }))
  const catalogue = page.waitForResponse(response => new URL(response.url()).pathname === '/api/trends/product-list')
  const comparison = page.waitForResponse(response => new URL(response.url()).pathname === '/api/trends/product-diff')
  const overlap = page.waitForResponse(response => new URL(response.url()).pathname === '/api/trends/product-overlap')
  await page.goto(base)
  const response = await catalogue
  assert.equal(response.status(), 200)
  const { products } = await response.json()
  const sample = products.find(product => product.goodsId === goodsId)
  assert.ok(sample, 'Reference product is missing from the current local batch')
  const count = page.locator('.wholesale-result-count')
  assert.equal(parseInt(await count.innerText(), 10), products.length)
  const card = page.locator('.wholesale-card')
  const next = page.getByRole('button', { name: '下一页', exact: true })
  const renderedIds = new Set()
  await card.first().waitFor()
  for (;;) {
    for (const id of await card.evaluateAll(cards => cards.map(element => element.dataset.goodsId))) {
      assert.ok(id && !renderedIds.has(id), `Missing or duplicate catalogue ID: ${id}`)
      renderedIds.add(id)
    }
    if (await next.isDisabled()) break
    assert.ok(renderedIds.size < products.length, 'Pagination continued past the catalogue')
    await next.press('Enter')
  }
  assert.deepEqual(renderedIds, new Set(products.map(product => product.goodsId)))
  const search = page.getByRole('searchbox', { name: '搜索商品' })
  await search.fill(goodsId)
  await search.press('Enter')
  assert.equal(await card.count(), 1)
  await card.locator('img').evaluate(image => image.decode())
  await card.press('Enter')
  await page.locator('.wholesale-main-image').evaluate(image => image.decode())
  await page.getByRole('button', { name: '放大商品主图' }).press('Enter')
  await page.locator('.image-preview-overlay').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.image-preview-overlay').waitFor({ state: 'hidden' })
  assert.ok(await page.locator('.wholesale-price-head').isVisible())
  const skuImages = page.locator('.wholesale-sku-row img')
  await skuImages.first().waitFor()
  assert.equal(await skuImages.evaluateAll(async images => {
    await Promise.all(images.map(image => image.decode()))
    return images.length
  }), 10)
  const discussion = page.waitForResponse(result => new URL(result.url()).pathname === '/api/trends/product-discussion')
  await page.getByRole('button', { name: /^客服答疑/ }).press('Enter')
  assert.equal((await discussion).status(), 200)
  await page.locator('.wholesale-discussion article').first().waitFor()
  await page.getByRole('button', { name: '返回所有商品' }).press('Enter')
  assert.equal(await search.inputValue(), goodsId)
  assert.equal(await card.count(), 1)
  console.log(`PASS: ${products.length} local products, reference cover and detail, SKU photos, Q&A and preserved search`)

  const videoProduct = products.find(product => product.detailMedia.some(media =>
    media.type === 'video' && new URL(media.videoSrc, base).searchParams.get('kind') === 'video'))
  assert.ok(videoProduct, 'No product with a locally saved video in the current batch')
  await search.fill(videoProduct.goodsId)
  await search.press('Enter')
  await card.press('Enter')
  const player = page.locator('.wholesale-detail-media video[src*="kind=video"]').first()
  const source = await player.getAttribute('src')
  assert.ok(source)
  const clip = await page.request.get(new URL(source, base).href, { headers: { Range: 'bytes=0-7' } })
  assert.equal(clip.status(), 206)
  assert.equal(clip.headers()['content-type'], 'video/mp4')
  assert.equal((await clip.body()).toString('ascii', 4), 'ftyp')
  await player.evaluate(video => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local MP4 did not seek in time')), 10000)
    video.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error(video.error?.message || 'Local MP4 could not be loaded'))
    }, { once: true })
    video.addEventListener('loadedmetadata', () => { video.currentTime = video.duration / 2 }, { once: true })
    video.addEventListener('seeked', () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })
    video.load()
  }))
  console.log('PASS: local video format, byte-range delivery and browser seeking')

  await page.getByRole('button', { name: '返回所有商品' }).press('Enter')
  await search.fill('')
  await search.press('Enter')
  const diff = await (await comparison).json()
  const shared = await (await overlap).json()
  await page.locator('.wholesale-analysis-toggle').click()
  const tabs = page.locator('.product-result-panel .result-tabs button')
  for (const [index, items] of [diff.removed, diff.added, shared.products].entries()) {
    await tabs.nth(index).click()
    assert.equal(parseInt(await count.innerText(), 10), items.length)
    const sample = items.find(item => item.skus.length && item.imageUrl)
    assert.ok(sample)
    await search.fill(sample.goodsId)
    await search.press('Enter')
    await page.locator(`.wholesale-card[data-goods-id="${sample.goodsId}"]`).click()
    await page.locator('.wholesale-main-image').evaluate(image => image.decode())
    await page.locator('.wholesale-sku-row').first().waitFor()
    await page.getByRole('button', { name: '返回商品列表' }).click()
    assert.equal(await tabs.nth(index).evaluate(button => button.classList.contains('active')), true)
    await search.fill('')
    await search.press('Enter')
  }
  console.log('PASS: all three comparison lists and details use their correct local snapshots')
} finally {
  await browser.close()
}
