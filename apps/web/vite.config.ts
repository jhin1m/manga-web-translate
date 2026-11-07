import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false };

// SPA và API cùng origin ở dev (proxy /api) → cookie phiên first-party, không cần CORS. `/files`: link file của
// STORAGE_DRIVER=disk do API phục vụ (CORP same-origin chặn <img> khác origin → phải qua proxy).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: { "/api": api, "/files": api },
  },
});
