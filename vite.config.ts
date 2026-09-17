import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    // Android 7.0+ can run Android System WebView as old as Chromium 83 (the
    // API 30 emulator image used by the release smoke), and Linux uses
    // WebKitGTK. Targeting them keeps esbuild from emitting newer syntax, such
    // as merging top/right/bottom/left into `inset`, that those engines ignore.
    target: ['es2020', 'chrome83', 'safari15'],
    cssTarget: ['chrome83', 'safari15'],
  },
})
