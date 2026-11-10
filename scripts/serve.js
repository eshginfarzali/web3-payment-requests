// Tiny static server for the demo page: serves web/ and the local ethers browser build.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
const root = path.join(__dirname, "..");
const routes = {
  "/": "web/index.html",
  "/index.html": "web/index.html",
  "/config.json": "web/config.json",
  "/ethers.js": "node_modules/ethers/dist/ethers.umd.min.js",
};
const types = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript" };

http
  .createServer((req, res) => {
    const file = routes[req.url.split("?")[0]];
    if (!file) return res.writeHead(404).end("Not found");
    fs.readFile(path.join(root, file), (err, data) => {
      if (err) return res.writeHead(404).end(`${file} missing — run npm run deploy:node first`);
      res.writeHead(200, { "Content-Type": types[path.extname(file)], "Cache-Control": "no-store" });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Demo page: http://localhost:${PORT}`));
