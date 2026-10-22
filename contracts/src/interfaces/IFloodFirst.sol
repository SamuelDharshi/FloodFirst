// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IVoucherIssuer {
    function openEvent(uint256 eventId, uint256 tranche, uint256 claimAmount, uint64 expiry) external;
    function registerClaim(uint256 eventId, uint256 voucherId) external;
    function isOpen(uint256 eventId) external view returns (bool);
}

interface IPool {
    function release(uint256 eventId) external returns (uint256 tranche);
}

interface INullifierRegistry {
    function totalEnrolled() external view returns (uint256);
}
