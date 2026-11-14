import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  // the server tests load LangGraph and start real HTTP servers, which can be slow on a busy machine
  test: { testTimeout: 20000, hookTimeout: 20000 },
})
