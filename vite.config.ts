import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: resolve(__dirname, "web"),
  base: "/ui/",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "web-dist"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [resolve(__dirname)],
    },
  },
});
