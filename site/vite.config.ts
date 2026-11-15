import { defineConfig } from "vite";
import { resolve } from "node:path";

// One page, one output folder: the GPU server (cloud_modal/modal_app.py) serves dist-share.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    outDir: "dist-share",
    rollupOptions: { input: { share: resolve(__dirname, "share.html") } },
  },
});
