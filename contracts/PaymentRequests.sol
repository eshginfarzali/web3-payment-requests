// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PaymentRequests {
    using SafeERC20 for IERC20;

    struct Request {
        address creator;
        address payer;
        address token;
        uint256 amount;
        bytes32 referenceHash;
        bool paid;
    }

    uint256 public nextRequestId;
    mapping(uint256 => Request) public requests;

    event PaymentRequested(
        uint256 indexed requestId,
        address indexed creator,
        address indexed payer,
        address token,
        uint256 amount,
        bytes32 referenceHash
    );
    event PaymentCompleted(
        uint256 indexed requestId,
        address indexed payer,
        address indexed creator,
        address token,
        uint256 amount
    );

    function createRequest(
        address payer,
        address token,
        uint256 amount,
        bytes32 referenceHash
    ) external returns (uint256 requestId) {
        require(payer != address(0), "Invalid payer");
        require(token != address(0), "Invalid token");
        require(payer != msg.sender, "Cannot request from yourself");
        require(amount > 0, "Amount must be positive");

        requestId = nextRequestId++;
        requests[requestId] = Request({
            creator: msg.sender,
            payer: payer,
            token: token,
            amount: amount,
            referenceHash: referenceHash,
            paid: false
        });

        emit PaymentRequested(requestId, msg.sender, payer, token, amount, referenceHash);
    }

    function payRequest(uint256 requestId) external {
        Request storage request = requests[requestId];
        require(request.creator != address(0), "Request not found");
        require(!request.paid, "Request already paid");
        require(msg.sender == request.payer, "Not the requested payer");

        request.paid = true;
        IERC20(request.token).safeTransferFrom(msg.sender, request.creator, request.amount);

        emit PaymentCompleted(
            requestId,
            msg.sender,
            request.creator,
            request.token,
            request.amount
        );
    }
}
