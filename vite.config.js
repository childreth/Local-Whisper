import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  base: "./", // Required for Electron to load dist/index.html as a file
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_"],
  build: {
    target: ["es2021", "chrome120"],
    minify: !process.env.ELECTRON_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.ELECTRON_DEBUG,
  },
});
