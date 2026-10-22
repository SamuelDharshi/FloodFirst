import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    nodePolyfills({ include: ["buffer"], globals: { Buffer: true } }),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "FloodFirst (testnet)",
        short_name: "FloodFirst",
        description: "Anticipatory flood cash on a testnet. Offline merchant voucher verification.",
        theme_color: "#0a0b09",
        background_color: "#0a0b09",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,wasm,jpg,png,webp,woff2}"], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, navigateFallback: "/index.html" },
    }),
  ],
  server: { port: 3000, strictPort: true, host: true, proxy: { "/api": "http://localhost:3001", "/admin": "http://localhost:3001" } },
  preview: { port: 3000, strictPort: true, host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  test: { environment: "node" },
} as never);
