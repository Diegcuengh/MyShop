import test from 'node:test'
import assert from 'node:assert/strict'
import { openProductPage } from './merchant-pages.mjs'

function makePage(initial = 'about:blank', fail = false) {
  let current = initial
  return {
    closed: false,
    isClosed() { return this.closed },
    url() { return current },
    async goto(url) { if (fail) throw new Error('navigation failed'); current = url },
    async bringToFront() {},
    async close() { this.closed = true },
  }
}

test('reuses a blank page without touching an existing product page', async () => {
  const existing = makePage('https://mms.pinduoduo.com/goods/category')
  const blank = makePage()
  const page = await openProductPage({ pages: () => [existing, blank], newPage: () => { throw new Error('unexpected') } })
  assert.equal(page, blank)
  assert.equal(existing.url(), 'https://mms.pinduoduo.com/goods/category')
  assert.equal(blank.url(), 'https://mms.pinduoduo.com/goods/category')
})

test('closes only a new empty page after navigation failure', async () => {
  const page = makePage('about:blank', true)
  await assert.rejects(openProductPage({ pages: () => [], newPage: async () => page }), /无法打开/)
  assert.equal(page.closed, true)
})

test('does not close a pre-existing blank page after navigation failure', async () => {
  const page = makePage('about:blank', true)
  await assert.rejects(openProductPage({ pages: () => [page] }), /无法打开/)
  assert.equal(page.closed, false)
})
