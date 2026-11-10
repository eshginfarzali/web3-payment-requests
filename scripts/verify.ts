// Publishes the Solidity source of the deployed contracts on Etherscan, so anyone can read
// exactly what code runs at those addresses.
import { network, run } from "hardhat";
import deployments from "../web/src/deployments.json";

async function main() {
  const { chainId } = network.config;
  const entry = (deployments as Record<string, { mockUSD: string; paymentRequests: string }>)[
    String(chainId)
  ];
  if (!entry) throw new Error(`No deployment for chainId ${chainId}. Run the deploy first.`);

  for (const address of [entry.mockUSD, entry.paymentRequests]) {
    try {
      await run("verify:verify", { address, constructorArguments: [] });
    } catch (e) {
      console.log(`${address}: ${(e as Error).message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
