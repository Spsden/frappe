import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    plugins: [react(), tailwindcss()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') }
      }
    }
  }
})
