// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PaymentRequests {
    using SafeERC20 for IERC20;

    enum Status {
        Pending,
        Paid,
        Cancelled
    }

    struct Request {
        address creator;
        address payer;
        address token;
        uint256 amount;
        bytes32 referenceHash;
        uint64 dueDate; // unix seconds; 0 = no deadline
        Status status;
    }

    uint256 public nextRequestId;
    mapping(uint256 => Request) public requests;

    event PaymentRequested(
        uint256 indexed requestId,
        address indexed creator,
        address indexed payer,
        address token,
        uint256 amount,
        bytes32 referenceHash,
        uint64 dueDate
    );
    event PaymentCompleted(
        uint256 indexed requestId,
        address indexed payer,
        address indexed creator,
        address token,
        uint256 amount
    );
    event PaymentCancelled(uint256 indexed requestId, address indexed creator);

    function createRequest(
        address payer,
        address token,
        uint256 amount,
        bytes32 referenceHash,
        uint64 dueDate
    ) external returns (uint256 requestId) {
        require(payer != address(0), "Invalid payer");
        require(token != address(0), "Invalid token");
        require(payer != msg.sender, "Cannot request from yourself");
        require(amount > 0, "Amount must be positive");
        require(dueDate == 0 || dueDate > block.timestamp, "Due date in the past");

        requestId = nextRequestId++;
        requests[requestId] = Request({
            creator: msg.sender,
            payer: payer,
            token: token,
            amount: amount,
            referenceHash: referenceHash,
            dueDate: dueDate,
            status: Status.Pending
        });

        emit PaymentRequested(requestId, msg.sender, payer, token, amount, referenceHash, dueDate);
    }

    function payRequest(uint256 requestId) external {
        Request storage request = _pending(requestId);
        require(msg.sender == request.payer, "Not the requested payer");
        require(!isOverdue(requestId), "Request overdue");

        // Update state before the external token call (checks-effects-interactions).
        request.status = Status.Paid;
        IERC20(request.token).safeTransferFrom(msg.sender, request.creator, request.amount);

        emit PaymentCompleted(requestId, msg.sender, request.creator, request.token, request.amount);
    }

    function cancelRequest(uint256 requestId) external {
        Request storage request = _pending(requestId);
        require(msg.sender == request.creator, "Only the creator can cancel");

        request.status = Status.Cancelled;
        emit PaymentCancelled(requestId, msg.sender);
    }

    function isOverdue(uint256 requestId) public view returns (bool) {
        Request storage request = requests[requestId];
        return
            request.status == Status.Pending &&
            request.dueDate != 0 &&
            block.timestamp > request.dueDate;
    }

    function _pending(uint256 requestId) private view returns (Request storage request) {
        request = requests[requestId];
        require(request.creator != address(0), "Request not found");
        require(request.status != Status.Paid, "Request already paid");
        require(request.status != Status.Cancelled, "Request cancelled");
    }
}
