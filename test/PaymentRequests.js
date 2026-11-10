const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentRequests", function () {
  async function deployFixture() {
    const [merchant, payer, other] = await ethers.getSigners();
    const mockUSD = await ethers.deployContract("MockUSD");
    const paymentRequests = await ethers.deployContract("PaymentRequests");
    const amount = ethers.parseUnits("25", 18);
    const referenceHash = ethers.id("invoice-001");

    await mockUSD.mint(payer.address, amount);

    return { merchant, payer, other, mockUSD, paymentRequests, amount, referenceHash };
  }

  it("creates a payment request and records its details", async function () {
    const { merchant, payer, mockUSD, paymentRequests, amount, referenceHash } =
      await deployFixture();

    await expect(
      paymentRequests
        .connect(merchant)
        .createRequest(payer.address, await mockUSD.getAddress(), amount, referenceHash)
    )
      .to.emit(paymentRequests, "PaymentRequested")
      .withArgs(0, merchant.address, payer.address, await mockUSD.getAddress(), amount, referenceHash);

    const request = await paymentRequests.requests(0);
    expect(request.creator).to.equal(merchant.address);
    expect(request.payer).to.equal(payer.address);
    expect(request.token).to.equal(await mockUSD.getAddress());
    expect(request.amount).to.equal(amount);
    expect(request.referenceHash).to.equal(referenceHash);
    expect(request.paid).to.equal(false);
  });

  it("transfers test tokens from the payer to the merchant once approved", async function () {
    const { merchant, payer, mockUSD, paymentRequests, amount, referenceHash } =
      await deployFixture();
    const paymentRequestsAddress = await paymentRequests.getAddress();

    await paymentRequests
      .connect(merchant)
      .createRequest(payer.address, await mockUSD.getAddress(), amount, referenceHash);
    await mockUSD.connect(payer).approve(paymentRequestsAddress, amount);

    await expect(paymentRequests.connect(payer).payRequest(0))
      .to.emit(paymentRequests, "PaymentCompleted")
      .withArgs(0, payer.address, merchant.address, await mockUSD.getAddress(), amount);

    expect(await mockUSD.balanceOf(merchant.address)).to.equal(amount);
    expect(await mockUSD.balanceOf(payer.address)).to.equal(0);
    expect((await paymentRequests.requests(0)).paid).to.equal(true);
  });

  it("rejects payment by anyone other than the requested payer", async function () {
    const { merchant, payer, other, mockUSD, paymentRequests, amount, referenceHash } =
      await deployFixture();

    await paymentRequests
      .connect(merchant)
      .createRequest(payer.address, await mockUSD.getAddress(), amount, referenceHash);

    await expect(paymentRequests.connect(other).payRequest(0))
      .to.be.revertedWith("Not the requested payer");
  });

  it("rejects paying the same request twice", async function () {
    const { merchant, payer, mockUSD, paymentRequests, amount, referenceHash } =
      await deployFixture();

    await paymentRequests
      .connect(merchant)
      .createRequest(payer.address, await mockUSD.getAddress(), amount, referenceHash);
    await mockUSD.connect(payer).approve(await paymentRequests.getAddress(), amount);
    await paymentRequests.connect(payer).payRequest(0);

    await expect(paymentRequests.connect(payer).payRequest(0))
      .to.be.revertedWith("Request already paid");
  });

  it("rejects a request with a zero amount", async function () {
    const { merchant, payer, mockUSD, paymentRequests, referenceHash } = await deployFixture();

    await expect(
      paymentRequests
        .connect(merchant)
        .createRequest(payer.address, await mockUSD.getAddress(), 0, referenceHash)
    ).to.be.revertedWith("Amount must be positive");
  });

  it("rejects a nonexistent request", async function () {
    const { payer, paymentRequests } = await deployFixture();

    await expect(paymentRequests.connect(payer).payRequest(0))
      .to.be.revertedWith("Request not found");
  });
});
