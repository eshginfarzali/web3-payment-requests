import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const NO_DEADLINE = 0n;
const Status = { Pending: 0n, Paid: 1n, Cancelled: 2n };

describe("PaymentRequests", function () {
  async function deployFixture() {
    const [merchant, payer, other] = await ethers.getSigners();
    const mockUSD = await ethers.deployContract("MockUSD");
    const paymentRequests = await ethers.deployContract("PaymentRequests");
    const token = await mockUSD.getAddress();
    const amount = ethers.parseUnits("25", 18);
    const referenceHash = ethers.id("invoice-001");

    await mockUSD.mint(payer.address, amount);

    // Helper: merchant creates a request for `payer`, optionally with a deadline.
    const createRequest = (dueDate: bigint = NO_DEADLINE) =>
      paymentRequests
        .connect(merchant)
        .createRequest(payer.address, token, amount, referenceHash, dueDate);

    const approveAndPay = async (requestId = 0) => {
      await mockUSD.connect(payer).approve(await paymentRequests.getAddress(), amount);
      return paymentRequests.connect(payer).payRequest(requestId);
    };

    return { merchant, payer, other, mockUSD, paymentRequests, token, amount, referenceHash, createRequest, approveAndPay };
  }

  describe("createRequest", function () {
    it("records the request and emits PaymentRequested", async function () {
      const { merchant, payer, paymentRequests, token, amount, referenceHash, createRequest } =
        await loadFixture(deployFixture);
      const dueDate = BigInt(await time.latest()) + 3600n;

      await expect(createRequest(dueDate))
        .to.emit(paymentRequests, "PaymentRequested")
        .withArgs(0, merchant.address, payer.address, token, amount, referenceHash, dueDate);

      const request = await paymentRequests.requests(0);
      expect(request.creator).to.equal(merchant.address);
      expect(request.payer).to.equal(payer.address);
      expect(request.amount).to.equal(amount);
      expect(request.dueDate).to.equal(dueDate);
      expect(request.status).to.equal(Status.Pending);
    });

    it("rejects a zero amount", async function () {
      const { payer, paymentRequests, token, referenceHash } = await loadFixture(deployFixture);
      await expect(
        paymentRequests.createRequest(payer.address, token, 0, referenceHash, NO_DEADLINE)
      ).to.be.revertedWith("Amount must be positive");
    });

    it("rejects a due date in the past", async function () {
      const { createRequest } = await loadFixture(deployFixture);
      const past = BigInt(await time.latest()) - 1n;
      await expect(createRequest(past)).to.be.revertedWith("Due date in the past");
    });
  });

  describe("payRequest", function () {
    it("moves tokens from payer to merchant once approved", async function () {
      const { merchant, payer, mockUSD, paymentRequests, amount, createRequest, approveAndPay } =
        await loadFixture(deployFixture);
      await createRequest();

      await expect(approveAndPay())
        .to.emit(paymentRequests, "PaymentCompleted")
        .withArgs(0, payer.address, merchant.address, await mockUSD.getAddress(), amount);

      expect(await mockUSD.balanceOf(merchant.address)).to.equal(amount);
      expect(await mockUSD.balanceOf(payer.address)).to.equal(0);
      expect((await paymentRequests.requests(0)).status).to.equal(Status.Paid);
    });

    it("rejects anyone other than the requested payer", async function () {
      const { other, paymentRequests, createRequest } = await loadFixture(deployFixture);
      await createRequest();
      await expect(paymentRequests.connect(other).payRequest(0)).to.be.revertedWith(
        "Not the requested payer"
      );
    });

    it("rejects paying twice", async function () {
      const { createRequest, approveAndPay } = await loadFixture(deployFixture);
      await createRequest();
      await approveAndPay();
      await expect(approveAndPay()).to.be.revertedWith("Request already paid");
    });

    it("rejects a nonexistent request", async function () {
      const { payer, paymentRequests } = await loadFixture(deployFixture);
      await expect(paymentRequests.connect(payer).payRequest(99)).to.be.revertedWith(
        "Request not found"
      );
    });

    it("allows payment before the due date but not after", async function () {
      const { paymentRequests, createRequest, approveAndPay } = await loadFixture(deployFixture);
      const dueDate = BigInt(await time.latest()) + 3600n;
      await createRequest(dueDate); // id 0
      await createRequest(dueDate); // id 1

      await approveAndPay(0); // in time

      await time.increaseTo(dueDate + 1n);
      expect(await paymentRequests.isOverdue(1)).to.equal(true);
      await expect(approveAndPay(1)).to.be.revertedWith("Request overdue");
    });
  });

  describe("cancelRequest", function () {
    it("lets the creator cancel, after which it cannot be paid", async function () {
      const { merchant, paymentRequests, createRequest, approveAndPay } =
        await loadFixture(deployFixture);
      await createRequest();

      await expect(paymentRequests.connect(merchant).cancelRequest(0))
        .to.emit(paymentRequests, "PaymentCancelled")
        .withArgs(0, merchant.address);
      expect((await paymentRequests.requests(0)).status).to.equal(Status.Cancelled);
      await expect(approveAndPay()).to.be.revertedWith("Request cancelled");
    });

    it("rejects cancellation by anyone but the creator", async function () {
      const { payer, paymentRequests, createRequest } = await loadFixture(deployFixture);
      await createRequest();
      await expect(paymentRequests.connect(payer).cancelRequest(0)).to.be.revertedWith(
        "Only the creator can cancel"
      );
    });

    it("cannot cancel a request that is already paid", async function () {
      const { merchant, paymentRequests, createRequest, approveAndPay } =
        await loadFixture(deployFixture);
      await createRequest();
      await approveAndPay();
      await expect(paymentRequests.connect(merchant).cancelRequest(0)).to.be.revertedWith(
        "Request already paid"
      );
    });
  });
});
