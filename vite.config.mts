import { resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    // GitHub Codespaces serves the forwarded port from *.app.github.dev.
    allowedHosts: [".app.github.dev"],
    // The web app imports the generated contract types from ../typechain-types.
    fs: { allow: [".."] },
    // Browser → /rpc → local Hardhat node. Works locally and in GitHub Codespaces.
    proxy: {
      "/rpc": { target: "http://127.0.0.1:8545", changeOrigin: true, rewrite: () => "/" },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(here, "web/index.html"),
        payments: resolve(here, "web/payments.html"),
        meal: resolve(here, "web/meal.html"),
      },
    },
  },
});
