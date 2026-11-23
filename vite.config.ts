import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: "../../dist/public", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:7642", "/uploads": "http://localhost:7642" } },
});
