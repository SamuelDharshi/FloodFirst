// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
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

abstract contract DeployBase is Script {
    function _deployAll(uint256 pk, address semaphore, uint64 voucherTtl, uint64 minInterval) internal {
        address owner = vm.addr(pk);
        TestToken token = new TestToken(owner);
        VoucherIssuer issuer = new VoucherIssuer(owner, token);
        Pool pool = new Pool(owner, token, IVoucherIssuer(address(issuer)), voucherTtl, minInterval);
        NullifierRegistry registry =
            new NullifierRegistry(owner, ISemaphore(semaphore), IVoucherIssuer(address(issuer)));
        bytes32 basin = keccak256(bytes(vm.envString("BASIN_NAME")));
        TriggerOracle oracle = new TriggerOracle(
            owner,
            IPool(address(pool)),
            basin,
            vm.envAddress("FORECAST_ATTESTER"),
            vm.envAddress("GAUGE_ATTESTER"),
            vm.envAddress("FALLBACK_ATTESTER"),
            vm.envAddress("REPORTER")
        );
        oracle.setThresholds(
            vm.envUint("FORECAST_THRESHOLD"), vm.envUint("GAUGE_THRESHOLD"), uint64(vm.envOr("MAX_READING_AGE_SEC", uint256(86400))), uint64(vm.envOr("VETO_WINDOW_SEC", uint256(0)))
        );
        issuer.setPool(address(pool));
        issuer.setRegistry(address(registry));
        pool.setOracle(address(oracle));
        pool.setRegistry(INullifierRegistry(address(registry)));

        console2.log("chainid", block.chainid);
        console2.log("Semaphore", semaphore);
        console2.log("TestToken", address(token));
        console2.log("VoucherIssuer", address(issuer));
        console2.log("Pool", address(pool));
        console2.log("NullifierRegistry", address(registry));
        console2.log("TriggerOracle", address(oracle));

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeAddress(k, "semaphore", semaphore);
        vm.serializeAddress(k, "token", address(token));
        vm.serializeAddress(k, "issuer", address(issuer));
        vm.serializeAddress(k, "pool", address(pool));
        vm.serializeAddress(k, "registry", address(registry));
        vm.serializeBytes32(k, "basin", basin);
        string memory out = vm.serializeAddress(k, "oracle", address(oracle));
        vm.writeJson(out, string.concat(vm.envOr("DEPLOYMENT_OUT_DIR", string("../deployments")), "/", vm.toString(block.chainid), ".json"));
    }
}

/// Public TESTNET deployment against an existing Semaphore v4. Refuses to run unless the chain id matches
/// EXPECTED_CHAIN_ID, refuses well-known mainnets, and requires the Semaphore address to have code.
/// Required env: DEPLOYER_PRIVATE_KEY, EXPECTED_CHAIN_ID, SEMAPHORE_ADDRESS, BASIN_NAME, FORECAST_ATTESTER,
/// GAUGE_ATTESTER, FALLBACK_ATTESTER, REPORTER, FORECAST_THRESHOLD, GAUGE_THRESHOLD.
/// Run: forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
contract Deploy is DeployBase {
    function run() external {
        require(block.chainid == vm.envUint("EXPECTED_CHAIN_ID"), "unexpected chain id");
        require(
            block.chainid != 1 && block.chainid != 8453 && block.chainid != 10 && block.chainid != 42161
                && block.chainid != 137,
            "mainnet deploy forbidden"
        );
        address semaphore = vm.envAddress("SEMAPHORE_ADDRESS");
        require(semaphore.code.length > 0, "Semaphore has no code on this chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        _deployAll(pk, semaphore, 7 days, 1 days);
        vm.stopBroadcast();
    }
}

/// LOCAL development/testing ONLY (anvil, chain id 31337): also deploys the real Semaphore v4 contracts.
contract DeployLocal is DeployBase {
    function run() external {
        require(block.chainid == 31337, "DeployLocal is for the local anvil chain only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        Semaphore s = new Semaphore(ISemaphoreVerifier(address(new SemaphoreVerifier())));
        _deployAll(pk, address(s), uint64(vm.envOr("VOUCHER_TTL_SEC", uint256(7 days))), uint64(vm.envOr("MIN_RELEASE_INTERVAL_SEC", uint256(1 days))));
        vm.stopBroadcast();
    }
}
