import { imageSize } from 'image-size'

async function loadImage(source, apiOrigin, fetchImage, index) {
  const imageUrl = new URL(source)
  if (imageUrl.origin !== new URL(apiOrigin).origin || imageUrl.pathname !== '/api/assets/image') throw new Error('只能使用数据服务提供的本地主图。')
  const response = await fetchImage(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) })
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
  return { name: `${index === 0 ? 'main' : `main-${index + 1}`}.${mime === 'image/png' ? 'png' : 'jpg'}`, mimeType: mime, buffer: bytes }
}

export async function fillProductPage(page, product, fetchImage = fetch, onStatus = () => {}) {
  if (!product?.title || !product?.imageUrl || !product?.apiOrigin) throw new Error('商品标题或本地主图缺失，无法填写。')
  const urls = [...new Set([product.imageUrl, ...(product.imageUrls || [])])].slice(0, 10)
  const images = []
  const skipped = []
  for (const [index, url] of urls.entries()) {
    onStatus(`正在读取主图 ${index + 1}/${urls.length}。`)
    try {
      images.push(await loadImage(url, product.apiOrigin, fetchImage, index))
    } catch (error) {
      if (index === 0) throw new Error(`读取首张主图失败：${error instanceof Error ? error.message : String(error)}`)
      skipped.push(index + 1)
    }
  }
  onStatus(`正在向商家后台上传 ${images.length} 张主图。`)
  const upload = page.locator('input[type=file][accept*="image/"]').first()
  const failures = []
  const responses = []
  const relevant = request => /upload|image|picture|file|material|media/i.test(new URL(request.url()).pathname) && ['POST', 'PUT', 'PATCH'].includes(request.method())
  const onFailure = request => { try { if (relevant(request)) failures.push(`${new URL(request.url()).hostname} ${request.failure()?.errorText || '请求失败'}`) } catch {} }
  const pendingResponses = []
  const onResponse = response => {
    try {
      if (!relevant(response.request())) return
      const url = new URL(response.url())
      const item = `${url.hostname}${url.pathname} HTTP ${response.status()}`
      responses.push(item)
      pendingResponses.push((async () => {
        try {
          if (!(response.headers()['content-type'] ?? '').includes('json')) return
          const data = await response.json()
          const fields = ['success', 'error_code', 'errorCode', 'code', 'error_msg', 'errorMsg', 'message', 'msg']
          const summary = fields.filter(key => ['string', 'number', 'boolean'].includes(typeof data?.[key])).map(key => `${key}=${String(data[key]).slice(0, 150)}`).join(' ')
          if (summary) responses.push(`业务结果 ${summary}`)
        } catch {}
      })())
    } catch {}
  }
  page.on?.('requestfailed', onFailure)
  page.on?.('response', onResponse)
  try {
    await upload.waitFor({ state: 'attached', timeout: 30000 })
    const controls = await page.locator('input[type=file][accept*="image/"]').count?.()
    const descriptor = await upload.evaluate(input => ({ accept: input.accept, multiple: input.multiple, disabled: input.disabled }))
    onStatus(`上传诊断：找到 ${controls ?? '未知数量的'} 个图片控件，支持多选=${descriptor.multiple}，禁用=${descriptor.disabled}，准备 ${images.length} 张图片。`)
    await upload.setInputFiles(images, { timeout: 30000 })
    const selected = await upload.evaluate(input => input.files?.length ?? 0)
    onStatus(`文件已交给页面，控件当前显示 ${selected} 张，等待后台确认。`)
    await page.getByText(new RegExp(`\\(${images.length}\\s*\\/\\s*10\\)`)).first().waitFor({ state: 'visible', timeout: 60000 })
    onStatus(`主图上传计数已达到 ${images.length}/10；相关请求 ${responses.length} 个，失败 ${failures.length} 个。`)
  } catch (error) {
    if (page.isClosed?.()) throw new Error('商家浏览器或发布页面已关闭，主图上传未完成。', { cause: error })
    await Promise.race([Promise.allSettled(pendingResponses), new Promise(resolve => setTimeout(resolve, 1000))])
    const info = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      return { counters: text.match(/(?:已上传\s*)?\(?\d+\s*\/\s*10\)?(?:张)?/g)?.slice(0, 5) ?? [], warning: text.match(/.{0,15}(?:操作频繁|上传失败|请重试|安全验证).{0,30}/)?.[0] ?? '' }
    }).catch(() => ({ counters: [], warning: '' }))
    throw new Error(`主图上传未确认；页面计数：${info.counters.join('、') || '未找到'}；相关请求：${responses.slice(-10).join('、') || '未观察到'}；失败：${failures.slice(-10).join('、') || '未观察到'}${info.warning ? `；页面提示：${info.warning}` : ''}。请检查商家页面。`, { cause: error })
  } finally {
    page.off?.('requestfailed', onFailure)
    page.off?.('response', onResponse)
  }
  const title = page.getByPlaceholder(/商品标题组成/)
  await title.waitFor({ state: 'visible', timeout: 30000 })
  await title.fill(product.title)
  await title.blur()
  if (await title.inputValue() !== product.title) throw new Error('商品标题未完整填入，请检查并修改标题。')
  return { imageCount: images.length, skipped }
}

export async function advanceProductPage(page, onStatus = () => {}, options = {}) {
  const next = page.getByRole('button', { name: /下一步.*完善商品信息/ })
  await next.waitFor({ state: 'visible', timeout: 15000 })
  await next.click()
  let deadline = Date.now() + (options.navigationTimeout ?? 30000)
  let waitingForVerification = false
  let retriedAfterVerification = false
  while (Date.now() < deadline) {
    try {
      await page.waitForURL(url => url.pathname.includes('/goods/goods_add/'), { timeout: Math.min(options.pollInterval ?? 1000, Math.max(1, deadline - Date.now())) })
      return
    } catch {
      if (page.isClosed?.()) throw new Error('商家浏览器已关闭，请重新操作。')
    }
    let verificationVisible = false
    for (const frame of page.frames?.() ?? []) {
      if (await frame.getByText(/请向右滑块完成拼图|滑动滑块完成拼图|请完成.*验证/).first().isVisible().catch(() => false)) {
        verificationVisible = true
        break
      }
    }
    if (verificationVisible && !waitingForVerification) {
      waitingForVerification = true
      deadline = Date.now() + (options.verificationTimeout ?? 300000)
      onStatus('请在商家浏览器中手动完成滑块验证，完成后将继续。')
      await page.bringToFront()
    } else if (!verificationVisible && waitingForVerification) {
      waitingForVerification = false
      deadline = Date.now() + (options.navigationTimeout ?? 30000)
      onStatus('验证窗口已关闭，正在继续处理。')
      if (!retriedAfterVerification && await next.isVisible().catch(() => false)) {
        retriedAfterVerification = true
        await next.click()
      }
    }
  }
  if (waitingForVerification) throw new Error('等待手动验证超时，请重新操作。')
  const warnings = await page.locator('[role="alert"], [role="dialog"], .ant-message, .ant-notification, .ant-modal, .el-message').allTextContents().catch(() => [])
  const reason = warnings.map(value => value.trim()).find(Boolean)
  throw new Error(reason ? `未能进入商品信息页：${reason}` : '未能进入商品信息页。请检查商家后台的分类、标题或操作频繁提示。')
}
