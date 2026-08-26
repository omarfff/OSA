// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OSA Route Registry
/// @notice Anchors OSA routing decisions without publishing endpoint evidence onchain.
/// @dev The full canonical evidence stays offchain. Its keccak256 hash is recorded here.
contract OSARouteRegistry {
    uint256 public constant MAX_CLOCK_SKEW = 5 minutes;
    bytes32 public constant SCHEMA_VERSION = keccak256("osa.route.v1");

    struct RouteReceipt {
        bytes32 decisionId;
        bytes32 providerId;
        bytes32 evidenceHash;
        address reporter;
        uint64 observedAt;
        uint64 recordedAt;
        uint8 score;
        uint8 confidence;
    }

    mapping(bytes32 receiptId => RouteReceipt receipt) public routeReceipts;

    error EmptyProviderId();
    error EmptyEvidenceHash();
    error InvalidScore(uint8 score);
    error InvalidConfidence(uint8 confidence);
    error InvalidObservedAt(uint64 observedAt);
    error ReceiptAlreadyRecorded(bytes32 receiptId);

    event RouteReceiptRecorded(
        bytes32 indexed receiptId,
        bytes32 indexed decisionId,
        bytes32 indexed providerId,
        bytes32 evidenceHash,
        address reporter,
        uint8 score,
        uint8 confidence,
        uint64 observedAt,
        uint64 recordedAt
    );

    function computeDecisionId(
        bytes32 providerId,
        uint8 score,
        uint8 confidence,
        bytes32 evidenceHash,
        uint64 observedAt
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                providerId,
                score,
                confidence,
                evidenceHash,
                observedAt
            )
        );
    }

    function computeReceiptId(bytes32 decisionId, address reporter) public pure returns (bytes32) {
        return keccak256(abi.encode(decisionId, reporter));
    }

    function recordRouteReceipt(
        bytes32 providerId,
        uint8 score,
        uint8 confidence,
        bytes32 evidenceHash,
        uint64 observedAt
    ) external returns (bytes32 receiptId, bytes32 decisionId) {
        if (providerId == bytes32(0)) revert EmptyProviderId();
        if (evidenceHash == bytes32(0)) revert EmptyEvidenceHash();
        if (score > 100) revert InvalidScore(score);
        if (confidence > 100) revert InvalidConfidence(confidence);
        if (observedAt == 0 || observedAt > block.timestamp + MAX_CLOCK_SKEW) {
            revert InvalidObservedAt(observedAt);
        }

        decisionId = computeDecisionId(providerId, score, confidence, evidenceHash, observedAt);
        receiptId = computeReceiptId(decisionId, msg.sender);
        if (routeReceipts[receiptId].recordedAt != 0) revert ReceiptAlreadyRecorded(receiptId);

        uint64 recordedAt = uint64(block.timestamp);
        routeReceipts[receiptId] = RouteReceipt({
            decisionId: decisionId,
            providerId: providerId,
            evidenceHash: evidenceHash,
            reporter: msg.sender,
            observedAt: observedAt,
            recordedAt: recordedAt,
            score: score,
            confidence: confidence
        });

        emit RouteReceiptRecorded(
            receiptId,
            decisionId,
            providerId,
            evidenceHash,
            msg.sender,
            score,
            confidence,
            observedAt,
            recordedAt
        );
    }
}
