import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import { config } from 'dotenv'
import Fastify from 'fastify'
import { registerProductRoutes } from './products.js'
import { registerTrendRoutes } from './trends.js'
import { registerSyncRoutes } from './sync.js'

config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url))
})

const port = Number(process.env.PORT ?? 3001)
const app = Fastify({
  logger: true
})

app.setErrorHandler((error, request, reply) => {
  request.log.error(error)
  if (error instanceof Error && (error.name.startsWith('Mongo') || /ECONNREFUSED.*27017/.test(error.message))) {
    return reply.status(503).send({ message: '无法连接 MongoDB 数据库，请检查 MongoDB 是否已启动，然后点击刷新。' })
  }
  return reply.send(error)
})

await app.register(cors, {
  origin: true
})

app.get('/health', async () => ({ ok: true }))
await registerProductRoutes(app)
await registerTrendRoutes(app)
await registerSyncRoutes(app)

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
