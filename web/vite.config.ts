import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Static (GitHub Pages) build uses relative asset paths so it works under /<repo>/.
  base: process.env.VITE_STATIC === "1" ? "./" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
    fs: { allow: [".."] }, // shared finance model lives in ../server/src
  },
});
