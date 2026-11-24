import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceProductPage, fillProductPage } from './prepare-product.mjs'
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
    getByPlaceholder: () => ({ waitFor: async () => {}, fill: async (value) => calls.push(['title', value]), blur: async () => {}, inputValue: async () => calls.find(([kind]) => kind === 'title')?.[1] }),
    getByText: () => ({ first: () => ({ waitFor: async () => {} }) }),
    locator: () => ({ first: () => ({ waitFor: async () => {}, setInputFiles: async (file) => calls.push(['image', file]), evaluate: async () => calls.find(([kind]) => kind === 'image')?.[1].length ?? { multiple: true, disabled: false } }) }),
  }
  const response = (type = 'image/png', body = png()) => async () => new Response(body, { headers: { 'content-type': type } })
  return { page, calls, response }
}

test('fills the title and uploads the local image', async () => {
  const { page, calls, response } = fixture()
  await fillProductPage(page, product, response())
  assert.equal(calls[1][1], product.title)
  assert.equal(calls[0][1][0].mimeType, 'image/png')
  assert.deepEqual(calls[0][1][0].buffer, png())
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
    blur: async () => {},
    inputValue: async () => '截断后的标题',
  })
  await assert.rejects(fillProductPage(page, product, response()), /标题未完整填入/)
  assert.equal(calls.some(([kind]) => kind === 'image'), true)
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
  assert.equal(calls[0][1][0].mimeType, 'image/png')
})

test('uploads distinct valid carousel images and reports skipped images', async () => {
  const { page, calls } = fixture()
  const second = 'http://localhost:3001/api/assets/image?path=2.jpg'
  const invalid = 'http://localhost:3001/api/assets/image?path=3.jpg'
  const result = await fillProductPage(page, { ...product, imageUrls: [product.imageUrl, second, invalid] }, async (url) =>
    new Response(url.searchParams.get('path') === '3.jpg' ? png(200, 200) : png(), { headers: { 'content-type': 'image/png' } }))
  assert.equal(calls[0][1].length, 2)
  assert.deepEqual(result, { imageCount: 2, skipped: [3] })
})

test('continues to product information after clicking next', async () => {
  let clicked = false
  await advanceProductPage({
    getByRole: () => ({ waitFor: async () => {}, click: async () => { clicked = true } }),
    waitForURL: async (match) => assert.equal(match(new URL('https://mms.pinduoduo.com/goods/goods_add/index')), true),
  })
  assert.equal(clicked, true)
})

test('reports a platform warning when next does not navigate', async () => {
  const page = {
    getByRole: () => ({ waitFor: async () => {}, click: async () => {} }),
    waitForURL: async () => { throw new Error('timeout') },
    locator: () => ({ allTextContents: async () => ['操作太频繁，请稍后再试'] }),
  }
  await assert.rejects(advanceProductPage(page, undefined, { navigationTimeout: 5 }), /操作太频繁/)
})

test('waits for manual verification and then continues', async () => {
  let polls = 0
  let clicks = 0
  const statuses = []
  const page = {
    getByRole: () => ({ waitFor: async () => {}, click: async () => { clicks++ }, isVisible: async () => true }),
    waitForURL: async () => { if (++polls < 3) throw new Error('not navigated') },
    frames: () => [{ getByText: () => ({ first: () => ({ isVisible: async () => polls === 1 }) }) }],
    bringToFront: async () => {},
  }
  await advanceProductPage(page, message => statuses.push(message), { navigationTimeout: 1000 })
  assert.equal(clicks, 2)
  assert.match(statuses[0], /手动完成滑块验证/)
  assert.match(statuses[1], /继续处理/)
})

test('fills a real browser form without uploading to an external site', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<input placeholder="商品标题组成： 商品描述+规格，最多输入30个汉字（60个字符）"><input type="file" accept="image/jpeg,image/png" multiple><span id="counter">(0/10)</span><script>document.querySelector('[type=file]').onchange = () => setTimeout(() => { document.querySelector('input:not([type])').value = ''; document.querySelector('#counter').textContent = '(1/10)' }, 50)</script>`)
    await fillProductPage(page, product, async () => new Response(png(), { headers: { 'content-type': 'image/png' } }))
    assert.equal(await page.locator('input[type=text], input:not([type])').inputValue(), product.title)
    assert.deepEqual(await page.locator('input[type=file]').evaluate((input) => Array.from(input.files, (file) => ({ name: file.name, type: file.type }))), [{ name: 'main.png', type: 'image/png' }])
  } finally {
    await browser.close()
  }
})
