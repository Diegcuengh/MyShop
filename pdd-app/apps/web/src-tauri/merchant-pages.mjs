const CATEGORY_URL = 'https://mms.pinduoduo.com/goods/category'

export async function openProductPage(context) {
  const reusable = context.pages().find(page => !page.isClosed() && page.url() === 'about:blank')
  const page = reusable || await context.newPage()
  try {
    await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (page.url() === 'about:blank') throw new Error('发布页没有打开')
    await page.bringToFront()
    return page
  } catch (error) {
    if (!reusable && !page.isClosed() && page.url() === 'about:blank') await page.close().catch(() => {})
    throw new Error('无法打开商家发布页，请检查网络后重试。已保留其他页面。', { cause: error })
  }
}
