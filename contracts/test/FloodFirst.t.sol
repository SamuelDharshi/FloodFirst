// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {Base} from "./Base.t.sol";
import {IVoucherIssuer, INullifierRegistry, IPool} from "../src/interfaces/IFloodFirst.sol";
import {Pool} from "../src/Pool.sol";
import {VoucherIssuer} from "../src/VoucherIssuer.sol";
import {NullifierRegistry} from "../src/NullifierRegistry.sol";
import {TriggerOracle} from "../src/TriggerOracle.sol";

// Fixture indexes: 0 = NGO A / H1 / event 1, 1 = NGO B / H1 / event 1, 2 = NGO A / H2 / event 1, 3 = NGO A / H1 / event 2
contract PoolTest is Base {
    function test_depositTracksPerDonorAndTotal() public {
        _fund();
        assertEq(pool.donated(donor1), 600e6);
        assertEq(pool.donated(donor2), 400e6);
        assertEq(pool.totalDonated(), 1000e6);
        assertEq(pool.balance(), 1000e6);
    }

    function test_depositZeroReverts() public {
        vm.prank(donor1);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.deposit(0);
    }

    function test_releaseOnlyOracle() public {
        _fund();
        vm.expectRevert(Pool.NotOracle.selector);
        pool.release(1);
    }

    function test_releaseCappedAt30Percent() public {
        _fund();
        _trigger(1);
        (uint256 tranche, uint256 claimAmount,,,,) = issuer.eventInfo(1);
        assertEq(tranche, 300e6);
        assertEq(claimAmount, 100e6); // 3 enrolled commitments across 2 NGOs
        assertEq(pool.balance(), 700e6);
        assertEq(token.balanceOf(address(issuer)), 300e6);
    }

    function testFuzz_releaseNeverExceeds30Percent(uint96 funding) public {
        funding = uint96(bound(funding, 10e6, 1e15));
        token.mint(donor1, funding);
        vm.startPrank(donor1);
        token.approve(address(pool), funding);
        pool.deposit(funding);
        vm.stopPrank();
        uint256 before = pool.balance();
        _trigger(1);
        (uint256 tranche,,,,,) = issuer.eventInfo(1);
        assertLe(tranche, (before * 3000) / 10_000);
        assertEq(pool.balance() + token.balanceOf(address(issuer)), before);
    }

    function test_secondReleaseTooSoon() public {
        _fund();
        _trigger(1);
        _triggerExpectRevert(Pool.TooSoon.selector, 2, FORECAST_THRESHOLD, GAUGE_THRESHOLD, gaugePk);
        vm.warp(block.timestamp + MIN_INTERVAL);
        _trigger(2);
        (uint256 tranche,,,,,) = issuer.eventInfo(2);
        assertEq(tranche, 210e6); // 30% of the remaining 700
    }

    function test_pausedBlocksReleaseButNotDeposit() public {
        _fund();
        pool.setPaused(true);
        _triggerExpectRevert(Pool.IsPaused.selector, 1, FORECAST_THRESHOLD, GAUGE_THRESHOLD, gaugePk);
        token.mint(donor1, 1e6);
        vm.startPrank(donor1);
        token.approve(address(pool), 1e6);
        pool.deposit(1e6);
        vm.stopPrank();
    }

    function test_onlyOwnerAdmin() public {
        vm.prank(donor1);
        vm.expectRevert();
        pool.setPaused(true);
        vm.expectRevert(Pool.AlreadySet.selector);
        pool.setOracle(address(1));
    }

    function test_noEnrolleesReverts() public {
        // fresh stack with no registered groups
        NullifierRegistry empty = new NullifierRegistry(address(this), registry.semaphore(), registry.issuer());
        Pool p2 = new Pool(address(this), token, IVoucherIssuer(address(issuer)), TTL, MIN_INTERVAL);
        p2.setRegistry(INullifierRegistry(address(empty)));
        p2.setOracle(address(this));
        vm.expectRevert(Pool.NoEnrollees.selector);
        p2.release(9);
    }
}

