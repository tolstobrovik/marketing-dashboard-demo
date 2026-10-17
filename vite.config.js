import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// What build is this? Stamped in at build time so the running app can say
// which version it is. Somebody asking "is the new thing live yet?" should be
// able to answer it by looking, not by guessing from whether they can find
// the feature.
const stamp = () => {
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return `${when} · ${sha}`
  } catch { return when } // a deploy host without git history still gets a date
}

// The React client lives in ./client and talks to the Express API on :4000.
// In dev, Vite serves the UI on :5173 and proxies /api to the API server.
// A second checkout can run beside the first: API_PORT and WEB_PORT move both.
const API = `http://localhost:${process.env.API_PORT || 4000}`
export default defineConfig({
  root: 'client',
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(stamp()) },
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    proxy: {
      '/api': API,
      // The privacy policy is the server's own page, not the app's.
      '/privacy': API,
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Long-lived libraries in their own chunks: app updates don't bust
        // the framework cache, and lazy pages share one icons bundle.
        //
        // Recharts (and the d3 pieces it brings) is the heaviest of them and
        // is drawn on exactly one page. In a chunk of its own it is fetched
        // only when the Statistics charts are — nothing on the first paint
        // imports it — and an edit to that page no longer makes every visitor
        // download the charting library again with it.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
          charts: ['recharts'],
        },
      },
    },
  },
})
