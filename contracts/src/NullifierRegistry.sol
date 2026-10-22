// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {IVoucherIssuer} from "./interfaces/IFloodFirst.sol";

interface ISemaphoreGroupSize {
    function getMerkleTreeSize(uint256 groupId) external view returns (uint256);
}

/// @title NullifierRegistry: cross-NGO double-claim prevention (PRD F4, F5, section 5.2).
/// @notice Each participating NGO owns a Semaphore v4 group (its own Merkle root of household
///         commitments). A claim is a Semaphore zero-knowledge proof with scope = eventId. The
///         Semaphore nullifier is derived inside the circuit from the household secret and the scope, so
///         the same household yields the same nullifier whichever NGO enrolled it. This registry records
///         nullifiers GLOBALLY across all NGO groups and rejects a repeat. It sees only roots, nullifiers
///         and voucher ids, never beneficiary lists.
/// @dev Known limit (PRD 5.2): a household that enrolls two different secrets cannot be detected.
contract NullifierRegistry is Ownable {
    /// @dev Bounds the loop in totalEnrolled(), which Pool.release() calls.
    uint256 public constant MAX_GROUPS = 64;

    ISemaphore public immutable semaphore;
    IVoucherIssuer public immutable issuer;

    uint256[] public groups;
    mapping(uint256 => bool) public isNgoGroup;
    mapping(uint256 => address) public ngoOf;
    mapping(uint256 => bool) public nullifierUsed;
    uint256 public totalClaims;

    event NgoGroupRegistered(uint256 indexed groupId, address indexed ngo);
    event Claimed(uint256 indexed eventId, uint256 indexed groupId, uint256 nullifier, uint256 voucherId);

    error GroupNotRegistered();
    error GroupAlreadyRegistered();
    error WrongScope();
    error NullifierAlreadyUsed();
    error EventNotOpen();
    error InvalidProof();
    error ZeroAddress();
    error TooManyGroups();

    constructor(address owner_, ISemaphore semaphore_, IVoucherIssuer issuer_) Ownable(owner_) {
        if (address(semaphore_) == address(0) || address(issuer_) == address(0)) revert ZeroAddress();
        semaphore = semaphore_;
        issuer = issuer_;
    }

    /// @notice Owner admits an NGO's existing Semaphore group. The NGO administers membership itself
    ///         on the Semaphore contract.
    function registerNgoGroup(uint256 groupId, address ngo) external onlyOwner {
        if (isNgoGroup[groupId]) revert GroupAlreadyRegistered();
        if (groups.length >= MAX_GROUPS) revert TooManyGroups();
        isNgoGroup[groupId] = true;
        ngoOf[groupId] = ngo;
        groups.push(groupId);
        emit NgoGroupRegistered(groupId, ngo);
    }

    function groupCount() external view returns (uint256) {
        return groups.length;
    }

    /// @notice Total commitments across all registered NGO groups (used to size per-claim amount).
    function totalEnrolled() external view returns (uint256 total) {
        uint256 n = groups.length;
        for (uint256 i; i < n; ++i) {
            total += ISemaphoreGroupSize(address(semaphore)).getMerkleTreeSize(groups[i]);
        }
    }

    /// @notice Claim a voucher. proof.scope must equal eventId; proof.message is the voucherId the
    ///         household derived from its private voucherSecret. Callable by anyone (relayer) because
    ///         the proof, not msg.sender, authorises the claim.
    function claim(uint256 eventId, uint256 groupId, ISemaphore.SemaphoreProof calldata proof) external {
        if (!isNgoGroup[groupId]) revert GroupNotRegistered();
        if (proof.scope != eventId) revert WrongScope();
        if (nullifierUsed[proof.nullifier]) revert NullifierAlreadyUsed();
        if (!issuer.isOpen(eventId)) revert EventNotOpen();
        if (!semaphore.verifyProof(groupId, proof)) revert InvalidProof();

        nullifierUsed[proof.nullifier] = true;
        totalClaims += 1;
        issuer.registerClaim(eventId, proof.message);
        emit Claimed(eventId, groupId, proof.nullifier, proof.message);
    }
}
