import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('worker reports invalid products without opening a browser', async () => {
  const worker = spawn(process.execPath, [fileURLToPath(new URL('./merchant-browser.mjs', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MYSHOP_BUILD_INFO: 'test/build' },
  })
  let output = ''
  let errors = ''
  worker.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  worker.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk })
  worker.stdin.end(`${JSON.stringify({ type: 'prepare', product: {} })}\n`)
  const code = await new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('close', resolve)
  })
  assert.equal(code, 0)
  assert.match(errors, /MyShop test\/build/)
  assert.deepEqual(JSON.parse(output.trim()), { message: '商品标题或本地主图缺失，无法填写。', isError: true, state: 'error' })
})
