import test from 'node:test'
import assert from 'node:assert/strict'
import { fillProductPage } from './prepare-product.mjs'
import { chromium } from 'playwright'

const product = { title: '商品标题', imageUrl: 'http://localhost:3001/api/assets/image?runId=1&path=1.jpg', apiOrigin: 'http://localhost:3001' }
function png(width = 800, height = 800) {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  image.writeUInt32BE(width, 16)
  image.writeUInt32BE(height, 20)
  return image
}
function fixture() {
  const calls = []
  const page = {
    getByPlaceholder: () => ({ waitFor: async () => {}, fill: async (value) => calls.push(['title', value]), inputValue: async () => calls.find(([kind]) => kind === 'title')?.[1] }),
    locator: () => ({ first: () => ({ setInputFiles: async (file) => calls.push(['image', file]) }) }),
  }
  const response = (type = 'image/png', body = png()) => async () => new Response(body, { headers: { 'content-type': type } })
  return { page, calls, response }
}

test('fills the title and uploads the local image', async () => {
  const { page, calls, response } = fixture()
  await fillProductPage(page, product, response())
  assert.equal(calls[0][1], product.title)
  assert.equal(calls[1][1].mimeType, 'image/png')
  assert.deepEqual(calls[1][1].buffer, png())
})

test('rejects images outside the configured API before fetching', async () => {
  const { page, calls, response } = fixture()
  await assert.rejects(fillProductPage(page, { ...product, imageUrl: 'https://example.com/image.jpg' }, response()), /本地主图/)
  assert.equal(calls.length, 0)
})

test('rejects unsupported and oversized images without filling the page', async () => {
  const { page, calls, response } = fixture()
  await assert.rejects(fillProductPage(page, product, response('image/webp')), /JPEG 或 PNG/)
  await assert.rejects(fillProductPage(page, product, response('image/png', Buffer.alloc(3 * 1024 * 1024 + 1))), /3 MB/)
  assert.equal(calls.length, 0)
})

test('does not upload when the form truncates the title', async () => {
  const { page, calls, response } = fixture()
  page.getByPlaceholder = () => ({
    waitFor: async () => {},
    fill: async (value) => calls.push(['title', value]),
    inputValue: async () => '截断后的标题',
  })
  await assert.rejects(fillProductPage(page, product, response()), /标题未完整填入/)
  assert.equal(calls.some(([kind]) => kind === 'image'), false)
})

test('rejects small, badly proportioned or invalid images', async () => {
  const { page, calls, response } = fixture()
  await assert.rejects(fillProductPage(page, product, response('image/png', png(280, 280))), /280×280/)
  await assert.rejects(fillProductPage(page, product, response('image/png', png(480, 480))), /480×480/)
  await assert.rejects(fillProductPage(page, product, response('image/png', png(800, 600))), /比例/)
  await assert.rejects(fillProductPage(page, product, response('image/png', 'invalid')), /无法读取主图尺寸/)
  await assert.rejects(fillProductPage(page, product, response('image/jpeg', png())), /文件类型/)
  assert.equal(calls.length, 0)
})

test('accepts a 3:4 portrait image', async () => {
  const { page, calls, response } = fixture()
  await fillProductPage(page, product, response('image/png', png(600, 800)))
  assert.equal(calls[1][1].mimeType, 'image/png')
})

test('fills a real browser form without uploading to an external site', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<input placeholder="商品标题组成：商品描述+规格，最多输入30个汉字（60个字符）"><input type="file" accept="image/jpeg,image/png" multiple>')
    await fillProductPage(page, product, async () => new Response(png(), { headers: { 'content-type': 'image/png' } }))
    assert.equal(await page.locator('input[type=text], input:not([type])').inputValue(), product.title)
    assert.deepEqual(await page.locator('input[type=file]').evaluate((input) => Array.from(input.files, (file) => ({ name: file.name, type: file.type }))), [{ name: 'main.png', type: 'image/png' }])
  } finally {
    await browser.close()
  }
})
