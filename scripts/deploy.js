const fs = require("fs");
const path = require("path");

async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;

  const mockUSD = await ethers.deployContract("MockUSD");
  await mockUSD.waitForDeployment();

  const paymentRequests = await ethers.deployContract("PaymentRequests");
  await paymentRequests.waitForDeployment();

  // Give the first 5 test accounts 1000 mUSD each so the web demo has something to pay with.
  for (const signer of signers.slice(0, 5)) {
    await (await mockUSD.mint(signer.address, ethers.parseUnits("1000", 18))).wait();
  }

  const mockUSDAddress = await mockUSD.getAddress();
  const paymentRequestsAddress = await paymentRequests.getAddress();

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("MockUSD:", mockUSDAddress);
  console.log("PaymentRequests:", paymentRequestsAddress);

  // Write addresses + ABIs for the web page (only useful for a persistent node).
  if (network.name === "localhost") {
    const config = {
      rpcUrl: "http://127.0.0.1:8545",
      mockUSD: { address: mockUSDAddress, abi: (await artifacts.readArtifact("MockUSD")).abi },
      paymentRequests: {
        address: paymentRequestsAddress,
        abi: (await artifacts.readArtifact("PaymentRequests")).abi,
      },
    };
    const out = path.join(__dirname, "..", "web", "config.json");
    fs.writeFileSync(out, JSON.stringify(config, null, 2));
    console.log("Wrote", path.relative(process.cwd(), out));
  } else {
    console.log("These contracts are deployed only to Hardhat's temporary in-process network.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
