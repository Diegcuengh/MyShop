const SIZE = 16
const MAX_DISTANCE = 27

async function signature(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas unavailable')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
    return context.getImageData(0, 0, SIZE, SIZE).data
  } finally {
    bitmap.close()
  }
}

export async function findSimilarCovers(
  file: File, covers: Array<{ id: string; url: string; fallback?: string }>, assetOrigin: string, signal: AbortSignal,
) {
  const target = await signature(file)
  const results: Array<{ id: string; distance: number }> = []
  let cursor = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (!signal.aborted && cursor < covers.length) {
      const candidate = covers[cursor++]
      if (!candidate) break
      for (const url of new Set([candidate.url, candidate.fallback])) {
        if (!url) continue
        try {
          const asset = new URL(url, location.href)
          if (asset.origin !== assetOrigin || asset.pathname !== '/api/assets/image') continue
          const response = await fetch(asset, { signal, redirect: 'error' })
          if (!response.ok) continue
          const pixels = await signature(await response.blob())
          let sum = 0
          for (let i = 0; i < pixels.length; i++) {
            if (i % 4 !== 3) sum += Math.abs((pixels[i] ?? 0) - (target[i] ?? 0))
          }
          const distance = sum / (SIZE * SIZE * 3)
          if (distance <= MAX_DISTANCE) results.push({ id: candidate.id, distance })
          break
        } catch {
          if (signal.aborted) return
        }
      }
    }
  }))
  signal.throwIfAborted()
  return results.sort((a, b) => a.distance - b.distance).map(result => result.id)
}
