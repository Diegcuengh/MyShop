import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createServer, createConnection } from 'node:net'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

console.error(`MyShop ${process.env.MYSHOP_BUILD_INFO || 'development build (no build timestamp)'}`)
let output = (event) => console.log(JSON.stringify(event))
const status = (message, state = 'done') => output({ message, isError: state === 'error', state })
const base = process.env.LOCALAPPDATA || process.env.HOME
if (!base) throw new Error('Cannot locate local application data directory')

const runtime = { context: null }
async function currentModule(name) {
  const url = new URL(`./${name}`, import.meta.url)
  const hash = createHash('sha256').update(readFileSync(fileURLToPath(url))).digest('hex')
  return import(`${url.href}?revision=${hash}`)
}

const profile = join(base, 'MyShop', 'merchant-browser')
const key = createHash('sha256').update(profile.toLowerCase()).update('shared-session').digest('hex').slice(0, 20)
const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\MyShop-merchant-${key}` : join(tmpdir(), `myshop-merchant-${key}.sock`)
let queue = Promise.resolve()
let broker
let connecting

function enqueue(message, send) {
  queue = queue.then(async () => {
    output = send
    const session = await currentModule('merchant-session.mjs')
    if (message.type === 'open') {
      await session.openMerchant(runtime, base, status)
      status('商家后台已打开。')
    } else if (message.type === 'prepare') {
      await session.prepare(message.product, runtime, base, status, await currentModule('merchant-pages.mjs'), await currentModule('prepare-product.mjs'), await currentModule('merchant-details.mjs'))
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
