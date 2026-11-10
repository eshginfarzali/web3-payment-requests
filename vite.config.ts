import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    // The web app imports the generated contract types from ../typechain-types.
    fs: { allow: [".."] },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
