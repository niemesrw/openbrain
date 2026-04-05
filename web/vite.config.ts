import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  server: {
    port: 5173,
    strictPort: true, // fail loudly instead of silently picking a different port
  },
  build: {
    outDir: "dist",
  },
});
