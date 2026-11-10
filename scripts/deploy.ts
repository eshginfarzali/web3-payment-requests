import fs from "fs";
import path from "path";
import { ethers, network } from "hardhat";

// The web app reads contract addresses from here, keyed by chain id.
const DEPLOYMENTS_FILE = path.join(__dirname, "..", "web", "src", "deployments.json");

type Deployments = Record<string, { network: string; mockUSD: string; paymentRequests: string }>;

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const mockUSD = await ethers.deployContract("MockUSD");
  await mockUSD.waitForDeployment();
  const paymentRequests = await ethers.deployContract("PaymentRequests");
  await paymentRequests.waitForDeployment();

  const mockUSDAddress = await mockUSD.getAddress();
  const paymentRequestsAddress = await paymentRequests.getAddress();
  console.log(`MockUSD:         ${mockUSDAddress}`);
  console.log(`PaymentRequests: ${paymentRequestsAddress}`);

  if (network.name === "hardhat") {
    console.log("In-process network: contracts disappear when this script exits.");
    return;
  }

  // On the local node, pre-fund the first 5 test accounts so the demo is ready to use.
  if (network.name === "localhost") {
    for (const signer of (await ethers.getSigners()).slice(0, 5)) {
      await (await mockUSD.mint(signer.address, ethers.parseUnits("1000", 18))).wait();
    }
    console.log("Minted 1000 mUSD to accounts 0-4");
  }

  const deployments: Deployments = fs.existsSync(DEPLOYMENTS_FILE)
    ? JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"))
    : {};
  deployments[chainId.toString()] = {
    network: network.name,
    mockUSD: mockUSDAddress,
    paymentRequests: paymentRequestsAddress,
  };
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2) + "\n");
  console.log(`Saved addresses to ${path.relative(process.cwd(), DEPLOYMENTS_FILE)}`);

  if (network.name === "sepolia") {
    console.log(`\nEtherscan: https://sepolia.etherscan.io/address/${paymentRequestsAddress}`);
    console.log("Verify source code with: npm run verify:sepolia");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
