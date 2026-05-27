import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/pdd_local'
const dbName = new URL(uri).pathname.replace('/', '') || 'pdd_local'
const trendsDbName = process.env.MONGODB_TRENDS_DB ?? 'pdd_sales_trends'

let client: MongoClient | null = null

export async function getDb() {
  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
  }

  return client.db(dbName)
}

export async function getTrendsDb() {
  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
  }

  return client.db(trendsDbName)
}
