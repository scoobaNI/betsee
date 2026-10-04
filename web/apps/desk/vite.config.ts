import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri serves the built files from its own origin, so asset paths stay relative.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 1430, strictPort: true },
  build: { target: "es2022" },
});
