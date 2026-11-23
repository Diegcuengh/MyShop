import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
const buildInfoPath = fileURLToPath(new URL('./.web-build-info.json', import.meta.url))
type BuildInfo = { count: number; value: string }

function loadBuildInfo(): BuildInfo {
  try {
    return JSON.parse(readFileSync(buildInfoPath, 'utf8')) as BuildInfo
  } catch {
    return { count: 0, value: 'development/unbuilt' }
  }
}

export default defineConfig(({ command }) => {
  const info = loadBuildInfo()
  if (command === 'build') {
    const count = info.count + 1
    const date = new Date()
    const part = (number: number) => String(number).padStart(2, '0')
    const timestamp = `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}/${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`
    info.count = count
    info.value = `v0.${Math.floor(count / 10)}.${count % 10}/${timestamp}`
    writeFileSync(buildInfoPath, JSON.stringify(info))
  }
  console.info(`MyShop Web ${info.value}`)
  return {
  define: { 'import.meta.env.VITE_APP_BUILD_INFO': JSON.stringify(info.value) },
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:43121',
        changeOrigin: true
      }
    }
  }
  }
})
