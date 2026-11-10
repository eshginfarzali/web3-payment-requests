import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const MEAL = (n: number) => ethers.parseUnits(n.toString(), 2); // 2 decimals
const MONTH = 30 * 24 * 3600;
const REF = ethers.id("bill-001");

describe("MealToken", function () {
  async function deployFixture() {
    const [issuer, company, aysel, murad, restaurant, restaurant2, outsider] = await ethers.getSigners();
    const periodEnd = BigInt(await time.latest()) + BigInt(MONTH);
    const meal = await ethers.deployContract("MealToken", [periodEnd]);
    return { meal, periodEnd, issuer, company, aysel, murad, restaurant, restaurant2, outsider };
  }

  /** Company with 1000 MEAL limit, two employees, one restaurant, 150 MEAL loaded each. */
  async function loadedFixture() {
    const f = await deployFixture();
    const { meal, company, aysel, murad, restaurant } = f;
    await meal.registerCompany(company.address, "Alfa MMC", MEAL(1000));
    await meal.registerEmployee(aysel.address, company.address);
    await meal.registerEmployee(murad.address, company.address);
    await meal.registerRestaurant(restaurant.address, "Dadlı Ev");
    await meal.loadAllowance(company.address, [aysel.address, murad.address], MEAL(150));
    return f;
  }

  describe("setup", function () {
    it("uses 2 decimals so 1 MEAL = 1 AZN with qəpik precision", async function () {
      const { meal } = await loadFixture(deployFixture);
      expect(await meal.decimals()).to.equal(2);
      expect(await meal.symbol()).to.equal("MEAL");
    });

    it("only the issuer can register participants", async function () {
      const { meal, company, outsider } = await loadFixture(deployFixture);
      await expect(meal.connect(outsider).registerCompany(company.address, "X", MEAL(1)))
        .to.be.revertedWithCustomError(meal, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);
    });

    it("an address cannot have two roles", async function () {
      const { meal, aysel } = await loadFixture(loadedFixture);
      await expect(meal.registerRestaurant(aysel.address, "X")).to.be.revertedWith(
        "Address already has a role"
      );
    });
  });

  describe("loadAllowance (mint)", function () {
    it("mints to employees and records the company's debt", async function () {
      const { meal, company, aysel, murad } = await loadFixture(loadedFixture);
      expect(await meal.balanceOf(aysel.address)).to.equal(MEAL(150));
      expect(await meal.balanceOf(murad.address)).to.equal(MEAL(150));
      expect(await meal.totalSupply()).to.equal(MEAL(300));
      expect((await meal.companies(company.address)).debt).to.equal(MEAL(300));
    });

    it("cannot exceed the company's credit limit", async function () {
      const { meal, company, aysel, murad } = await loadFixture(loadedFixture);
      // debt 300 + 2×400 = 1100 > 1000
      await expect(
        meal.loadAllowance(company.address, [aysel.address, murad.address], MEAL(400))
      ).to.be.revertedWith("Credit limit exceeded");
    });

    it("a company payment frees credit limit again", async function () {
      const { meal, company, aysel, murad } = await loadFixture(loadedFixture);
      await expect(meal.recordCompanyPayment(company.address, MEAL(300), "BANK-1"))
        .to.emit(meal, "CompanyPaymentRecorded")
        .withArgs(company.address, MEAL(300), "BANK-1");
      expect((await meal.companies(company.address)).debt).to.equal(0);
      await meal.loadAllowance(company.address, [aysel.address, murad.address], MEAL(400));
    });

    it("cannot load to someone who is not the company's employee", async function () {
      const { meal, company, outsider } = await loadFixture(loadedFixture);
      await expect(
        meal.loadAllowance(company.address, [outsider.address], MEAL(10))
      ).to.be.revertedWith("Not an employee of this company");
    });
  });

  describe("pay", function () {
    it("moves MEAL from employee to restaurant and emits MealPaid", async function () {
      const { meal, aysel, restaurant } = await loadFixture(loadedFixture);
      await expect(meal.connect(aysel).pay(restaurant.address, MEAL(12.5), REF))
        .to.emit(meal, "MealPaid")
        .withArgs(aysel.address, restaurant.address, MEAL(12.5), REF);
      expect(await meal.balanceOf(aysel.address)).to.equal(MEAL(137.5));
      expect(await meal.balanceOf(restaurant.address)).to.equal(MEAL(12.5));
    });

    it("cannot pay someone who is not a partner restaurant", async function () {
      const { meal, aysel, murad } = await loadFixture(loadedFixture);
      await expect(meal.connect(aysel).pay(murad.address, MEAL(10), REF)).to.be.revertedWith(
        "Not a partner restaurant"
      );
    });

    it("a restaurant cannot spend MEAL", async function () {
      const { meal, aysel, restaurant, restaurant2 } = await loadFixture(loadedFixture);
      await meal.registerRestaurant(restaurant2.address, "Şirvan Kabab");
      await meal.connect(aysel).pay(restaurant.address, MEAL(10), REF);
      await expect(
        meal.connect(restaurant).pay(restaurant2.address, MEAL(10), REF)
      ).to.be.revertedWith("Not an employee");
    });

    it("cannot spend more than the balance", async function () {
      const { meal, aysel, restaurant } = await loadFixture(loadedFixture);
      await expect(
        meal.connect(aysel).pay(restaurant.address, MEAL(151), REF)
      ).to.be.revertedWithCustomError(meal, "ERC20InsufficientBalance");
    });

    it("plain ERC20 transfers are disabled (no employee-to-employee trading)", async function () {
      const { meal, aysel, murad } = await loadFixture(loadedFixture);
      await expect(meal.connect(aysel).transfer(murad.address, MEAL(50))).to.be.revertedWith(
        "Transfers disabled: use pay()"
      );
      await expect(
        meal.connect(aysel).transferFrom(aysel.address, murad.address, MEAL(50))
      ).to.be.revertedWith("Transfers disabled: use pay()");
    });

    it("cannot pay after the period has ended", async function () {
      const { meal, periodEnd, aysel, restaurant } = await loadFixture(loadedFixture);
      await time.increaseTo(periodEnd + 1n);
      await expect(meal.connect(aysel).pay(restaurant.address, MEAL(10), REF)).to.be.revertedWith(
        "Period ended"
      );
    });
  });

  describe("redeem and payout", function () {
    it("burns the restaurant's MEAL and queues a payout", async function () {
      const { meal, aysel, restaurant } = await loadFixture(loadedFixture);
      await meal.connect(aysel).pay(restaurant.address, MEAL(40), REF);

      await expect(meal.connect(restaurant).redeem(MEAL(40)))
        .to.emit(meal, "RedemptionRequested")
        .withArgs(0, restaurant.address, MEAL(40));

      expect(await meal.balanceOf(restaurant.address)).to.equal(0);
      expect(await meal.totalSupply()).to.equal(MEAL(260));
      expect(await meal.pendingPayouts()).to.equal(MEAL(40));
      // liability is unchanged by redeeming: tokens became a pending payout
      expect(await meal.totalLiability()).to.equal(MEAL(300));
    });

    it("only a restaurant can redeem", async function () {
      const { meal, aysel } = await loadFixture(loadedFixture);
      await expect(meal.connect(aysel).redeem(MEAL(10))).to.be.revertedWith("Not a partner restaurant");
    });

    it("a payout can be confirmed once, and only by the issuer", async function () {
      const { meal, aysel, restaurant } = await loadFixture(loadedFixture);
      await meal.connect(aysel).pay(restaurant.address, MEAL(40), REF);
      await meal.connect(restaurant).redeem(MEAL(40));

      await expect(meal.connect(restaurant).confirmPayout(0, "X")).to.be.revertedWithCustomError(
        meal,
        "OwnableUnauthorizedAccount"
      );
      await expect(meal.confirmPayout(0, "BANK-77"))
        .to.emit(meal, "RedemptionPaidOut")
        .withArgs(0, restaurant.address, MEAL(40), "BANK-77");
      expect(await meal.pendingPayouts()).to.equal(0);
      await expect(meal.confirmPayout(0, "BANK-77")).to.be.revertedWith("Already paid out");
    });
  });

  describe("period end", function () {
    it("the issuer cannot expire balances before the period ends", async function () {
      const { meal, aysel } = await loadFixture(loadedFixture);
      await expect(meal.expireBalances([aysel.address])).to.be.revertedWith("Period not over");
    });

    it("after the period, unused balances are burned and a new period starts", async function () {
      const { meal, periodEnd, aysel, murad, restaurant } = await loadFixture(loadedFixture);
      await meal.connect(aysel).pay(restaurant.address, MEAL(50), REF);
      await time.increaseTo(periodEnd + 1n);

      await expect(meal.expireBalances([aysel.address, murad.address]))
        .to.emit(meal, "BalanceExpired")
        .withArgs(aysel.address, MEAL(100));
      expect(await meal.balanceOf(aysel.address)).to.equal(0);
      expect(await meal.balanceOf(murad.address)).to.equal(0);
      // the restaurant's earned MEAL is NOT expired
      expect(await meal.balanceOf(restaurant.address)).to.equal(MEAL(50));

      const next = BigInt(await time.latest()) + BigInt(MONTH);
      await expect(meal.startNewPeriod(next)).to.emit(meal, "PeriodStarted").withArgs(next);
      await expect(meal.connect(aysel).pay(restaurant.address, MEAL(1), REF)).to.be.revertedWithCustomError(
        meal,
        "ERC20InsufficientBalance"
      );
    });
  });
});
