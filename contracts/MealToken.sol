// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MealToken — educational closed-loop meal-voucher token
 *
 * 1 MEAL = 1 AZN of food at a partner restaurant. 2 decimals (qəpik).
 *
 * Roles:
 *  - Issuer (owner): registers companies, employees and restaurants, loads monthly
 *    allowances, confirms bank payouts. Cannot break the rules below.
 *  - Company: gets a credit limit; owes the issuer for every MEAL loaded to its employees.
 *  - Employee: can ONLY spend MEAL at a registered restaurant (pay).
 *  - Restaurant: can ONLY redeem MEAL back to the issuer (redeem → burn → bank payout).
 *
 * Rules enforced by code:
 *  - Loading is limited by the company's credit limit (debt + new load <= limit).
 *  - Plain ERC20 transfers are disabled: no employee-to-employee trading, no resale.
 *  - Spending is only possible until the end of the current period (month).
 *  - Unused balances can be expired only AFTER the period ends — not earlier.
 *  - A payout can be confirmed only once.
 */
contract MealToken is ERC20, Ownable {
    struct Company {
        string name;
        bool active;
        uint256 creditLimit; // max unpaid MEAL the company may owe
        uint256 debt; // MEAL loaded but not yet paid for by the company
    }

    struct Redemption {
        address restaurant;
        uint256 amount;
        bool paidOut;
        string bankRef;
    }

    mapping(address => Company) public companies;
    mapping(address => address) public employerOf; // employee => company
    mapping(address => string) public restaurantName;
    mapping(address => bool) public isRestaurant;

    Redemption[] public redemptions;
    uint256 public pendingPayouts; // redeemed MEAL the issuer still has to pay out in AZN
    uint64 public periodEnd; // unix seconds; spending allowed until this moment

    event CompanyRegistered(address indexed company, string name, uint256 creditLimit);
    event CreditLimitChanged(address indexed company, uint256 creditLimit);
    event EmployeeRegistered(address indexed employee, address indexed company);
    event RestaurantRegistered(address indexed restaurant, string name);
    event AllowanceLoaded(address indexed company, address indexed employee, uint256 amount);
    event MealPaid(address indexed employee, address indexed restaurant, uint256 amount, bytes32 ref);
    event RedemptionRequested(uint256 indexed id, address indexed restaurant, uint256 amount);
    event RedemptionPaidOut(uint256 indexed id, address indexed restaurant, uint256 amount, string bankRef);
    event CompanyPaymentRecorded(address indexed company, uint256 amount, string bankRef);
    event BalanceExpired(address indexed employee, uint256 amount);
    event PeriodStarted(uint64 periodEnd);

    constructor(uint64 firstPeriodEnd) ERC20("Meal Credit", "MEAL") Ownable(msg.sender) {
        require(firstPeriodEnd > block.timestamp, "Period end in the past");
        periodEnd = firstPeriodEnd;
        emit PeriodStarted(firstPeriodEnd);
    }

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    // ----------------------------------------------------------------- registration

    function registerCompany(address company, string calldata name, uint256 creditLimit) external onlyOwner {
        require(company != address(0), "Invalid address");
        require(!companies[company].active, "Company already registered");
        require(!_isParticipant(company), "Address already has a role");
        companies[company] = Company({name: name, active: true, creditLimit: creditLimit, debt: 0});
        emit CompanyRegistered(company, name, creditLimit);
    }

    function setCreditLimit(address company, uint256 creditLimit) external onlyOwner {
        require(companies[company].active, "Unknown company");
        companies[company].creditLimit = creditLimit;
        emit CreditLimitChanged(company, creditLimit);
    }

    function registerEmployee(address employee, address company) external onlyOwner {
        require(employee != address(0), "Invalid address");
        require(companies[company].active, "Unknown company");
        require(!_isParticipant(employee) && !companies[employee].active, "Address already has a role");
        employerOf[employee] = company;
        emit EmployeeRegistered(employee, company);
    }

    function registerRestaurant(address restaurant, string calldata name) external onlyOwner {
        require(restaurant != address(0), "Invalid address");
        require(!_isParticipant(restaurant) && !companies[restaurant].active, "Address already has a role");
        isRestaurant[restaurant] = true;
        restaurantName[restaurant] = name;
        emit RestaurantRegistered(restaurant, name);
    }

    // ----------------------------------------------------------------- money in

    /// Monthly load: mints `amountEach` to every listed employee of `company`.
    function loadAllowance(address company, address[] calldata employees, uint256 amountEach) external onlyOwner {
        Company storage c = companies[company];
        require(c.active, "Unknown company");
        require(amountEach > 0, "Amount must be positive");
        require(block.timestamp <= periodEnd, "Period ended");

        uint256 total = amountEach * employees.length;
        require(c.debt + total <= c.creditLimit, "Credit limit exceeded");
        c.debt += total;

        for (uint256 i = 0; i < employees.length; i++) {
            require(employerOf[employees[i]] == company, "Not an employee of this company");
            _mint(employees[i], amountEach);
            emit AllowanceLoaded(company, employees[i], amountEach);
        }
    }

    /// The company paid its invoice by bank transfer; reduce its debt (frees credit limit).
    function recordCompanyPayment(address company, uint256 amount, string calldata bankRef) external onlyOwner {
        Company storage c = companies[company];
        require(c.active, "Unknown company");
        require(amount > 0 && amount <= c.debt, "Invalid amount");
        c.debt -= amount;
        emit CompanyPaymentRecorded(company, amount, bankRef);
    }

    // ----------------------------------------------------------------- spending

    /// Employee pays a restaurant (the QR flow). `ref` identifies the bill.
    function pay(address restaurant, uint256 amount, bytes32 ref) external {
        require(employerOf[msg.sender] != address(0), "Not an employee");
        require(isRestaurant[restaurant], "Not a partner restaurant");
        require(amount > 0, "Amount must be positive");
        require(block.timestamp <= periodEnd, "Period ended");
        _transfer(msg.sender, restaurant, amount);
        emit MealPaid(msg.sender, restaurant, amount, ref);
    }

    /// Plain transfers are disabled: MEAL is not money and cannot be passed around.
    function transfer(address, uint256) public pure override returns (bool) {
        revert("Transfers disabled: use pay()");
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert("Transfers disabled: use pay()");
    }

    // ----------------------------------------------------------------- money out

    /// Restaurant hands MEAL back; tokens are burned and a bank payout is queued.
    function redeem(uint256 amount) external returns (uint256 id) {
        require(isRestaurant[msg.sender], "Not a partner restaurant");
        require(amount > 0, "Amount must be positive");
        _burn(msg.sender, amount);
        pendingPayouts += amount;
        id = redemptions.length;
        redemptions.push(Redemption({restaurant: msg.sender, amount: amount, paidOut: false, bankRef: ""}));
        emit RedemptionRequested(id, msg.sender, amount);
    }

    /// Issuer confirms the AZN bank transfer for a redemption. Only once.
    function confirmPayout(uint256 id, string calldata bankRef) external onlyOwner {
        require(id < redemptions.length, "Unknown redemption");
        Redemption storage r = redemptions[id];
        require(!r.paidOut, "Already paid out");
        r.paidOut = true;
        r.bankRef = bankRef;
        pendingPayouts -= r.amount;
        emit RedemptionPaidOut(id, r.restaurant, r.amount, bankRef);
    }

    // ----------------------------------------------------------------- period end

    /// Burns unused employee balances — allowed only after the period has ended.
    function expireBalances(address[] calldata employees) external onlyOwner {
        require(block.timestamp > periodEnd, "Period not over");
        for (uint256 i = 0; i < employees.length; i++) {
            require(employerOf[employees[i]] != address(0), "Not an employee");
            uint256 balance = balanceOf(employees[i]);
            if (balance > 0) {
                _burn(employees[i], balance);
                emit BalanceExpired(employees[i], balance);
            }
        }
    }

    function startNewPeriod(uint64 newPeriodEnd) external onlyOwner {
        require(block.timestamp > periodEnd, "Period not over");
        require(newPeriodEnd > block.timestamp, "Period end in the past");
        periodEnd = newPeriodEnd;
        emit PeriodStarted(newPeriodEnd);
    }

    // ----------------------------------------------------------------- views

    function redemptionCount() external view returns (uint256) {
        return redemptions.length;
    }

    /// What the issuer owes restaurants right now: MEAL in circulation + redeemed-but-unpaid.
    function totalLiability() external view returns (uint256) {
        return totalSupply() + pendingPayouts;
    }

    function _isParticipant(address a) private view returns (bool) {
        return employerOf[a] != address(0) || isRestaurant[a];
    }
}