contract OracleTest is Base {
    function setUp() public override {
        super.setUp();
        _fund();
    }

    function test_triggerHappyPath() public {
        vm.expectEmit(true, false, false, true);
        emit TriggerOracle.Triggered(1, 300e6);
        _trigger(1);
        (TriggerOracle.Status st,) = oracle.triggers(1);
        assertEq(uint8(st), uint8(TriggerOracle.Status.Executed));
    }

    function test_forecastBelowThresholdReverts() public {
        _triggerExpectRevert(TriggerOracle.BelowThreshold.selector, 1, FORECAST_THRESHOLD - 1, GAUGE_THRESHOLD, gaugePk);
    }

    function test_gaugeBelowThresholdReverts() public {
        _triggerExpectRevert(TriggerOracle.BelowThreshold.selector, 1, FORECAST_THRESHOLD, GAUGE_THRESHOLD - 1, gaugePk);
    }

    function test_rogueGaugeSignerRejected() public {
        _triggerExpectRevert(TriggerOracle.BadGaugeSignature.selector, 1, FORECAST_THRESHOLD, GAUGE_THRESHOLD, rogue);
    }

    function test_forecastKeyCannotSignGaugeToo() public {
        // One key controlling both legs must not satisfy 2-of-2.
        _triggerExpectRevert(TriggerOracle.BadGaugeSignature.selector, 1, FORECAST_THRESHOLD, GAUGE_THRESHOLD, forecastPk);
    }

    function test_rogueForecastSignerRejected() public {
        TriggerOracle.Reading memory f = _reading(1, 200, 0, uint64(block.timestamp));
        TriggerOracle.Reading memory g = _reading(1, 200, 1, uint64(block.timestamp));
        bytes memory fs = _sign(rogue, f);
        bytes memory gs = _sign(gaugePk, g);
        vm.expectRevert(TriggerOracle.BadForecastSignature.selector);
        oracle.trigger(f, fs, g, gs);
    }

    function test_eventCannotBeReplayed() public {
        _trigger(1);
        vm.warp(block.timestamp + MIN_INTERVAL);
        _triggerExpectRevert(TriggerOracle.EventAlreadyUsed.selector, 1, FORECAST_THRESHOLD, GAUGE_THRESHOLD, gaugePk);
    }

    function test_staleReadingRejected() public {
        TriggerOracle.Reading memory f = _reading(1, 200, 0, uint64(block.timestamp - 2 days));
        TriggerOracle.Reading memory g = _reading(1, 200, 1, uint64(block.timestamp));
        bytes memory fs = _sign(forecastPk, f);
        bytes memory gs = _sign(gaugePk, g);
        vm.expectRevert(TriggerOracle.StaleOrFutureReading.selector);
        oracle.trigger(f, fs, g, gs);
    }

    function test_eventIdMismatchAndWrongBasin() public {
        TriggerOracle.Reading memory f = _reading(1, 200, 0, uint64(block.timestamp));
        TriggerOracle.Reading memory g = _reading(2, 200, 1, uint64(block.timestamp));
        bytes memory fs = _sign(forecastPk, f);
        bytes memory gs = _sign(gaugePk, g);
        vm.expectRevert(TriggerOracle.EventIdMismatch.selector);
        oracle.trigger(f, fs, g, gs);

        g = _reading(1, 200, 1, uint64(block.timestamp));
        g.basin = keccak256("other");
        gs = _sign(gaugePk, g);
        vm.expectRevert(TriggerOracle.WrongBasin.selector);
        oracle.trigger(f, fs, g, gs);
    }

    function test_wrongKindRejected() public {
        TriggerOracle.Reading memory f = _reading(1, 200, 1, uint64(block.timestamp));
        TriggerOracle.Reading memory g = _reading(1, 200, 0, uint64(block.timestamp));
        bytes memory fs = _sign(forecastPk, f);
        bytes memory gs = _sign(gaugePk, g);
        vm.expectRevert(TriggerOracle.WrongKind.selector);
        oracle.trigger(f, fs, g, gs);
    }

    function test_fallbackOperatorEmitsPublicEvent() public {
        vm.expectEmit(true, true, false, true);
        emit TriggerOracle.FallbackUsed(1, vm.addr(fallbackPk), GAUGE_THRESHOLD);
        _triggerWith(1, FORECAST_THRESHOLD, GAUGE_THRESHOLD, fallbackPk);
    }

    function test_vetoWindowAndReporterVeto() public {
        oracle.setThresholds(FORECAST_THRESHOLD, GAUGE_THRESHOLD, 1 days, 1 hours);
        _trigger(1);
        (TriggerOracle.Status st,) = oracle.triggers(1);
        assertEq(uint8(st), uint8(TriggerOracle.Status.Pending));
        assertEq(pool.balance(), 1000e6); // nothing released yet

        vm.expectRevert(TriggerOracle.VetoWindowOpen.selector);
        oracle.execute(1);
        vm.expectRevert(TriggerOracle.NotReporter.selector);
        oracle.veto(1);

        vm.prank(reporter);
        oracle.veto(1);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(TriggerOracle.NotPending.selector);
        oracle.execute(1);
        assertEq(pool.balance(), 1000e6);
    }

    function test_executeAfterWindowWithoutVeto() public {
        oracle.setThresholds(FORECAST_THRESHOLD, GAUGE_THRESHOLD, 1 days, 1 hours);
        _trigger(1);
        vm.warp(block.timestamp + 1 hours);
        oracle.execute(1);
        assertEq(pool.balance(), 700e6);
    }

    function test_zeroRequiredAttesterRejected() public {
        vm.expectRevert(TriggerOracle.ZeroAttester.selector);
        oracle.setConfig(address(0), vm.addr(gaugePk), address(0), address(0));
        vm.expectRevert(TriggerOracle.ZeroAttester.selector);
        new TriggerOracle(address(this), IPool(address(pool)), BASIN, vm.addr(forecastPk), address(0), address(0), address(0));
    }

    function test_reporterCannotTriggerAlone() public {
        vm.prank(reporter);
        vm.expectRevert(TriggerOracle.NotPending.selector);
        oracle.veto(5);
        vm.expectRevert(TriggerOracle.NotPending.selector);
        oracle.execute(5);
    }
}

