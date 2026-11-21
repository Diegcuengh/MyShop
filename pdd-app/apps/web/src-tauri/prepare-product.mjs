import { imageSize } from 'image-size'

export async function fillProductPage(page, product, fetchImage = fetch) {
  if (!product?.title || !product?.imageUrl || !product?.apiOrigin) throw new Error('商品标题或本地主图缺失，无法填写。')
  const imageUrl = new URL(product.imageUrl)
  if (imageUrl.origin !== new URL(product.apiOrigin).origin || imageUrl.pathname !== '/api/assets/image') throw new Error('只能使用数据服务提供的本地主图。')
  const response = await fetchImage(imageUrl, { redirect: 'error' })
  if (!response.ok) throw new Error('读取商品本地主图失败。')
  const mime = response.headers.get('content-type')?.split(';')[0]
  if (mime !== 'image/jpeg' && mime !== 'image/png') throw new Error('主图必须是 JPEG 或 PNG。')
  const limit = 3 * 1024 * 1024
  if (Number(response.headers.get('content-length')) > limit) throw new Error('主图超过商家后台的 3 MB 限制。')
  const chunks = []
  let size = 0
  for await (const chunk of response.body || []) {
    size += chunk.length
    if (size > limit) throw new Error('主图超过商家后台的 3 MB 限制。')
    chunks.push(chunk)
  }
  if (!size) throw new Error('商品主图为空。')
  const bytes = Buffer.concat(chunks)
  let dimensions
  try {
    dimensions = imageSize(bytes)
  } catch {
    throw new Error('无法读取主图尺寸，请选择有效的 JPEG 或 PNG 图片。')
  }
  if ((mime === 'image/jpeg' && dimensions.type !== 'jpg') || (mime === 'image/png' && dimensions.type !== 'png')) {
    throw new Error('主图文件类型与图片内容不一致。')
  }
  let { width, height } = dimensions
  if (dimensions.orientation && dimensions.orientation >= 5 && dimensions.orientation <= 8) [width, height] = [height, width]
  if (!width || !height || width <= 480 || height <= 480) throw new Error(`主图尺寸 ${width ?? '?'}×${height ?? '?'} 不符合要求：宽和高都必须大于 480 像素。`)
  if (width !== height && Math.abs(width * 4 - height * 3) > 4) throw new Error(`主图尺寸 ${width}×${height} 不符合要求：比例需为 1:1 或 3:4。`)
  const title = page.getByPlaceholder('商品标题组成：商品描述+规格，最多输入30个汉字（60个字符）')
  await title.waitFor({ state: 'visible', timeout: 30000 })
  await title.fill(product.title)
  if (await title.inputValue() !== product.title) throw new Error('商品标题未完整填入，请检查并修改标题。')
  await page.locator('input[type=file][accept*="image/"]').first().setInputFiles({ name: mime === 'image/png' ? 'main.png' : 'main.jpg', mimeType: mime, buffer: bytes })
}
