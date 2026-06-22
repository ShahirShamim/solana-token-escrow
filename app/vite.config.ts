import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // @solana/web3.js / @coral-xyz/anchor reference the Node `global`; map it to
  // the browser global. Buffer is polyfilled in src/main.tsx.
  define: {
    global: 'globalThis',
  },
})
