import { chromium } from 'playwright'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createServer, createConnection } from 'node:net'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { fillProductPage } from './prepare-product.mjs'

console.error(`MyShop ${process.env.MYSHOP_BUILD_INFO || 'development build (no build timestamp)'}`)
let output = (event) => console.log(JSON.stringify(event))
const status = (message, state = 'done') => output({ message, isError: state === 'error', state })
const base = process.env.LOCALAPPDATA || process.env.HOME
if (!base) throw new Error('Cannot locate local application data directory')

let context
async function browser() {
  if (!context) {
    const options = { channel: 'chrome', headless: false, viewport: null, args: ['--restore-last-session'] }
    const primaryProfile = join(base, 'MyShop', 'merchant-browser')
    const secondaryProfile = join(base, 'MyShop', 'merchant-browser-secondary')
    // Once a secondary profile exists, keep using it so its login state is stable.
    const profilePath = existsSync(secondaryProfile) ? secondaryProfile : primaryProfile
    try {
      context = await chromium.launchPersistentContext(profilePath, options)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Target page, context or browser has been closed')) throw error
      if (profilePath === secondaryProfile) {
        throw new Error('保存登录状态的商家浏览器正在被其他窗口使用。请先保存并关闭旧版商家浏览器，然后重试。', { cause: error })
      }
      status('原商家浏览器可能已在运行，正在打开另一登录会话，请在新窗口登录。', 'working')
      try {
        context = await chromium.launchPersistentContext(secondaryProfile, options)
      } catch (fallbackError) {
        throw new Error('商家浏览器无法启动。请检查 Chrome 是否正常运行；如已有商家浏览器窗口，请先保存未完成的内容。', { cause: fallbackError })
      }
    }
    context.once('close', () => {
      output({ message: '商家浏览器已关闭。', isError: false, state: 'done', closed: true })
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

const profile = join(base, 'MyShop', 'merchant-browser')
const key = createHash('sha256').update(profile.toLowerCase()).digest('hex').slice(0, 20)
const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\MyShop-merchant-${key}` : join(tmpdir(), `myshop-merchant-${key}.sock`)
let queue = Promise.resolve()
let broker
let connecting

function enqueue(message, send) {
  queue = queue.then(async () => {
    output = send
    if (message.type === 'open') {
      await openMerchant()
      status('商家后台已打开。')
    } else if (message.type === 'prepare') {
      await prepare(message.product)
    }
  }).catch((error) => {
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes('launchPersistentContext')) {
      status('商家浏览器已被旧版 MyShop 占用。请先保存并关闭旧版商家浏览器，再重新点击铺货。', 'error')
    } else {
      status(text, 'error')
    }
  })
}

function connectExisting() {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function listenBroker() {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      socket.on('error', () => {})
      createInterface({ input: socket }).on('line', (line) => {
        try {
          const message = JSON.parse(line)
          enqueue(message, (event) => { if (!socket.destroyed) socket.write(`${JSON.stringify(event)}\n`) })
        } catch {
          socket.write(`${JSON.stringify({ message: '商家助手收到无效请求。', isError: true, state: 'error' })}\n`)
        }
      })
    })
    server.once('error', reject)
    server.listen(socketPath, () => resolve(server))
  })
}

async function getBroker() {
  if (broker) return broker
  if (!connecting) connecting = (async () => {
    try {
      return { socket: await connectExisting() }
    } catch {
      try {
        return { server: await listenBroker() }
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error
        return { socket: await connectExisting() }
      }
    }
  })().finally(() => { connecting = null })
  broker = await connecting
  if (broker.socket) {
    broker.socket.on('error', () => {})
    broker.socket.on('close', () => { broker = undefined })
    createInterface({ input: broker.socket }).on('line', (line) => console.log(line))
  }
  return broker
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  try {
    const message = JSON.parse(line)
    if (message.type === 'prepare' && (!message.product?.title || !message.product?.imageUrl || !message.product?.apiOrigin)) {
      status('商品标题或本地主图缺失，无法填写。', 'error')
      return
    }
    const channel = await getBroker()
    if (channel.socket) channel.socket.write(`${JSON.stringify(message)}\n`)
    else enqueue(message, (event) => console.log(JSON.stringify(event)))
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), 'error')
  }
})