contract ClaimTest is Base {
    function setUp() public override {
        super.setUp();
        _fund();
        _trigger(1);
    }

    function _claim(uint256 groupId, uint256 idx) internal returns (bytes32 secret) {
        ISemaphore.SemaphoreProof memory p;
        (p, secret) = _proof(idx);
        registry.claim(p.scope, groupId, p); // callable by any relayer
    }

    function test_realProofClaimRegistersVoucher() public {
        bytes32 secret = _claim(groupA, 0);
        uint256 id = issuer.voucherIdOf(secret);
        (uint256 ev, bool exists, bool redeemed) = issuer.vouchers(id);
        assertEq(ev, 1);
        assertTrue(exists);
        assertFalse(redeemed);
        assertEq(registry.totalClaims(), 1);
    }

    function test_sameHouseholdBlockedAcrossNgos() public {
        _claim(groupA, 0);
        // NGO B enrolled the same household secret; the nullifier is identical so the registry rejects it.
        (ISemaphore.SemaphoreProof memory p,) = _proof(1);
        (ISemaphore.SemaphoreProof memory pa,) = _proof(0);
        assertEq(p.nullifier, pa.nullifier, "same household must give same nullifier across NGOs");
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        registry.claim(1, groupB, p);
    }

    function test_differentHouseholdCanClaim() public {
        _claim(groupA, 0);
        _claim(groupA, 2);
        assertEq(registry.totalClaims(), 2);
    }

    function test_sameProofCannotBeReplayed() public {
        _claim(groupA, 0);
        (ISemaphore.SemaphoreProof memory p,) = _proof(0);
        vm.expectRevert(NullifierRegistry.NullifierAlreadyUsed.selector);
        registry.claim(1, groupA, p);
    }

    function test_sameHouseholdCanClaimNextEvent() public {
        _claim(groupA, 0);
        vm.warp(block.timestamp + MIN_INTERVAL);
        _trigger(2);
        _claim(groupA, 3);
        assertEq(registry.totalClaims(), 2);
    }

    function test_wrongScopeRejected() public {
        (ISemaphore.SemaphoreProof memory p,) = _proof(0);
        vm.expectRevert(NullifierRegistry.WrongScope.selector);
        registry.claim(2, groupA, p);
    }

    function test_unregisteredGroupRejected() public {
        (ISemaphore.SemaphoreProof memory p,) = _proof(0);
        vm.expectRevert(NullifierRegistry.GroupNotRegistered.selector);
        registry.claim(1, 12345, p);
    }

    function test_proofAgainstWrongGroupRejected() public {
        // proof 2 is H2 from group A; group B does not contain H2
        (ISemaphore.SemaphoreProof memory p,) = _proof(2);
        vm.expectRevert();
        registry.claim(1, groupB, p);
    }

    function test_tamperedMessageRejected() public {
        (ISemaphore.SemaphoreProof memory p,) = _proof(0);
        p.message = p.message ^ 1; // attacker swapping the voucher id
        vm.expectRevert();
        registry.claim(1, groupA, p);
    }

    function test_tamperedNullifierRejected() public {
        (ISemaphore.SemaphoreProof memory p,) = _proof(0);
        p.nullifier = p.nullifier + 1; // forging a fresh nullifier to claim twice
        vm.expectRevert();
        registry.claim(1, groupA, p);
    }

    function test_claimBeforeEventOpenRejected() public {
        (ISemaphore.SemaphoreProof memory p,) = _proof(3); // scope 2, not triggered yet
        vm.expectRevert(NullifierRegistry.EventNotOpen.selector);
        registry.claim(2, groupA, p);
    }

    function test_claimAfterExpiryRejected() public {
        vm.warp(block.timestamp + TTL + 1);
        (ISemaphore.SemaphoreProof memory p,) = _proof(0);
        vm.expectRevert(NullifierRegistry.EventNotOpen.selector);
        registry.claim(1, groupA, p);
    }

    function test_groupCountIsBounded() public {
        for (uint256 i = 2; i < registry.MAX_GROUPS(); ++i) {
            registry.registerNgoGroup(1000 + i, ngoA);
        }
        vm.expectRevert(NullifierRegistry.TooManyGroups.selector);
        registry.registerNgoGroup(999_999, ngoA);
    }

    function test_onlyOwnerRegistersGroups() public {
        vm.prank(donor1);
        vm.expectRevert();
        registry.registerNgoGroup(99, donor1);
        vm.expectRevert(NullifierRegistry.GroupAlreadyRegistered.selector);
        registry.registerNgoGroup(groupA, ngoA);
    }
}

