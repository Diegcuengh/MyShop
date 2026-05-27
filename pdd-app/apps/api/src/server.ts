import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import { config } from 'dotenv'
import Fastify from 'fastify'
import { registerProductRoutes } from './products.js'
import { registerTrendRoutes } from './trends.js'

config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url))
})

const port = Number(process.env.PORT ?? 3001)
const app = Fastify({
  logger: true
})

await app.register(cors, {
  origin: true
})

app.get('/health', async () => ({ ok: true }))
await registerProductRoutes(app)
await registerTrendRoutes(app)

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
