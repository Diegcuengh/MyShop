import { ObjectId } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { getDb } from './db.js'

type ProductInput = {
  name?: unknown
  price?: unknown
  description?: unknown
}

function normalizeProduct(input: ProductInput) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const price = Number(input.price)
  const description = typeof input.description === 'string' ? input.description.trim() : ''

  if (!name) {
    throw new Error('商品名称不能为空')
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error('商品价格必须是大于等于 0 的数字')
  }

  return {
    name,
    price,
    description,
    createdAt: new Date()
  }
}

function serializeProduct(product: Record<string, unknown>) {
  return {
    ...product,
    _id: String(product._id)
  }
}

export async function registerProductRoutes(app: FastifyInstance) {
  app.get('/api/products', async () => {
    const db = await getDb()
    const products = await db
      .collection('products')
      .find()
      .sort({ createdAt: -1 })
      .toArray()

    return products.map(serializeProduct)
  })

  app.post('/api/products', async (request, reply) => {
    try {
      const db = await getDb()
      const product = normalizeProduct(request.body as ProductInput)
      const result = await db.collection('products').insertOne(product)

      reply.code(201)
      return serializeProduct({ _id: result.insertedId, ...product })
    } catch (error) {
      reply.code(400)
      return { message: error instanceof Error ? error.message : '新增商品失败' }
    }
  })

  app.get('/api/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    if (!ObjectId.isValid(id)) {
      reply.code(404)
      return { message: '商品不存在' }
    }

    const db = await getDb()
    const product = await db.collection('products').findOne({ _id: new ObjectId(id) })

    if (!product) {
      reply.code(404)
      return { message: '商品不存在' }
    }

    return serializeProduct(product)
  })

  app.delete('/api/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    if (!ObjectId.isValid(id)) {
      reply.code(404)
      return { message: '商品不存在' }
    }

    const db = await getDb()
    const result = await db.collection('products').deleteOne({ _id: new ObjectId(id) })

    if (result.deletedCount === 0) {
      reply.code(404)
      return { message: '商品不存在' }
    }

    return { ok: true }
  })
}
