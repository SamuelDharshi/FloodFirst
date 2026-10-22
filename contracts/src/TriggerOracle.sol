// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPool} from "./interfaces/IFloodFirst.sol";

/// @title TriggerOracle: 2-of-2 flood trigger (PRD F2, F11, F13).
/// @notice A release requires two independent EIP-712 attestations for the same basin and event id:
///         (a) a forecast reading signed by the forecast attester, and (b) a river-gauge reading signed
///         by the gauge attester (or, when the gauge is down, the designated fallback operator; that
///         use is emitted publicly as FallbackUsed). Both readings must meet their on-chain thresholds.
///         A community reporter may veto during the optional veto window; it can never trigger.
/// @dev Trust: both attesters are off-chain services; collusion of both is possible (PRD section 12).
///      The 30% pool cap bounds the loss per event.
contract TriggerOracle is Ownable, EIP712 {
    struct Reading {
        bytes32 basin;
        uint256 eventId;
        uint256 value;
        uint64 observedAt;
        uint8 kind; // 0 = forecast, 1 = gauge
    }

    bytes32 public constant READING_TYPEHASH =
        keccak256("Reading(bytes32 basin,uint256 eventId,uint256 value,uint64 observedAt,uint8 kind)");

    IPool public immutable pool;
    bytes32 public immutable basin;

    address public forecastAttester;
    address public gaugeAttester;
    address public fallbackAttester; // optional human operator when the gauge is unavailable
    address public reporter; // community reporter: veto only

    uint256 public forecastThreshold;
    uint256 public gaugeThreshold;
    uint64 public maxReadingAge;
    uint64 public vetoWindow;

    enum Status {
        None,
        Pending,
        Executed,
        Vetoed
    }

    struct Trigger {
        Status status;
        uint64 executeAfter;
    }

    mapping(uint256 => Trigger) public triggers;

    event TriggerPending(
        uint256 indexed eventId, uint256 forecastValue, uint256 gaugeValue, uint64 forecastAt, uint64 gaugeAt, uint64 executeAfter
    );
    event Triggered(uint256 indexed eventId, uint256 tranche);
    event FallbackUsed(uint256 indexed eventId, address indexed operator, uint256 gaugeValue);
    event Vetoed(uint256 indexed eventId, address indexed reporter);
    event ConfigSet(address forecastAttester, address gaugeAttester, address fallbackAttester, address reporter);
    event ThresholdsSet(uint256 forecastThreshold, uint256 gaugeThreshold, uint64 maxReadingAge, uint64 vetoWindow);

    error WrongBasin();
    error EventIdMismatch();
    error EventAlreadyUsed();
    error StaleOrFutureReading();
    error BelowThreshold();
    error WrongKind();
    error BadForecastSignature();
    error BadGaugeSignature();
    error NotReporter();
    error NotPending();
    error VetoWindowOpen();
    error ZeroAttester();

    constructor(
        address owner_,
        IPool pool_,
        bytes32 basin_,
        address forecastAttester_,
        address gaugeAttester_,
        address fallbackAttester_,
        address reporter_
    ) Ownable(owner_) EIP712("FloodFirstTriggerOracle", "1") {
        if (forecastAttester_ == address(0) || gaugeAttester_ == address(0)) revert ZeroAttester();
        pool = pool_;
        basin = basin_;
        forecastAttester = forecastAttester_;
        gaugeAttester = gaugeAttester_;
        fallbackAttester = fallbackAttester_;
        reporter = reporter_;
        emit ConfigSet(forecastAttester_, gaugeAttester_, fallbackAttester_, reporter_);
    }

    function setConfig(address f, address g, address fb, address rep) external onlyOwner {
        if (f == address(0) || g == address(0)) revert ZeroAttester();
        forecastAttester = f;
        gaugeAttester = g;
        fallbackAttester = fb;
        reporter = rep;
        emit ConfigSet(f, g, fb, rep);
    }

    function setThresholds(uint256 f, uint256 g, uint64 maxAge, uint64 vetoWin) external onlyOwner {
        forecastThreshold = f;
        gaugeThreshold = g;
        maxReadingAge = maxAge;
        vetoWindow = vetoWin;
        emit ThresholdsSet(f, g, maxAge, vetoWin);
    }

    function hashReading(Reading calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(READING_TYPEHASH, r.basin, r.eventId, r.value, r.observedAt, r.kind))
        );
    }

    /// @notice Submit both attested readings. Anyone may submit; the signatures authorise.
    function trigger(Reading calldata f, bytes calldata fSig, Reading calldata g, bytes calldata gSig) external {
        if (f.basin != basin || g.basin != basin) revert WrongBasin();
        if (f.eventId != g.eventId) revert EventIdMismatch();
        if (f.kind != 0 || g.kind != 1) revert WrongKind();
        uint256 eventId = f.eventId;
        if (triggers[eventId].status != Status.None) revert EventAlreadyUsed();
        _checkFresh(f.observedAt);
        _checkFresh(g.observedAt);
        if (f.value < forecastThreshold || g.value < gaugeThreshold) revert BelowThreshold();

        if (ECDSA.recover(hashReading(f), fSig) != forecastAttester) revert BadForecastSignature();
        address gSigner = ECDSA.recover(hashReading(g), gSig);
        bool viaFallback = gSigner == fallbackAttester && fallbackAttester != address(0);
        if (gSigner != gaugeAttester && !viaFallback) revert BadGaugeSignature();
        if (viaFallback) emit FallbackUsed(eventId, gSigner, g.value);

        uint64 executeAfter = uint64(block.timestamp) + vetoWindow;
        triggers[eventId] = Trigger(Status.Pending, executeAfter);
        emit TriggerPending(eventId, f.value, g.value, f.observedAt, g.observedAt, executeAfter);

        if (vetoWindow == 0) _execute(eventId);
    }

    /// @notice Finalise a pending trigger after the veto window if not vetoed.
    function execute(uint256 eventId) external {
        Trigger storage t = triggers[eventId];
        if (t.status != Status.Pending) revert NotPending();
        if (block.timestamp < t.executeAfter) revert VetoWindowOpen();
        _execute(eventId);
    }

    function veto(uint256 eventId) external {
        if (msg.sender != reporter || reporter == address(0)) revert NotReporter();
        Trigger storage t = triggers[eventId];
        if (t.status != Status.Pending) revert NotPending();
        t.status = Status.Vetoed;
        emit Vetoed(eventId, msg.sender);
    }

    function _execute(uint256 eventId) internal {
        triggers[eventId].status = Status.Executed;
        uint256 tranche = pool.release(eventId);
        emit Triggered(eventId, tranche);
    }

    function _checkFresh(uint64 observedAt) internal view {
        if (observedAt > block.timestamp || block.timestamp - observedAt > maxReadingAge) {
            revert StaleOrFutureReading();
        }
    }
}
