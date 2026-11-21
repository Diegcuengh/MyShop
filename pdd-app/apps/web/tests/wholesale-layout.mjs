import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { chromium } from 'playwright'

const stamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  dateStyle: 'short',
  timeStyle: 'medium',
}).format(statSync(new URL(import.meta.url)).mtime).replace(' ', '/')
console.log(`MyShop wholesale layout v0.0.5/${stamp}`)

const run = { runId: 'fixture', keyword: 'fixture', crawlTime: '2026-04-14T00:00:00Z' }
const previous = { ...run, runId: 'previous' }
const product = {
  ...run, goodsId: '505562248188', title: 'Example product', shopName: 'Example store',
  imageUrl: '/fixture-cover', minWholesalePriceYuan: 22.61, maxWholesalePriceYuan: 188.86,
  carouselMedia: [], detailMedia: [], tags: [], material: '',
  skus: ['A', 'B'].flatMap(shape => ['Small', 'Large'].map(size => ({
    skuId: shape + size,
    specs: [{ key: 'Style', value: shape }, { key: 'Size', value: size }],
    wholesalePriceYuan: 22.61, groupPriceYuan: 23.8, quantity: 2, thumbUrl: '/fixture-cover',
  }))),
  salesTipAmount: 10000, commentCount: null,
}
const replies = {
  'product-count': [previous, run],
  'product-list': { currentRun: run, products: [product] },
  'product-diff': {
    currentRun: run, previousRun: previous,
    added: [{ ...product, goodsId: '2', title: 'Added item' }],
    removed: [{ ...product, runId: previous.runId, goodsId: '3', title: 'Removed item' }],
  },
  'product-overlap': { products: [{ ...product, goodsId: '4', title: 'Overlap item' }] },
  'shop-diff': { all: [], added: [], removed: [] },
  sync: { importedRuns: 0 },
  auto: { matched: 0, modified: 0 },
}
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1802, height: 1142 } })
  page.setDefaultTimeout(8000)
  await page.route('**/api/trends/**', route => route.fulfill({
    json: replies[new URL(route.request().url()).pathname.split('/').pop()] ?? [],
  }))
  await page.route('**/fixture-cover', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="360" height="360" fill="#777"/></svg>',
  }))
  await page.goto(process.env.MYSHOP_TEST_URL ?? 'http://localhost:5173/')

  const header = page.locator('.wholesale-header')
  await header.waitFor()
  assert.equal((await header.boundingBox()).height, 83)
  assert.equal((await page.locator('.wholesale-search').boundingBox()).height, 53)
  assert.equal((await page.locator('.wholesale-search button[type="submit"]').boundingBox()).width, 120)
  const grid = page.locator('.wholesale-grid')
  assert.equal((await grid.boundingBox()).x, 84)
  assert.equal((await grid.boundingBox()).width, 1500)

  const listTools = page.locator('.wholesale-list-tools')
  await listTools.locator('button').first().click()
  await page.locator('.wholesale-cart[open]').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.wholesale-cart').waitFor({ state: 'hidden' })
  await page.locator('.wholesale-card').press('Enter')
  const mainImage = page.locator('.wholesale-main-image')
  await mainImage.evaluate(image => image.decode())
  assert.equal((await mainImage.boundingBox()).width, 360)
  assert.equal((await page.locator('.wholesale-intro').boundingBox()).height, 48)
  const styles = page.getByRole('group', { name: 'Style' })
  const sizes = page.getByRole('group', { name: 'Size' })
  const rows = page.locator('.wholesale-sku-row')
  assert.equal(await rows.count(), 4)
  await styles.getByRole('button', { name: 'A', exact: true }).click()
  assert.equal(await rows.count(), 2)
  await sizes.getByRole('button', { name: 'Small', exact: true }).click()
  assert.equal(await rows.count(), 1)
  const quantity = rows.locator('input')
  await quantity.fill('3')
  await quantity.press('Tab')
  assert.equal(await quantity.inputValue(), '2')
  await sizes.getByRole('button').first().click()
  assert.equal(await rows.count(), 2)
  assert.equal(await rows.first().locator('input').inputValue(), '2')

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
  }
  await page.locator('.wholesale-detail nav button').first().click()
  await header.waitFor()
  assert.equal(await listTools.isVisible(), false)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320)
  await page.locator('.wholesale-card').press('Enter')
  await page.locator('.wholesale-sku-row').first().locator('.wholesale-quantity button').last().click()
  await page.locator('.wholesale-selection button').click()
  await page.locator('.wholesale-cart article').waitFor()
  await page.reload()
  await page.locator('.wholesale-cart-button').click()
  const cart = page.locator('.wholesale-cart')
  assert.equal(await cart.locator('article').count(), 1)
  await cart.locator('article button').click()
  await page.reload()
  await page.locator('.wholesale-cart-button').click()
  assert.equal(await cart.locator('article').count(), 0)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1802, height: 1142 })
  await page.locator('.wholesale-analysis-toggle').click()
  const categoryTabs = page.locator('.product-result-panel .result-tabs button')
  for (const [index, id, title] of [[0, '3', 'Removed item'], [1, '2', 'Added item'], [2, '4', 'Overlap item'], [3, product.goodsId, product.title]]) {
    const tab = categoryTabs.nth(index)
    await tab.click()
    const card = grid.locator(`.wholesale-card[data-goods-id="${id}"]`)
    assert.equal(await grid.locator('.wholesale-card').count(), 1)
    assert.equal((await grid.boundingBox()).width, 1500)
    await card.click()
    await page.locator('.wholesale-detail').getByText(title, { exact: true }).first().waitFor()
    assert.equal(await page.locator('.wholesale-sku-row').count(), 4)
    await page.locator('.wholesale-detail nav button').first().click()
    await card.waitFor()
    assert.equal(await tab.evaluate(button => button.classList.contains('active')), true)
  }
  console.log('PASS: catalogue geometry, cart, SKU filters, quantity limits and narrow layouts')
} finally {
  await browser.close()
}
