import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5180,
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8300",
      "/tools": "http://127.0.0.1:8300",
    },
  },
  build: { outDir: "dist" },
});