contract RedeemExpireTest is Base {
    function setUp() public override {
        super.setUp();
        _fund();
        _trigger(1);
    }

    function _claim(uint256 groupId, uint256 idx) internal returns (bytes32 secret) {
        ISemaphore.SemaphoreProof memory p;
        (p, secret) = _proof(idx);
        registry.claim(p.scope, groupId, p);
    }

    function test_redeemPaysClaimAmountOnce() public {
        bytes32 secret = _claim(groupA, 0);
        issuer.redeem(secret, merchant);
        assertEq(token.balanceOf(merchant), 100e6);
        vm.expectRevert(VoucherIssuer.AlreadyRedeemed.selector);
        issuer.redeem(secret, merchant);
    }

    function test_unknownVoucherRejected() public {
        vm.expectRevert(VoucherIssuer.UnknownVoucher.selector);
        issuer.redeem(bytes32(uint256(777)), merchant);
    }

    function test_redeemAfterExpiryRejected() public {
        bytes32 secret = _claim(groupA, 0);
        vm.warp(block.timestamp + TTL + 1);
        vm.expectRevert(VoucherIssuer.EventIsExpired.selector);
        issuer.redeem(secret, merchant);
    }

    function test_expiryReturnsUnredeemedToPool() public {
        bytes32 s0 = _claim(groupA, 0);
        _claim(groupA, 2); // claimed, never redeemed
        issuer.redeem(s0, merchant); // 100 paid out
        vm.expectRevert(VoucherIssuer.NotYetExpired.selector);
        issuer.expire(1);
        vm.warp(block.timestamp + TTL + 1);
        uint256 poolBefore = pool.balance();
        issuer.expire(1);
        assertEq(pool.balance() - poolBefore, 200e6); // 300 tranche - 100 redeemed
        assertEq(token.balanceOf(address(issuer)), 0);
        vm.expectRevert(VoucherIssuer.AlreadyExpired.selector);
        issuer.expire(1);
    }

    function test_falseAlarmCostIsOnlyRedeemedAmount() public {
        // Nobody claims: the whole tranche returns; cost of a false positive is zero tokens spent.
        vm.warp(block.timestamp + TTL + 1);
        issuer.expire(1);
        assertEq(pool.balance(), 1000e6);
    }

    function test_conservation() public {
        bytes32 s0 = _claim(groupA, 0);
        issuer.redeem(s0, merchant);
        vm.warp(block.timestamp + TTL + 1);
        issuer.expire(1);
        assertEq(pool.balance() + token.balanceOf(merchant) + token.balanceOf(address(issuer)), 1000e6);
    }

    function test_accessControl() public {
        vm.expectRevert(VoucherIssuer.NotPool.selector);
        issuer.openEvent(5, 1, 1, 1);
        vm.expectRevert(VoucherIssuer.NotRegistry.selector);
        issuer.registerClaim(1, 5);
    }
}
