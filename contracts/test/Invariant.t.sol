// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Base} from "./Base.t.sol";
import {Pool} from "../src/Pool.sol";
import {VoucherIssuer} from "../src/VoucherIssuer.sol";
import {TestToken} from "../src/TestToken.sol";

/// Random sequence of donations, releases (as the oracle) and expiries. No claims, so no outflow to merchants:
/// tokens must be conserved between Pool and VoucherIssuer, and no release may exceed 30% of the pool balance.
contract Handler is Test {
    Pool public pool;
    VoucherIssuer public issuer;
    TestToken public token;
    address public oracle;
    uint256 public nextEvent = 1;
    uint256[] public openEvents;
    uint256 public maxReleaseBps; // highest observed tranche / balance-before, in bps
    uint256 public donated;

    constructor(Pool p, VoucherIssuer i, TestToken t, address o) {
        pool = p;
        issuer = i;
        token = t;
        oracle = o;
    }

    function deposit(uint96 amount) external {
        uint256 a = bound(amount, 1, 1e12);
        token.mint(address(this), a);
        token.approve(address(pool), a);
        pool.deposit(a);
        donated += a;
    }

    function release() external {
        uint256 bal = pool.balance();
        if (bal == 0) return;
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(oracle);
        try pool.release(nextEvent) returns (uint256 tranche) {
            uint256 bps = (tranche * 10_000) / bal;
            if (bps > maxReleaseBps) maxReleaseBps = bps;
            openEvents.push(nextEvent);
            nextEvent++;
        } catch {}
    }

    function expireOne(uint256 idx) external {
        if (openEvents.length == 0) return;
        uint256 id = openEvents[idx % openEvents.length];
        vm.warp(block.timestamp + 8 days);
        try issuer.expire(id) {} catch {}
    }
}

contract InvariantTest is StdInvariant, Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(pool, issuer, token, address(oracle));
        token.transferOwnership(address(handler)); // the handler mints test tokens to itself to donate
        targetContract(address(handler));
    }

    function afterInvariant() public view {
        // Guard against a vacuous run: the handler must actually have donated and released something.
        assertGt(handler.donated() + handler.nextEvent(), 1);
    }

    function invariant_tokensConserved() public view {
        assertEq(token.balanceOf(address(pool)) + token.balanceOf(address(issuer)), handler.donated());
    }

    function invariant_releaseNeverAbove30Percent() public view {
        assertLe(handler.maxReleaseBps(), 3000);
    }

    function invariant_voucherHoldingsNeverExceedDonations() public view {
        // Cumulative "released" can exceed donations (expired funds return and are re-released), but the amount
        // currently held for vouchers can never exceed what was donated.
        assertLe(token.balanceOf(address(issuer)), handler.donated());
    }
}
