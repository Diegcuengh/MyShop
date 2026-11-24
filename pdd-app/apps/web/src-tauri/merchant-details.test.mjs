import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fillDetails } from './merchant-details.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('fills clearly labelled properties and checks detail upload', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<label>材质<input></label><label for="brand">品牌</label><select id="brand"><option>其他</option><option>示例品牌</option></select><div>已上传0/50张<input type="file" multiple></div><table><tr><td>红字款</td><td><input type="file"></td></tr></table><script>document.querySelector('[type=file]').onchange = e => e.target.parentElement.firstChild.textContent = '已上传' + e.target.files.length + '/50张'</script>`)
    const result = await fillDetails(page, {
      apiOrigin: 'http://localhost:3001',
      detailImageUrls: ['http://localhost:3001/api/assets/image?path=detail.png'],
      skuImages: [{ skuId: '1', specs: [{ value: '红字款' }], imageUrl: 'http://localhost:3001/api/assets/image?path=sku.png' }, { skuId: '2', specs: [{ value: '未匹配' }], imageUrl: 'http://localhost:3001/api/assets/image?path=sku2.png' }],
      properties: [{ name: '材质', values: ['石材'] }, { name: '品牌', values: ['示例品牌'] }, { name: '不存在', values: ['未知'] }],
    }, () => {}, async () => new Response(png, { headers: { 'content-type': 'image/png' } }))
    assert.deepEqual(result.filled, ['材质', '品牌'])
    assert.deepEqual(result.manual, ['不存在'])
    assert.equal(result.uploaded, 1)
    assert.deepEqual(result.skuSelected, ['红字款'])
    assert.deepEqual(result.skuManual, ['未匹配'])
    assert.equal(await page.getByLabel('材质').inputValue(), '石材')
  } finally { await browser.close() }
})
