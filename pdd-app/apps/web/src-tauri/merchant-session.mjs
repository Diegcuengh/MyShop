import { chromium } from 'playwright'
import { join } from 'node:path'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'

export async function prepare(product, runtime, base, status, pages, form, details) {
  const directory = join(base, 'MyShop', 'logs')
  const file = join(directory, 'merchant-listing.log')
  let stage = '准备任务'
  let stageStart = Date.now()
  let lastWarning = 0
  let loggingFailed = false
  const log = (kind, message) => {
    try {
      mkdirSync(directory, { recursive: true })
      const safe = String(message).replace(/https?:\/\/[^\s)]+/g, '[地址已隐藏]').replace(/[\r\n]+/g, ' ')
      appendFileSync(file, `${new Date().toISOString()} ${kind} ${safe}\n`, 'utf8')
    } catch { loggingFailed = true }
  }
  const update = (message, state = 'done') => {
    stage = message
    stageStart = Date.now()
    lastWarning = 0
    log(state, message)
    status(message, state)
  }
  log('start', `铺货任务开始 商品ID=${String(product?.goodsId ?? '').replace(/[^\w-]/g, '')} 主图=${product?.imageUrls?.length ?? 0} 详情图=${product?.detailImageUrls?.length ?? 0} 规格图=${product?.skuImages?.length ?? 0}`)
  if (loggingFailed) status('无法写入铺货日志，请检查本地磁盘。', 'working')
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - stageStart) / 1000)
    if (elapsed >= 20 && elapsed - lastWarning >= 20) {
      lastWarning = elapsed
      const message = `仍在等待：${stage}（${elapsed}秒）。日志：${file}`
      log('waiting', message)
      status(message, 'working')
    }
  }, 1000)
  try {
    await prepareProduct(product, runtime, base, update, pages, form, details)
    log('end', '任务结束，未自动发布')
  } catch (error) {
    log('error', `${stage} | ${error instanceof Error ? error.stack || error.message : String(error)}`)
    throw new Error(`${error instanceof Error ? error.message : String(error)}（日志：${file}）`, { cause: error })
  } finally {
    clearInterval(timer)
  }
}

export async function openBrowser(runtime, base, status) {
  if (runtime.context) return runtime.context
  const primary = join(base, 'MyShop', 'merchant-browser')
  const secondary = join(base, 'MyShop', 'merchant-browser-secondary')
  const profile = existsSync(secondary) ? secondary : primary
  try {
    runtime.context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: false, viewport: null, args: ['--restore-last-session'],
    })
  } catch (error) {
    throw new Error('商家浏览器无法启动或登录会话正在使用中。请先保存正在编辑的内容并关闭商家浏览器，再重试。', { cause: error })
  }
  runtime.context.once('close', () => {
    runtime.context = null
    status('商家浏览器已关闭。')
  })
  return runtime.context
}

export async function openMerchant(runtime, base, status) {
  const ctx = await openBrowser(runtime, base, status)
  const page = ctx.pages().find(item => item.url().startsWith('https://mms.pinduoduo.com/')) || ctx.pages()[0] || await ctx.newPage()
  if (!page.url().startsWith('https://mms.pinduoduo.com/')) await page.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.bringToFront()
  return page
}

async function prepareProduct(product, runtime, base, status, pages, form, details) {
  if (!product?.title || !product?.imageUrl || !product?.apiOrigin) throw new Error('商品标题或本地主图缺失，无法填写。')
  status('请在打开的浏览器中登录商家后台。', 'working')
  const login = await openMerchant(runtime, base, status)
  if (new URL(login.url()).pathname.startsWith('/login')) {
    try {
      await login.waitForURL(url => url.hostname === 'mms.pinduoduo.com' && !url.pathname.startsWith('/login'), { timeout: 300000 })
    } catch {
      throw new Error('等待商家登录超时或浏览器已关闭，请重新操作。')
    }
  }
  status('正在打开商品发布页。', 'working')
  const page = await pages.openProductPage(await openBrowser(runtime, base, status))
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('商家后台尚未登录，请登录后重试。')
  const result = await form.fillProductPage(page, product, fetch, message => status(message, 'working'))
  status('主图和标题已填写，正在进入商品信息页。', 'working')
  await form.advanceProductPage(page, message => status(message, 'working'))
  status('正在填写商品属性和上传详情图。', 'working')
  const detailResult = await details.fillDetails(page, product, message => status(message, 'working'))
  await page.bringToFront()
  status(`已填写 ${detailResult.filled.length} 项属性，确认上传 ${detailResult.uploaded} 张详情图。${detailResult.skuSelected.length ? `已选择 ${detailResult.skuSelected.length} 张规格图，请确认上传结果。` : ''}${detailResult.skuManual.length ? `${detailResult.skuManual.length} 个规格图片需手动处理。` : ''}${detailResult.manual.length ? `以下属性需手动检查：${detailResult.manual.join('、')}。` : ''}${detailResult.skipped.length ? `详情图第 ${detailResult.skipped.join('、')} 张无法使用。` : ''}${detailResult.errors.join(' ')} 规格、售价和保存草稿仍需完成；尚未上架。`)
}
