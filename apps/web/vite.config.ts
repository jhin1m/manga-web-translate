import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// SPA và API cùng origin ở dev (proxy /api) → cookie phiên first-party, không cần CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false } },
  },
});
