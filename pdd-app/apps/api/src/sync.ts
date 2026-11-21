import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'

type SyncResult = {
  importedRuns: number
  skippedRuns: number
  failedRuns: number
  buildInfo: string
}

const importerPath = fileURLToPath(new URL('../../../../import_pdd_to_mongo.py', import.meta.url))

let activeSync: Promise<SyncResult> | null = null

function summaryCount(output: string, key: string) {
  return Number(output.match(new RegExp(`^\\s*${key}:\\s*(\\d+)\\s*$`, 'm'))?.[1] ?? 0)
}

function runImporter(): Promise<SyncResult> {
  const dataRoot = process.env.PDD_CRAWL_ROOT ?? 'E:\\ds电商\\data'
  const python = process.env.PDD_PYTHON ?? 'python'
  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/pdd_local'
  const trendsDb = process.env.MONGODB_TRENDS_DB ?? 'pdd_sales_trends'
  if (!existsSync(importerPath)) {
    return Promise.reject(new Error(`找不到导入脚本：${importerPath}`))
  }
  if (!existsSync(dataRoot)) {
    return Promise.reject(new Error(`找不到抓取目录：${dataRoot}`))
  }

  return new Promise((resolve, reject) => {
    const child = spawn(python, [
      importerPath,
      '--data_root', dataRoot,
      '--mongo_uri', mongoUri,
      '--db', trendsDb,
      '--dir', '全部',
      '--dry_run', 'false'
    ], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`无法启动导入脚本：${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const failedRuns = summaryCount(stdout, 'failed_runs')
      if (code !== 0 || failedRuns > 0) {
        if (/ServerSelectionTimeoutError|ECONNREFUSED|No servers found/i.test(stderr)) {
          reject(new Error('无法连接 MongoDB 数据库，请启动数据库后重试。'))
          return
        }
        reject(new Error(`同步抓取失败：${(stderr || stdout).trim().slice(-1200) || `退出码 ${code}`}`))
        return
      }
      resolve({
        importedRuns: summaryCount(stdout, 'runs'),
        skippedRuns: summaryCount(stdout, 'skipped_runs'),
        failedRuns,
        buildInfo: stdout.split(/\r?\n/)[0] ?? ''
      })
    })
  })
}

export async function registerSyncRoutes(app: FastifyInstance) {
  app.post('/api/trends/sync', async (_request, reply) => {
    try {
      activeSync ??= runImporter().finally(() => { activeSync = null })
      return await activeSync
    } catch (error) {
      reply.status(500)
      return { message: error instanceof Error ? error.message : '同步抓取失败' }
    }
  })
}
