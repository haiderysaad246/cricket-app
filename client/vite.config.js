import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend (Express) always runs on 3000. Vite dev server proxies API/auth/
// upload/static calls to it so `npm run dev` gives hot-reload React while
// reusing the real backend — no CORS, no duplicated logic.
const BACKEND = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": BACKEND,
      "/login": BACKEND,
      "/logout": BACKEND,
      "/status": BACKEND,
      "/uploads": BACKEND,
      "/images": BACKEND,
      "/css": BACKEND,
      "/manifest.json": BACKEND,
      "/service-worker.js": BACKEND,
      "/icons": BACKEND,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
