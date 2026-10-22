// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVoucherIssuer, INullifierRegistry} from "./interfaces/IFloodFirst.sol";

/// @title Pool: donor pool that releases at most 30% of its balance per trigger event (PRD F1, F3).
/// @dev Pause stops releases only. Deposits stay open and expiry returns (a plain token transfer made
///      by the VoucherIssuer) can never be blocked.
contract Pool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_RELEASE_BPS = 3000; // 30%
    uint256 private constant BPS = 10_000;

    IERC20 public immutable token;
    IVoucherIssuer public immutable issuer;
    INullifierRegistry public registry;
    address public oracle;

    bool public paused;
    uint64 public voucherTtl; // seconds vouchers stay valid after release
    uint64 public minReleaseInterval; // seconds between releases (drain protection)
    uint64 public lastRelease;

    mapping(address => uint256) public donated; // total ever donated per donor
    uint256 public totalDonated;
    uint256 public totalReleased;

    event Deposited(address indexed donor, uint256 amount, uint256 donorTotal);
    event Released(uint256 indexed eventId, uint256 tranche, uint256 claimAmount, uint256 enrolled, uint64 expiry);
    event PausedSet(bool paused);
    event OracleSet(address oracle);
    event RegistrySet(address registry);
    event ParamsSet(uint64 voucherTtl, uint64 minReleaseInterval);

    error NotOracle();
    error IsPaused();
    error ZeroAmount();
    error AlreadySet();
    error ZeroAddress();
    error NoEnrollees();
    error TooSoon();
    error TrancheTooSmall();
    error NotConfigured();

    constructor(address owner_, IERC20 token_, IVoucherIssuer issuer_, uint64 voucherTtl_, uint64 minInterval_)
        Ownable(owner_)
    {
        token = token_;
        issuer = issuer_;
        voucherTtl = voucherTtl_;
        minReleaseInterval = minInterval_;
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle != address(0)) revert AlreadySet();
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(oracle_);
    }

    function setRegistry(INullifierRegistry registry_) external onlyOwner {
        if (address(registry) != address(0)) revert AlreadySet();
        if (address(registry_) == address(0)) revert ZeroAddress();
        registry = registry_;
        emit RegistrySet(address(registry_));
    }

    function setParams(uint64 voucherTtl_, uint64 minInterval_) external onlyOwner {
        voucherTtl = voucherTtl_;
        minReleaseInterval = minInterval_;
        emit ParamsSet(voucherTtl_, minInterval_);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Donate tokens. Caller must have approved this contract.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        donated[msg.sender] += received;
        totalDonated += received;
        emit Deposited(msg.sender, received, donated[msg.sender]);
    }

    function balance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Release one tranche (<=30% of current balance). Only the TriggerOracle may call.
    function release(uint256 eventId) external nonReentrant returns (uint256 tranche) {
        if (msg.sender != oracle) revert NotOracle();
        if (paused) revert IsPaused();
        if (address(registry) == address(0)) revert NotConfigured();
        if (lastRelease != 0 && block.timestamp < uint256(lastRelease) + minReleaseInterval) revert TooSoon();

        uint256 enrolled = registry.totalEnrolled();
        if (enrolled == 0) revert NoEnrollees();

        tranche = (balance() * MAX_RELEASE_BPS) / BPS;
        uint256 claimAmount = tranche / enrolled;
        if (claimAmount == 0) revert TrancheTooSmall();

        lastRelease = uint64(block.timestamp);
        totalReleased += tranche;
        uint64 expiry = uint64(block.timestamp) + voucherTtl;

        token.safeTransfer(address(issuer), tranche);
        issuer.openEvent(eventId, tranche, claimAmount, expiry);
        emit Released(eventId, tranche, claimAmount, enrolled, expiry);
    }
}
