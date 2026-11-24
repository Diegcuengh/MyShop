import { imageSize } from 'image-size'

async function readDetailImage(source, apiOrigin, fetchImage, index) {
  const url = new URL(source)
  if (url.origin !== new URL(apiOrigin).origin || url.pathname !== '/api/assets/image') throw new Error('不是本地商品图片')
  const response = await fetchImage(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('无法读取图片')
  const mime = response.headers.get('content-type')?.split(';')[0]
  if (!['image/jpeg', 'image/png'].includes(mime)) throw new Error('仅支持 JPEG 或 PNG')
  const limit = 3 * 1024 * 1024
  if (Number(response.headers.get('content-length')) > limit) throw new Error('图片过大')
  const parts = []
  let size = 0
  for await (const chunk of response.body || []) {
    size += chunk.length
    if (size > limit) throw new Error('图片过大')
    parts.push(chunk)
  }
  const buffer = Buffer.concat(parts)
  const dimensions = imageSize(buffer)
  if ((mime === 'image/jpeg' && dimensions.type !== 'jpg') || (mime === 'image/png' && dimensions.type !== 'png')) throw new Error('图片格式不一致')
  return { name: `detail-${index + 1}.${mime === 'image/png' ? 'png' : 'jpg'}`, mimeType: mime, buffer }
}

export async function fillDetails(page, product, onStatus = () => {}, fetchImage = fetch) {
  const result = { filled: [], manual: [], uploaded: 0, skipped: [], errors: [], skuSelected: [], skuManual: [] }
  for (const property of product.properties ?? []) {
    const name = String(property.name ?? '').trim()
    const values = Array.isArray(property.values) ? property.values.map(value => String(value).trim()).filter(Boolean) : []
    if (!name || values.length !== 1) { if (name) result.manual.push(name); continue }
    try {
      const input = page.getByLabel(name, { exact: true })
      if (await input.count() !== 1 || !await input.isVisible()) { result.manual.push(name); continue }
      const kind = await input.evaluate(element => ({ tag: element.tagName, type: element.getAttribute('type'), readonly: element.hasAttribute('readonly') }))
      if (kind.tag === 'SELECT') await input.selectOption({ label: values[0] })
      else if ((kind.tag === 'INPUT' && (!kind.type || kind.type === 'text') || kind.tag === 'TEXTAREA') && !kind.readonly) await input.fill(values[0])
      else { result.manual.push(name); continue }
      const actual = kind.tag === 'SELECT' ? await input.evaluate(element => element.selectedOptions[0]?.textContent?.trim()) : await input.inputValue()
      if (actual === values[0]) result.filled.push(name)
      else result.manual.push(name)
    } catch { result.manual.push(name) }
  }
  const sources = [...new Set(product.detailImageUrls ?? [])].slice(0, 50)
  const files = []
  for (const [index, source] of sources.entries()) {
    onStatus(`正在读取详情图 ${index + 1}/${sources.length}。`)
    try { files.push(await readDetailImage(source, product.apiOrigin, fetchImage, index)) }
    catch { result.skipped.push(index + 1) }
  }
  if (files.length) {
    onStatus(`正在上传 ${files.length} 张详情图。`)
    try {
      const index = await page.evaluate(() => [...document.querySelectorAll('input[type="file"]')].findIndex(el => (el.closest('div')?.innerText ?? '').includes('/50张')))
      if (index < 0) throw new Error('未找到详情图上传控件')
      await page.locator('input[type="file"]').nth(index).setInputFiles(files)
      await page.getByText(new RegExp(`已上传\\s*${files.length}\\s*/\\s*50\\s*张`)).first().waitFor({ state: 'visible', timeout: 60000 })
      result.uploaded = files.length
    } catch (error) {
      result.errors.push(`详情图上传未确认：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const sku of product.skuImages ?? []) {
    const values = (sku.specs ?? []).map(spec => String(spec.value ?? '').trim()).filter(Boolean)
    const name = values.join(' / ') || sku.skuId || '未命名规格'
    try {
      if (values.length !== 1) throw new Error('需要确认规格')
      const text = page.getByText(values[0], { exact: true })
      if (await text.count() !== 1) throw new Error('规格位置不唯一')
      const row = text.locator('xpath=ancestor::tr[1]')
      const input = row.locator('input[type="file"]')
      if (await input.count() !== 1) throw new Error('未找到对应规格图片控件')
      const image = await readDetailImage(sku.imageUrl, product.apiOrigin, fetchImage, 0)
      await input.setInputFiles(image)
      result.skuSelected.push(name)
    } catch { result.skuManual.push(name) }
  }
  return result
}
