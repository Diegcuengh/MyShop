import { chromium } from 'playwright'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fillProductPage } from './prepare-product.mjs'

console.error(`MyShop ${process.env.MYSHOP_BUILD_INFO || 'development build (no build timestamp)'}`)
const status = (message, state = 'done') => console.log(JSON.stringify({ message, isError: state === 'error', state }))
const base = process.env.LOCALAPPDATA || process.env.HOME
if (!base) throw new Error('Cannot locate local application data directory')

let context
async function browser() {
  if (!context) {
    context = await chromium.launchPersistentContext(join(base, 'MyShop', 'merchant-browser'), {
      channel: 'chrome', headless: false, viewport: null,
    })
    context.once('close', () => {
      console.log(JSON.stringify({ message: '商家浏览器已关闭。', isError: false, state: 'done', closed: true }))
      process.exit(0)
    })
  }
  return context
}

async function openMerchant() {
  const ctx = await browser()
  const page = ctx.pages().find((item) => item.url().startsWith('https://mms.pinduoduo.com/')) || ctx.pages()[0] || await ctx.newPage()
  if (!page.url().startsWith('https://mms.pinduoduo.com/')) await page.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded' })
  await page.bringToFront()
  return page
}

async function prepare(product) {
  if (!product?.title || !product?.imageUrl || !product?.apiOrigin) throw new Error('商品标题或本地主图缺失，无法填写。')
  status('请在打开的浏览器中登录商家后台。', 'working')
  const login = await openMerchant()
  if (new URL(login.url()).pathname.startsWith('/login')) {
    try {
      await login.waitForURL((url) => url.hostname === 'mms.pinduoduo.com' && !url.pathname.startsWith('/login'), { timeout: 300000 })
    } catch {
      throw new Error('等待商家登录超时或浏览器已关闭，请重新操作。')
    }
  }
  const page = await (await browser()).newPage()
  await page.goto('https://mms.pinduoduo.com/goods/category', { waitUntil: 'domcontentloaded' })
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('商家后台尚未登录，请登录后重试。')
  await fillProductPage(page, product)
  await page.bringToFront()
  status('已填写商品标题并选择主图，请检查图片上传结果后继续完善商品信息。')
}

let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  queue = queue.then(async () => {
    const message = JSON.parse(line)
    if (message.type === 'open') {
      await openMerchant()
      status('商家后台已打开。')
    } else if (message.type === 'prepare') {
      await prepare(message.product)
    }
  }).catch((error) => status(error instanceof Error ? error.message : String(error), 'error'))
})
