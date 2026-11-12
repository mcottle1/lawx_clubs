import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` must match the GitHub Pages sub-path (https://<user>.github.io/<repo>/).
// The deploy workflow sets VITE_BASE_PATH; locally it defaults to "/".
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
})
