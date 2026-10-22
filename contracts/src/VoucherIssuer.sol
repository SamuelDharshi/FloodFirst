// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VoucherIssuer: holds released tranches, registers claims, pays redemptions, returns expiry (F7-F9).
/// @dev A voucher is a bearer instrument: voucherId = keccak256(voucherSecret) >> 8. The household keeps
///      voucherSecret; only voucherId appears in the claim proof's message. Redeeming reveals the secret.
///      Merchant-side offline verification uses an off-chain signature by the voucher signer; payout on-chain
///      depends only on the registered voucherId, not on that signature.
contract VoucherIssuer is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct EventInfo {
        uint256 tranche;
        uint256 claimAmount;
        uint64 expiry;
        uint32 claimed;
        uint32 redeemed;
        bool expired;
    }

    struct Voucher {
        uint256 eventId;
        bool exists;
        bool redeemed;
    }

    IERC20 public immutable token;
    address public pool;
    address public registry;

    mapping(uint256 => EventInfo) public eventInfo;
    mapping(uint256 => Voucher) public vouchers;

    event EventOpened(uint256 indexed eventId, uint256 tranche, uint256 claimAmount, uint64 expiry);
    event VoucherRegistered(uint256 indexed eventId, uint256 indexed voucherId);
    event Redeemed(uint256 indexed eventId, uint256 indexed voucherId, address indexed to, uint256 amount);
    event Expired(uint256 indexed eventId, uint256 returnedToPool);

    error AlreadySet();
    error ZeroAddress();
    error NotPool();
    error NotRegistry();
    error EventExists();
    error EventNotOpen();
    error EventIsExpired();
    error NotYetExpired();
    error AlreadyExpired();
    error TrancheExhausted();
    error VoucherExists();
    error UnknownVoucher();
    error AlreadyRedeemed();

    constructor(address owner_, IERC20 token_) Ownable(owner_) {
        token = token_;
    }

    function setPool(address pool_) external onlyOwner {
        if (pool != address(0)) revert AlreadySet();
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
    }

    function setRegistry(address registry_) external onlyOwner {
        if (registry != address(0)) revert AlreadySet();
        if (registry_ == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    function voucherIdOf(bytes32 voucherSecret) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(voucherSecret))) >> 8;
    }

    function isOpen(uint256 eventId) public view returns (bool) {
        EventInfo storage e = eventInfo[eventId];
        return e.expiry != 0 && !e.expired && block.timestamp <= e.expiry;
    }

    function openEvent(uint256 eventId, uint256 tranche, uint256 claimAmount, uint64 expiry) external {
        if (msg.sender != pool) revert NotPool();
        if (eventInfo[eventId].expiry != 0) revert EventExists();
        eventInfo[eventId] = EventInfo(tranche, claimAmount, expiry, 0, 0, false);
        emit EventOpened(eventId, tranche, claimAmount, expiry);
    }

    function registerClaim(uint256 eventId, uint256 voucherId) external {
        if (msg.sender != registry) revert NotRegistry();
        EventInfo storage e = eventInfo[eventId];
        if (e.expiry == 0 || e.expired) revert EventNotOpen();
        if (block.timestamp > e.expiry) revert EventIsExpired();
        if (vouchers[voucherId].exists) revert VoucherExists();
        if ((uint256(e.claimed) + 1) * e.claimAmount > e.tranche) revert TrancheExhausted();
        e.claimed += 1;
        vouchers[voucherId] = Voucher(eventId, true, false);
        emit VoucherRegistered(eventId, voucherId);
    }

    /// @notice Pay a voucher to `to`. Reveals the voucher secret (bearer instrument).
    function redeem(bytes32 voucherSecret, address to) external nonReentrant {
        uint256 id = voucherIdOf(voucherSecret);
        Voucher storage v = vouchers[id];
        if (!v.exists) revert UnknownVoucher();
        if (v.redeemed) revert AlreadyRedeemed();
        EventInfo storage e = eventInfo[v.eventId];
        if (e.expired || block.timestamp > e.expiry) revert EventIsExpired();
        v.redeemed = true;
        e.redeemed += 1;
        token.safeTransfer(to, e.claimAmount);
        emit Redeemed(v.eventId, id, to, e.claimAmount);
    }

    /// @notice Anyone may return an expired event's unredeemed funds to the pool.
    function expire(uint256 eventId) external nonReentrant {
        EventInfo storage e = eventInfo[eventId];
        if (e.expiry == 0) revert EventNotOpen();
        if (e.expired) revert AlreadyExpired();
        if (block.timestamp <= e.expiry) revert NotYetExpired();
        e.expired = true;
        uint256 back = e.tranche - uint256(e.redeemed) * e.claimAmount;
        if (back > 0) token.safeTransfer(pool, back);
        emit Expired(eventId, back);
    }
}
