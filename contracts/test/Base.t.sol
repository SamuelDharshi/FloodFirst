// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import {TestToken} from "../src/TestToken.sol";
import {Pool} from "../src/Pool.sol";
import {VoucherIssuer} from "../src/VoucherIssuer.sol";
import {NullifierRegistry} from "../src/NullifierRegistry.sol";
import {TriggerOracle} from "../src/TriggerOracle.sol";
import {IVoucherIssuer, IPool, INullifierRegistry} from "../src/interfaces/IFloodFirst.sol";

/// Shared deployment for tests. Uses the REAL Semaphore v4 contracts and verifier on a LOCAL test chain.
/// Proof fixtures come from test/fixtures/proofs.json (real Groth16 proofs over deterministic TEST identities).
abstract contract Base is Test {
    bytes32 constant BASIN = keccak256("brahmaputra-test-basin");
    uint256 constant FORECAST_THRESHOLD = 100;
    uint256 constant GAUGE_THRESHOLD = 50;
    uint64 constant TTL = 7 days;
    uint64 constant MIN_INTERVAL = 1 days;

    uint256 forecastPk = 0xF0;
    uint256 gaugePk = 0xA0;
    uint256 fallbackPk = 0xFB;
    uint256 rogue = 0xBAD;
    address reporter = address(0x4E9);
    address donor1 = address(0xD1);
    address donor2 = address(0xD2);
    address ngoA = address(0xA1);
    address ngoB = address(0xB1);
    address merchant = address(0x3E4C);

    TestToken token;
    Pool pool;
    VoucherIssuer issuer;
    NullifierRegistry registry;
    TriggerOracle oracle;
    Semaphore semaphore;
    uint256 groupA;
    uint256 groupB;
    string fixtureJson;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        semaphore = new Semaphore(ISemaphoreVerifier(address(new SemaphoreVerifier())));
        token = new TestToken(address(this));
        issuer = new VoucherIssuer(address(this), token);
        pool = new Pool(address(this), token, IVoucherIssuer(address(issuer)), TTL, MIN_INTERVAL);
        registry = new NullifierRegistry(address(this), ISemaphore(address(semaphore)), IVoucherIssuer(address(issuer)));
        oracle = new TriggerOracle(
            address(this), IPool(address(pool)), BASIN, vm.addr(forecastPk), vm.addr(gaugePk), vm.addr(fallbackPk), reporter
        );
        oracle.setThresholds(FORECAST_THRESHOLD, GAUGE_THRESHOLD, 1 days, 0);
        issuer.setPool(address(pool));
        issuer.setRegistry(address(registry));
        pool.setOracle(address(oracle));
        pool.setRegistry(INullifierRegistry(address(registry)));

        fixtureJson = vm.readFile("test/fixtures/proofs.json");
        uint256 h1 = vm.parseJsonUint(fixtureJson, ".commitments.h1");
        uint256 h2 = vm.parseJsonUint(fixtureJson, ".commitments.h2");

        // Each NGO creates and administers its own Semaphore group; neither sees the other's members.
        vm.prank(ngoA);
        groupA = semaphore.createGroup();
        vm.prank(ngoB);
        groupB = semaphore.createGroup();
        vm.startPrank(ngoA);
        semaphore.addMember(groupA, h1);
        semaphore.addMember(groupA, h2);
        vm.stopPrank();
        vm.prank(ngoB);
        semaphore.addMember(groupB, h1); // the same household, enrolled by a second NGO

        registry.registerNgoGroup(groupA, ngoA);
        registry.registerNgoGroup(groupB, ngoB);

        token.mint(donor1, 600e6);
        token.mint(donor2, 400e6);
    }

    function _fund() internal {
        vm.startPrank(donor1);
        token.approve(address(pool), 600e6);
        pool.deposit(600e6);
        vm.stopPrank();
        vm.startPrank(donor2);
        token.approve(address(pool), 400e6);
        pool.deposit(400e6);
        vm.stopPrank();
    }

    function _reading(uint256 eventId, uint256 value, uint8 kind, uint64 at)
        internal
        pure
        returns (TriggerOracle.Reading memory)
    {
        return TriggerOracle.Reading(BASIN, eventId, value, at, kind);
    }

    function _sign(uint256 pk, TriggerOracle.Reading memory r) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, oracle.hashReading(r));
        return abi.encodePacked(rr, s, v);
    }

    function _trigger(uint256 eventId) internal {
        _triggerWith(eventId, FORECAST_THRESHOLD, GAUGE_THRESHOLD, gaugePk);
    }

    function _triggerWith(uint256 eventId, uint256 fv, uint256 gv, uint256 gaugeSignerPk) internal {
        TriggerOracle.Reading memory f = _reading(eventId, fv, 0, uint64(block.timestamp));
        TriggerOracle.Reading memory g = _reading(eventId, gv, 1, uint64(block.timestamp));
        oracle.trigger(f, _sign(forecastPk, f), g, _sign(gaugeSignerPk, g));
    }

    function _triggerExpectRevert(bytes4 sel, uint256 eventId, uint256 fv, uint256 gv, uint256 gaugeSignerPk) internal {
        TriggerOracle.Reading memory f = _reading(eventId, fv, 0, uint64(block.timestamp));
        TriggerOracle.Reading memory g = _reading(eventId, gv, 1, uint64(block.timestamp));
        bytes memory fs = _sign(forecastPk, f);
        bytes memory gs = _sign(gaugeSignerPk, g);
        vm.expectRevert(sel);
        oracle.trigger(f, fs, g, gs);
    }

    function _proof(uint256 idx) internal view returns (ISemaphore.SemaphoreProof memory p, bytes32 secret) {
        string memory base = string.concat(".proofs[", vm.toString(idx), "]");
        p.merkleTreeDepth = vm.parseJsonUint(fixtureJson, string.concat(base, ".proof.merkleTreeDepth"));
        p.merkleTreeRoot = vm.parseJsonUint(fixtureJson, string.concat(base, ".proof.merkleTreeRoot"));
        p.nullifier = vm.parseJsonUint(fixtureJson, string.concat(base, ".proof.nullifier"));
        p.message = vm.parseJsonUint(fixtureJson, string.concat(base, ".proof.message"));
        p.scope = vm.parseJsonUint(fixtureJson, string.concat(base, ".proof.scope"));
        uint256[] memory pts = vm.parseJsonUintArray(fixtureJson, string.concat(base, ".proof.points"));
        for (uint256 i; i < 8; ++i) {
            p.points[i] = pts[i];
        }
        secret = vm.parseJsonBytes32(fixtureJson, string.concat(base, ".voucherSecret"));
    }
}
