import { chromium } from 'playwright'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const built = statSync(fileURLToPath(import.meta.url)).mtime
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(built).replace(' ', '/')
console.log(`MyShop loading verification v0.0.2/${stamp}`)
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
const baseUrl = process.env.MYSHOP_TEST_URL ?? 'http://localhost:5173/'

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/trends/product-tags/auto**', route => route.fulfill({ json: { matched: 0, modified: 0 } }))

  let releaseSync
  const syncHeld = new Promise(resolve => { releaseSync = resolve })
  await page.route('**/api/trends/sync', async route => {
    await syncHeld
    await route.fulfill({ json: { importedRuns: 0, buildInfo: 'test' } })
  })
  await page.goto(baseUrl)
  await page.getByRole('button', { name: /所有商品\s*[1-9]\d*/ }).waitFor({ timeout: 20000 })
  await page.getByText('正在后台检查新抓取，已有数据可继续查看。').waitFor()
  console.log('PASS: data remains visible while synchronization is pending')
  releaseSync()
  await page.getByText('正在后台检查新抓取，已有数据可继续查看。').waitFor({ state: 'hidden' })

  await page.unroute('**/api/trends/sync')
  await page.route('**/api/trends/sync', route => route.fulfill({ status: 500, json: { message: '测试同步失败' } }))
  await page.reload()
  await page.getByText(/后台同步失败：测试同步失败/).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /所有商品\s*[1-9]\d*/ }).waitFor()
  await page.getByRole('button', { name: '重试同步' }).waitFor()
  console.log('PASS: synchronization failure preserves data and offers retry')

  await page.route('**/api/trends/product-count', route => route.fulfill({ status: 503, json: { message: '无法连接 MongoDB 数据库，请启动后重试。' } }))
  await page.reload()
  await page.getByText('无法连接 MongoDB 数据库，请启动后重试。').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: '重试', exact: true }).waitFor()
  if (await page.getByRole('button', { name: /所有商品/ }).count()) throw new Error('Unloaded product count is shown as data')
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)
  console.log('PASS: database failure is visible and unloaded counts are hidden')
} finally {
  await browser.close()
}
