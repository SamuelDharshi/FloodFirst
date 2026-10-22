// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {Base} from "./Base.t.sol";
import {NullifierRegistry} from "../src/NullifierRegistry.sol";

/// Evidence for FEEDBACK.md. Real Semaphore v4.14.5 contracts and REAL Groth16 proofs (fixtures are deterministic TEST
/// identities). Fixture 0 = NGO A / household 1 / event 1, fixture 1 = NGO B / the SAME household / event 1.
contract SemaphoreGapTest is Base {
    /// The gap: with the scope fixed (= the event id), one identity enrolled in two groups yields ONE nullifier, but
    /// Semaphore stores nullifiers per group, so BOTH proofs are accepted: the same household is "counted" twice.
    function test_plainSemaphore_acceptsTheSameIdentityTwiceAcrossGroups() public {
        (ISemaphore.SemaphoreProof memory a,) = _proof(0);
        (ISemaphore.SemaphoreProof memory b,) = _proof(1);
        assertEq(a.nullifier, b.nullifier, "same identity + same scope => identical nullifier");
        assertEq(a.scope, b.scope);

        semaphore.validateProof(groupA, a); // accepted
        semaphore.validateProof(groupB, b); // ALSO accepted: the nullifier set is per group

        // Inside one group the protection works, which is why the gap is easy to miss.
        vm.expectRevert(ISemaphore.Semaphore__YouAreUsingTheSameNullifierTwice.selector);
        semaphore.validateProof(groupA, a);
    }

    /// The fix we built (NullifierRegistry): one nullifier set across every group.
    function test_registry_rejectsTheSecondGroup() public {
        _fund();
        _trigger(1);
        (ISemaphore.SemaphoreProof memory a,) = _proof(0);
        (ISemaphore.SemaphoreProof memory b,) = _proof(1);
        registry.claim(1, groupA, a);
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        registry.claim(1, groupB, b);
    }

    /// Cost of the shared guard (local EVM gas, same proof). Run with -vv to see the numbers.
    function test_gas_plainSemaphoreValidateProof() public {
        (ISemaphore.SemaphoreProof memory a,) = _proof(0);
        uint256 g = gasleft();
        semaphore.validateProof(groupA, a);
        console2.log("gas: Semaphore.validateProof (per-group nullifier)", g - gasleft());
    }

    function test_gas_registryClaim() public {
        _fund();
        _trigger(1);
        (ISemaphore.SemaphoreProof memory a,) = _proof(0);
        uint256 g = gasleft();
        registry.claim(1, groupA, a);
        console2.log("gas: NullifierRegistry.claim (global nullifier + voucher registration)", g - gasleft());
    }

    /// Verification alone (a view) costs the same either way: the extra cost of a global guard is storage only.
    function test_gas_verifyProofView() public {
        (ISemaphore.SemaphoreProof memory a,) = _proof(0);
        uint256 g = gasleft();
        assertTrue(semaphore.verifyProof(groupA, a));
        console2.log("gas: Semaphore.verifyProof (view)", g - gasleft());
    }
}
