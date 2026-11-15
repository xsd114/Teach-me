import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5274',
        changeOrigin: false,
      },
      // 语音走 WebSocket，必须单独代理，否则前端的 ws 会打到 vite 自己身上
      '/ws': {
        target: 'ws://127.0.0.1:5274',
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
