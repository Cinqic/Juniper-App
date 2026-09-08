import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: [
      'node_modules/**',
      'dist/**',
      'src-tauri/gen/**',
      'src-tauri/plugins/**/android/.cxx/**',
      'src-tauri/plugins/**/android/build/**',
    ],
  },
})
