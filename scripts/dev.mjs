// One command for the whole lab: local blockchain → deploy (lesson 1 contracts) → web server.
//   npm run dev
import { spawn } from "child_process";

const children = [];
const run = (args, opts = {}) => {
  const child = spawn("npx", args, { stdio: "inherit", ...opts });
  children.push(child);
  return child;
};
const stopAll = (code = 0) => {
  for (const c of children) c.kill();
  process.exit(code);
};
process.on("SIGINT", () => stopAll());
process.on("SIGTERM", () => stopAll());

console.log("▶ Starting local blockchain (Hardhat node on :8545)…");
// The node logs every request; keep its output quiet and only watch for the ready line.
const node = run(["hardhat", "node"], { stdio: ["ignore", "pipe", "inherit"] });
let ready = false;
node.stdout.on("data", (chunk) => {
  if (ready || !chunk.toString().includes("Started HTTP")) return;
  ready = true;
  console.log("✓ Blockchain running\n▶ Deploying lesson 1 contracts…");
  run(["hardhat", "run", "scripts/deploy.ts", "--network", "localhost"]).on("exit", (code) => {
    if (code !== 0) {
      console.error("✗ Deploy failed");
      return stopAll(1);
    }
    console.log("▶ Starting web server…");
    run(["vite"]);
  });
});
node.on("exit", (code) => {
  if (!ready) {
    console.error("✗ Hardhat node exited. Is port 8545 already in use? (another `npm run node`?)");
    stopAll(code ?? 1);
  }
});
