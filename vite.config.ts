import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [
    react({
      include: /\.(jsx|tsx)$/,
      exclude: [/node_modules/, /src\/renderer\/main\.tsx$/]
    }),
    tailwindcss()
  ],
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 800
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  worker: {
    format: "es"
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
