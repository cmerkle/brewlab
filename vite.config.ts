import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The build's own version, so a running app can tell when the server has a newer one.
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "../../dist/public", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:7642", "/uploads": "http://localhost:7642" } },
});
