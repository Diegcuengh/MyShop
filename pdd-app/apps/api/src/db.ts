import { MongoClient } from 'mongodb'

let client: MongoClient | null = null
let connecting: Promise<MongoClient> | null = null

async function getClient() {
  if (client) return client
  if (!connecting) {
    const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/pdd_local'
    const candidate = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 })
    connecting = candidate.connect().then((connected) => {
      client = connected
      return connected
    }).catch(async (error: unknown) => {
      await candidate.close().catch(() => undefined)
      throw error
    }).finally(() => { connecting = null })
  }
  return connecting
}

export async function getDb() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/pdd_local'
  return (await getClient()).db(new URL(uri).pathname.replace('/', '') || 'pdd_local')
}

export async function getTrendsDb() {
  return (await getClient()).db(process.env.MONGODB_TRENDS_DB ?? 'pdd_sales_trends')
}
