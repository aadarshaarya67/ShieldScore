// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {FHE, ebool, euint32, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract ShieldScoreProtocol is ReentrancyGuard, Ownable, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    uint16 public constant MIN_SCORE = 300;
    uint16 public constant MAX_SCORE = 850;
    uint64 public constant SCORE_VALIDITY = 30 days;
    uint16 public constant BPS = 10_000;
    uint32 public constant DEFAULT_DURATION = 30 days;
    uint32 public constant MIN_DURATION = 1 days;
    uint32 public constant MAX_DURATION = 365 days;
    uint16 public constant MAX_COLLATERAL_BPS = 15_000;
    uint16 public constant MAX_INTEREST_BPS = 5_000;
    uint256 public constant NATIVE_COLLATERAL_PRICE = 1 ether;
    address public constant NATIVE_ASSET = address(0);

    struct CreditProfile {
        uint16 publicScore;
        uint64 encryptedUpdatedAt;
        uint64 scorePublishedAt;
        uint64 creditActivityUpdatedAt;
        uint32 snapshotsSubmitted;
        uint32 loansRepaid;
        uint32 loansRepaidLate;
        uint32 loansDefaulted;
        int16 lastRefreshAdjustment;
        uint256 totalBorrowed;
        uint256 totalRepaid;
    }

    struct Pool {
        address payable lender;
        address asset;
        uint8 assetDecimals;
        uint16 minScore;
        uint16 baseCollateralBps;
        uint16 interestBps;
        uint32 durationSeconds;
        uint256 collateralPriceWei;
        uint256 maxLoanAmount;
        uint256 liquidity;
        uint256 totalSupplied;
        uint256 totalBorrowed;
        uint256 totalRepaid;
        uint256 interestEarned;
        uint256 defaultedPrincipal;
        uint256 recoveredCollateral;
        uint256 borrowerScoreTotal;
        uint32 loanCount;
        uint32 defaultCount;
        bool active;
    }

    struct AssetPolicy {
        bool approved;
        uint256 collateralPriceWei;
    }

    enum LoanStatus {
        Active,
        Repaid,
        Defaulted
    }

    struct Loan {
        uint256 poolId;
        address payable borrower;
        uint256 principal;
        uint256 collateral;
        uint256 interest;
        uint64 startTime;
        uint64 dueTime;
        LoanStatus status;
    }

    struct ScoreHistoryEntry {
        uint16 score;
        uint64 publishedAt;
        uint32 snapshotNumber;
        int16 activityAdjustment;
        bool refresh;
    }

    struct ScoreAttestation {
        address owner;
        uint16 threshold;
        uint16 scoreAtIssue;
        uint64 issuedAt;
        bool revoked;
    }

    struct CreditAuthorization {
        uint256 nonce;
        uint64 deadline;
        bytes signature;
    }

    bytes32 private constant CREDIT_AUTHORIZATION_TYPEHASH =
        keccak256("CreditAuthorization(address account,bytes32 inputsHash,bool refresh,uint256 nonce,uint64 deadline)");

    mapping(address => euint32) private encryptedScores;
    mapping(address => bool) private pendingRefresh;
    mapping(bytes32 => bool) private publishedScoreHandles;
    mapping(address => uint256) public scoreNonces;
    mapping(address => CreditProfile) public profiles;
    mapping(address => ScoreHistoryEntry[]) private scoreHistory;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => Loan) public loans;
    mapping(address => AssetPolicy) public assetPolicies;
    mapping(address => uint256[]) private borrowerLoans;
    mapping(address => bytes32[]) private ownerAttestations;
    mapping(bytes32 => ScoreAttestation) public attestations;
    mapping(address => uint256) private attestationNonces;

    uint256 public poolCount;
    uint256 public loanCount;
    address public creditAttester;
    address public guardian;

    event EncryptedSnapshotSubmitted(address indexed account, bytes32 indexed encryptedScoreHandle);
    event EncryptedRefreshSubmitted(address indexed account, bytes32 indexed encryptedScoreHandle, int16 activityAdjustment);
    event ScorePublished(address indexed account, uint16 score, uint32 indexed snapshotNumber);
    event PoolCreated(
        uint256 indexed poolId,
        address indexed lender,
        uint16 minScore,
        uint16 baseCollateralBps,
        uint16 interestBps,
        uint256 supplied
    );
    event TokenPoolCreated(
        uint256 indexed poolId,
        address indexed lender,
        address indexed asset,
        uint8 assetDecimals,
        uint256 collateralPriceWei,
        uint16 minScore,
        uint16 baseCollateralBps,
        uint16 interestBps,
        uint256 supplied
    );
    event PoolFunded(uint256 indexed poolId, address indexed lender, uint256 amount);
    event PoolPaused(uint256 indexed poolId, bool active);
    event PoolWithdrawn(uint256 indexed poolId, address indexed lender, uint256 amount);
    event RecoveredCollateralWithdrawn(uint256 indexed poolId, address indexed lender, uint256 amount);
    event LoanBorrowed(
        uint256 indexed loanId,
        uint256 indexed poolId,
        address indexed borrower,
        uint256 principal,
        uint256 collateral,
        address asset
    );
    event LoanRepaid(
        uint256 indexed loanId,
        uint256 indexed poolId,
        address indexed borrower,
        uint256 principal,
        uint256 interest,
        address asset
    );
    event LoanDefaulted(uint256 indexed loanId, uint256 indexed poolId, address indexed borrower, uint256 recoveredCollateral);
    event ScoreAttestationIssued(bytes32 indexed attestationId, address indexed owner, uint16 threshold);
    event ScoreAttestationRevoked(bytes32 indexed attestationId, address indexed owner);
    event GuardianUpdated(address indexed guardian);
    event EmergencyPauseSet(address indexed caller, bool paused);
    event CreditAttesterUpdated(address indexed creditAttester);
    event AssetPolicyUpdated(address indexed asset, bool approved, uint256 collateralPriceWei);

    error InvalidScore();
    error MissingEncryptedScore();
    error InvalidDecryptSignature();
    error InvalidPoolTerms();
    error InvalidAsset();
    error PoolNotActive();
    error NotPoolLender();
    error InsufficientLiquidity();
    error ScoreNotPublished();
    error ScoreStale();
    error InvalidCreditAuthorization();
    error CreditAuthorizationExpired();
    error ScoreTooLow();
    error LoanAmountInvalid();
    error CollateralTooLow();
    error LoanNotActive();
    error LoanNotDue();
    error RepaymentTooLow();
    error AttestationUnavailable();
    error NativeTransferFailed();
    error NativeValueNotAccepted();
    error UnauthorizedGuardian();
    error AssetNotApproved();

    constructor() Ownable(msg.sender) EIP712("ShieldScoreProtocol", "1") {
        creditAttester = msg.sender;
        emit CreditAttesterUpdated(msg.sender);
    }

    function submitEncryptedSnapshot(
        InEuint32 calldata balanceConsistency,
        InEuint32 calldata repaymentHistory,
        InEuint32 calldata walletAge,
        InEuint32 calldata protocolDiversity,
        InEuint32 calldata incomeConsistency,
        CreditAuthorization calldata authorization
    ) external whenNotPaused returns (bytes32 encryptedScoreHandle) {
        _consumeCreditAuthorization(
            msg.sender,
            balanceConsistency,
            repaymentHistory,
            walletAge,
            protocolDiversity,
            incomeConsistency,
            false,
            authorization
        );
        euint32 encryptedScore = _calculateEncryptedScore(
            FHE.asEuint32(balanceConsistency),
            FHE.asEuint32(repaymentHistory),
            FHE.asEuint32(walletAge),
            FHE.asEuint32(protocolDiversity),
            FHE.asEuint32(incomeConsistency)
        );

        encryptedScoreHandle = _storeEncryptedScore(msg.sender, encryptedScore);
        pendingRefresh[msg.sender] = false;

        emit EncryptedSnapshotSubmitted(msg.sender, encryptedScoreHandle);
    }

    function submitEncryptedRefreshSnapshot(
        InEuint32 calldata balanceConsistency,
        InEuint32 calldata repaymentHistory,
        InEuint32 calldata walletAge,
        InEuint32 calldata protocolDiversity,
        InEuint32 calldata incomeConsistency,
        CreditAuthorization calldata authorization
    ) external whenNotPaused returns (bytes32 encryptedScoreHandle) {
        _consumeCreditAuthorization(
            msg.sender,
            balanceConsistency,
            repaymentHistory,
            walletAge,
            protocolDiversity,
            incomeConsistency,
            true,
            authorization
        );
        int16 adjustment = scoreRefreshAdjustment(msg.sender);
        euint32 encryptedScore = _calculateActivityAdjustedScore(
            msg.sender,
            FHE.asEuint32(balanceConsistency),
            FHE.asEuint32(repaymentHistory),
            FHE.asEuint32(walletAge),
            FHE.asEuint32(protocolDiversity),
            FHE.asEuint32(incomeConsistency),
            adjustment
        );

        encryptedScoreHandle = _storeEncryptedScore(msg.sender, encryptedScore);
        pendingRefresh[msg.sender] = true;
        profiles[msg.sender].lastRefreshAdjustment = adjustment;

        emit EncryptedRefreshSubmitted(msg.sender, encryptedScoreHandle, adjustment);
    }

    function publishScore(uint32 decryptedScore, bytes calldata signature) external whenNotPaused {
        euint32 encryptedScore = encryptedScores[msg.sender];
        bytes32 encryptedScoreHandle = FHE.unwrap(encryptedScore);
        if (encryptedScoreHandle == bytes32(0) || publishedScoreHandles[encryptedScoreHandle]) {
            revert MissingEncryptedScore();
        }
        if (decryptedScore < MIN_SCORE || decryptedScore > MAX_SCORE) revert InvalidScore();
        if (!FHE.verifyDecryptResult(encryptedScore, decryptedScore, signature)) revert InvalidDecryptSignature();

        publishedScoreHandles[encryptedScoreHandle] = true;
        CreditProfile storage profile = profiles[msg.sender];
        profile.publicScore = uint16(decryptedScore);
        profile.scorePublishedAt = uint64(block.timestamp);

        ScoreHistoryEntry memory entry = ScoreHistoryEntry({
            score: uint16(decryptedScore),
            publishedAt: uint64(block.timestamp),
            snapshotNumber: profile.snapshotsSubmitted,
            activityAdjustment: pendingRefresh[msg.sender] ? profile.lastRefreshAdjustment : int16(0),
            refresh: pendingRefresh[msg.sender]
        });
        scoreHistory[msg.sender].push(entry);
        pendingRefresh[msg.sender] = false;

        emit ScorePublished(msg.sender, uint16(decryptedScore), profile.snapshotsSubmitted);
    }

    function createPool(
        uint16 minScore,
        uint16 baseCollateralBps,
        uint16 interestBps,
        uint32 durationSeconds,
        uint256 maxLoanAmount
    ) external payable nonReentrant whenNotPaused returns (uint256 poolId) {
        uint32 resolvedDuration = _validatePoolTerms(
            minScore,
            baseCollateralBps,
            interestBps,
            durationSeconds,
            maxLoanAmount,
            msg.value,
            NATIVE_COLLATERAL_PRICE
        );

        poolId = ++poolCount;
        pools[poolId] = Pool({
            lender: payable(msg.sender),
            asset: NATIVE_ASSET,
            assetDecimals: 18,
            minScore: minScore,
            baseCollateralBps: baseCollateralBps,
            interestBps: interestBps,
            durationSeconds: resolvedDuration,
            collateralPriceWei: NATIVE_COLLATERAL_PRICE,
            maxLoanAmount: maxLoanAmount,
            liquidity: msg.value,
            totalSupplied: msg.value,
            totalBorrowed: 0,
            totalRepaid: 0,
            interestEarned: 0,
            defaultedPrincipal: 0,
            recoveredCollateral: 0,
            borrowerScoreTotal: 0,
            loanCount: 0,
            defaultCount: 0,
            active: true
        });

        emit PoolCreated(poolId, msg.sender, minScore, baseCollateralBps, interestBps, msg.value);
    }

    function createErc20Pool(
        address asset,
        uint256 collateralPriceWei,
        uint16 minScore,
        uint16 baseCollateralBps,
        uint16 interestBps,
        uint32 durationSeconds,
        uint256 maxLoanAmount,
        uint256 initialLiquidity
    ) external nonReentrant whenNotPaused returns (uint256 poolId) {
        if (asset == address(0)) revert InvalidAsset();
        AssetPolicy memory assetPolicy = assetPolicies[asset];
        if (!assetPolicy.approved) revert AssetNotApproved();
        if (collateralPriceWei != assetPolicy.collateralPriceWei) revert InvalidPoolTerms();
        uint8 assetDecimals = _safeAssetDecimals(asset);
        uint32 resolvedDuration = _validatePoolTerms(
            minScore,
            baseCollateralBps,
            interestBps,
            durationSeconds,
            maxLoanAmount,
            initialLiquidity,
            collateralPriceWei
        );

        uint256 received = _pullToken(asset, msg.sender, initialLiquidity);
        if (maxLoanAmount > received) revert InvalidPoolTerms();

        poolId = ++poolCount;
        pools[poolId] = Pool({
            lender: payable(msg.sender),
            asset: asset,
            assetDecimals: assetDecimals,
            minScore: minScore,
            baseCollateralBps: baseCollateralBps,
            interestBps: interestBps,
            durationSeconds: resolvedDuration,
            collateralPriceWei: collateralPriceWei,
            maxLoanAmount: maxLoanAmount,
            liquidity: received,
            totalSupplied: received,
            totalBorrowed: 0,
            totalRepaid: 0,
            interestEarned: 0,
            defaultedPrincipal: 0,
            recoveredCollateral: 0,
            borrowerScoreTotal: 0,
            loanCount: 0,
            defaultCount: 0,
            active: true
        });

        emit TokenPoolCreated(
            poolId,
            msg.sender,
            asset,
            assetDecimals,
            collateralPriceWei,
            minScore,
            baseCollateralBps,
            interestBps,
            received
        );
    }

    function fundPool(uint256 poolId) external payable nonReentrant whenNotPaused {
        Pool storage pool = pools[poolId];
        if (pool.lender == address(0)) revert InvalidPoolTerms();
        if (msg.sender != pool.lender) revert NotPoolLender();
        if (pool.asset != NATIVE_ASSET) revert InvalidAsset();
        if (msg.value == 0) revert InvalidPoolTerms();

        pool.liquidity += msg.value;
        pool.totalSupplied += msg.value;

        emit PoolFunded(poolId, msg.sender, msg.value);
    }

    function fundErc20Pool(uint256 poolId, uint256 amount) external nonReentrant whenNotPaused {
        Pool storage pool = pools[poolId];
        if (pool.lender == address(0)) revert InvalidPoolTerms();
        if (msg.sender != pool.lender) revert NotPoolLender();
        if (pool.asset == NATIVE_ASSET) revert InvalidAsset();
        if (amount == 0) revert InvalidPoolTerms();

        uint256 received = _pullToken(pool.asset, msg.sender, amount);
        pool.liquidity += received;
        pool.totalSupplied += received;

        emit PoolFunded(poolId, msg.sender, received);
    }

    function setPoolActive(uint256 poolId, bool active) external whenNotPaused {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.lender) revert NotPoolLender();
        pool.active = active;
        emit PoolPaused(poolId, active);
    }

    function withdrawAvailable(uint256 poolId, uint256 amount) external nonReentrant whenNotPaused {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.lender) revert NotPoolLender();
        if (amount == 0 || amount > pool.liquidity) revert InsufficientLiquidity();

        pool.liquidity -= amount;
        _transferAsset(pool.asset, pool.lender, amount);

        emit PoolWithdrawn(poolId, msg.sender, amount);
    }

    function withdrawRecoveredCollateral(uint256 poolId, uint256 amount) external nonReentrant whenNotPaused {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.lender) revert NotPoolLender();
        if (pool.asset == NATIVE_ASSET) revert InvalidAsset();
        if (amount == 0 || amount > pool.recoveredCollateral) revert InsufficientLiquidity();

        pool.recoveredCollateral -= amount;
        _sendValue(pool.lender, amount);

        emit RecoveredCollateralWithdrawn(poolId, msg.sender, amount);
    }

    function borrow(uint256 poolId, uint256 amount) external payable nonReentrant whenNotPaused returns (uint256 loanId) {
        Pool storage pool = pools[poolId];
        CreditProfile storage profile = profiles[msg.sender];

        if (!pool.active || pool.lender == address(0)) revert PoolNotActive();
        if (profile.scorePublishedAt == 0) revert ScoreNotPublished();
        if (_scoreIsStale(profile)) revert ScoreStale();
        if (profile.publicScore < pool.minScore) revert ScoreTooLow();
        if (amount == 0 || amount > pool.maxLoanAmount) revert LoanAmountInvalid();
        if (amount > pool.liquidity) revert InsufficientLiquidity();

        uint16 requiredCollateralBps = collateralBpsForScore(profile.publicScore);
        if (pool.baseCollateralBps < requiredCollateralBps) {
                requiredCollateralBps = pool.baseCollateralBps;
        }

        uint256 requiredCollateral = _requiredCollateral(pool, amount, requiredCollateralBps);
        if (msg.value < requiredCollateral) revert CollateralTooLow();

        uint256 interest = _interestFor(amount, pool.interestBps, pool.durationSeconds);
        loanId = ++loanCount;

        pool.liquidity -= amount;
        pool.totalBorrowed += amount;
        pool.borrowerScoreTotal += profile.publicScore;
        pool.loanCount += 1;

        profile.totalBorrowed += amount;
        borrowerLoans[msg.sender].push(loanId);

        loans[loanId] = Loan({
            poolId: poolId,
            borrower: payable(msg.sender),
            principal: amount,
            collateral: requiredCollateral,
            interest: interest,
            startTime: uint64(block.timestamp),
            dueTime: uint64(block.timestamp + pool.durationSeconds),
            status: LoanStatus.Active
        });

        emit LoanBorrowed(loanId, poolId, msg.sender, amount, requiredCollateral, pool.asset);

        uint256 excessCollateral = msg.value - requiredCollateral;
        _transferAsset(pool.asset, payable(msg.sender), amount);
        if (excessCollateral > 0) {
            _sendValue(payable(msg.sender), excessCollateral);
        }
    }

    function repay(uint256 loanId) external payable nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        if (msg.sender != loan.borrower) revert LoanNotActive();

        uint256 due = loan.principal + loan.interest;
        Pool storage pool = pools[loan.poolId];
        CreditProfile storage profile = profiles[msg.sender];
        if (pool.asset == NATIVE_ASSET) {
            if (msg.value < due) revert RepaymentTooLow();
        } else {
            if (msg.value != 0) revert NativeValueNotAccepted();
            uint256 received = _pullToken(pool.asset, msg.sender, due);
            if (received < due) revert RepaymentTooLow();
        }

        loan.status = LoanStatus.Repaid;
        pool.liquidity += due;
        pool.totalRepaid += loan.principal;
        pool.interestEarned += loan.interest;
        profile.totalRepaid += due;
        profile.creditActivityUpdatedAt = uint64(block.timestamp);
        if (block.timestamp > loan.dueTime) {
            profile.loansRepaidLate += 1;
        } else {
            profile.loansRepaid += 1;
        }

        emit LoanRepaid(loanId, loan.poolId, msg.sender, loan.principal, loan.interest, pool.asset);

        _sendValue(loan.borrower, loan.collateral);
        if (pool.asset == NATIVE_ASSET) {
            uint256 refund = msg.value - due;
            if (refund > 0) {
                _sendValue(payable(msg.sender), refund);
            }
        }
    }

    function markDefault(uint256 loanId) external nonReentrant whenNotPaused {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        if (block.timestamp <= loan.dueTime) revert LoanNotDue();

        Pool storage pool = pools[loan.poolId];
        CreditProfile storage profile = profiles[loan.borrower];

        loan.status = LoanStatus.Defaulted;
        if (pool.asset == NATIVE_ASSET) {
            pool.liquidity += loan.collateral;
        } else {
            pool.recoveredCollateral += loan.collateral;
        }
        pool.defaultedPrincipal += loan.principal;
        pool.defaultCount += 1;
        profile.creditActivityUpdatedAt = uint64(block.timestamp);
        profile.loansDefaulted += 1;

        emit LoanDefaulted(loanId, loan.poolId, loan.borrower, loan.collateral);
    }

    function issueScoreAttestation(uint16 threshold) external whenNotPaused returns (bytes32 attestationId) {
        CreditProfile storage profile = profiles[msg.sender];
        if (threshold < MIN_SCORE || threshold > MAX_SCORE) revert InvalidScore();
        if (profile.scorePublishedAt == 0 || profile.publicScore < threshold) revert AttestationUnavailable();
        if (_scoreIsStale(profile)) revert ScoreStale();

        attestationId = keccak256(
            abi.encodePacked(
                address(this),
                block.chainid,
                msg.sender,
                threshold,
                profile.publicScore,
                attestationNonces[msg.sender]++
            )
        );

        attestations[attestationId] = ScoreAttestation({
            owner: msg.sender,
            threshold: threshold,
            scoreAtIssue: profile.publicScore,
            issuedAt: uint64(block.timestamp),
            revoked: false
        });
        ownerAttestations[msg.sender].push(attestationId);

        emit ScoreAttestationIssued(attestationId, msg.sender, threshold);
    }

    function revokeAttestation(bytes32 attestationId) external {
        ScoreAttestation storage attestation = attestations[attestationId];
        if (attestation.owner != msg.sender) revert AttestationUnavailable();
        attestation.revoked = true;
        emit ScoreAttestationRevoked(attestationId, msg.sender);
    }

    function verifyAttestation(bytes32 attestationId, address owner, uint16 threshold) external view returns (bool) {
        ScoreAttestation memory attestation = attestations[attestationId];
        CreditProfile storage profile = profiles[owner];
        return
            attestation.owner == owner &&
            attestation.threshold >= threshold &&
            profile.publicScore >= threshold &&
            !_scoreIsStale(profile) &&
            attestation.scoreAtIssue >= threshold &&
            attestation.issuedAt != 0 &&
            !attestation.revoked;
    }

    function setGuardian(address nextGuardian) external onlyOwner {
        guardian = nextGuardian;
        emit GuardianUpdated(nextGuardian);
    }

    function setCreditAttester(address nextCreditAttester) external onlyOwner {
        if (nextCreditAttester == address(0)) revert InvalidCreditAuthorization();
        creditAttester = nextCreditAttester;
        emit CreditAttesterUpdated(nextCreditAttester);
    }

    function setAssetPolicy(address asset, bool approved, uint256 collateralPriceWei) external onlyOwner {
        if (asset == address(0)) revert InvalidAsset();
        if (approved && collateralPriceWei == 0) revert InvalidPoolTerms();

        uint256 resolvedPrice = approved ? collateralPriceWei : 0;
        assetPolicies[asset] = AssetPolicy({approved: approved, collateralPriceWei: resolvedPrice});
        emit AssetPolicyUpdated(asset, approved, resolvedPrice);
    }

    function emergencyPause() external {
        if (msg.sender != owner() && msg.sender != guardian) revert UnauthorizedGuardian();
        _pause();
        emit EmergencyPauseSet(msg.sender, true);
    }

    function emergencyUnpause() external onlyOwner {
        _unpause();
        emit EmergencyPauseSet(msg.sender, false);
    }

    function encryptedScoreOf(address account) external view returns (euint32) {
        return encryptedScores[account];
    }

    function scoreHistoryOf(address account) external view returns (ScoreHistoryEntry[] memory) {
        return scoreHistory[account];
    }

    function creditInputsHash(
        InEuint32 calldata balanceConsistency,
        InEuint32 calldata repaymentHistory,
        InEuint32 calldata walletAge,
        InEuint32 calldata protocolDiversity,
        InEuint32 calldata incomeConsistency
    ) external pure returns (bytes32) {
        return _creditInputsHash(balanceConsistency, repaymentHistory, walletAge, protocolDiversity, incomeConsistency);
    }

    function borrowerLoanIds(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    function ownerAttestationIds(address owner) external view returns (bytes32[] memory) {
        return ownerAttestations[owner];
    }

    function collateralBpsForScore(uint16 score) public pure returns (uint16) {
        if (score >= 800) return 500;
        if (score >= 700) return 2_500;
        if (score >= 600) return 5_000;
        if (score >= 500) return 10_000;
        return 15_000;
    }

    function poolHealth(uint256 poolId)
        external
        view
        returns (uint16 utilizationBps, uint16 averageScore, uint16 defaultRateBps)
    {
        Pool storage pool = pools[poolId];
        uint256 activePrincipal = pool.totalBorrowed - pool.totalRepaid - pool.defaultedPrincipal;
        uint256 denominator = pool.liquidity + activePrincipal;
        if (denominator > 0) {
            utilizationBps = uint16((activePrincipal * BPS) / denominator);
        }
        if (pool.loanCount > 0) {
            averageScore = uint16(pool.borrowerScoreTotal / pool.loanCount);
            defaultRateBps = uint16((uint256(pool.defaultCount) * BPS) / pool.loanCount);
        }
    }

    function poolAnalytics(uint256 poolId)
        external
        view
        returns (
            uint16 utilizationBps,
            uint16 averageScore,
            uint16 defaultRateBps,
            uint16 expectedYieldBps,
            uint256 activePrincipal,
            uint256 availableLiquidity,
            uint256 interestEarned,
            uint256 defaultedPrincipal,
            uint256 recoveredCollateral
        )
    {
        Pool storage pool = pools[poolId];
        (utilizationBps, averageScore, defaultRateBps) = this.poolHealth(poolId);
        uint256 riskAdjustedYield = (uint256(pool.interestBps) * utilizationBps) / BPS;
        expectedYieldBps = uint16((riskAdjustedYield * (BPS - defaultRateBps)) / BPS);
        activePrincipal = pool.totalBorrowed - pool.totalRepaid - pool.defaultedPrincipal;
        availableLiquidity = pool.liquidity;
        interestEarned = pool.interestEarned;
        defaultedPrincipal = pool.defaultedPrincipal;
        recoveredCollateral = pool.recoveredCollateral;
    }

    function requiredCollateralFor(uint256 poolId, uint256 amount, uint16 score) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        uint16 requiredCollateralBps = collateralBpsForScore(score);
        if (pool.baseCollateralBps < requiredCollateralBps) {
            requiredCollateralBps = pool.baseCollateralBps;
        }
        return _requiredCollateral(pool, amount, requiredCollateralBps);
    }

    function scoreRefreshAdjustment(address account) public view returns (int16) {
        CreditProfile storage profile = profiles[account];
        uint32 onTime = profile.loansRepaid > 10 ? 10 : profile.loansRepaid;
        uint32 late = profile.loansRepaidLate > 10 ? 10 : profile.loansRepaidLate;
        uint32 defaults = profile.loansDefaulted > 5 ? 5 : profile.loansDefaulted;

        int32 adjustment = int32(onTime) * 8 + int32(late) * 3 - int32(defaults) * 35;
        if (adjustment > 80) return 80;
        if (adjustment < -150) return -150;
        return int16(adjustment);
    }

    function _calculateEncryptedScore(
        euint32 balanceConsistency,
        euint32 repaymentHistory,
        euint32 walletAge,
        euint32 protocolDiversity,
        euint32 incomeConsistency
    ) private returns (euint32) {
        euint32 weighted = FHE.add(
            FHE.add(
                FHE.mul(balanceConsistency, FHE.asEuint32(25)),
                FHE.mul(repaymentHistory, FHE.asEuint32(30))
            ),
            FHE.add(
                FHE.add(FHE.mul(walletAge, FHE.asEuint32(15)), FHE.mul(protocolDiversity, FHE.asEuint32(15))),
                FHE.mul(incomeConsistency, FHE.asEuint32(15))
            )
        );

        euint32 scaled = FHE.div(FHE.mul(weighted, FHE.asEuint32(550)), FHE.asEuint32(10_000));
        return FHE.add(FHE.asEuint32(MIN_SCORE), scaled);
    }

    function _scoreIsStale(CreditProfile storage profile) private view returns (bool) {
        return block.timestamp > profile.scorePublishedAt + SCORE_VALIDITY || profile.creditActivityUpdatedAt > profile.scorePublishedAt;
    }

    function _consumeCreditAuthorization(
        address account,
        InEuint32 calldata balanceConsistency,
        InEuint32 calldata repaymentHistory,
        InEuint32 calldata walletAge,
        InEuint32 calldata protocolDiversity,
        InEuint32 calldata incomeConsistency,
        bool refresh,
        CreditAuthorization calldata authorization
    ) private {
        if (block.timestamp > authorization.deadline) revert CreditAuthorizationExpired();
        if (authorization.nonce != scoreNonces[account]) revert InvalidCreditAuthorization();

        bytes32 structHash = keccak256(
            abi.encode(
                CREDIT_AUTHORIZATION_TYPEHASH,
                account,
                _creditInputsHash(balanceConsistency, repaymentHistory, walletAge, protocolDiversity, incomeConsistency),
                refresh,
                authorization.nonce,
                authorization.deadline
            )
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), authorization.signature);
        if (recovered != creditAttester) revert InvalidCreditAuthorization();

        scoreNonces[account] = authorization.nonce + 1;
    }

    function _creditInputsHash(
        InEuint32 calldata balanceConsistency,
        InEuint32 calldata repaymentHistory,
        InEuint32 calldata walletAge,
        InEuint32 calldata protocolDiversity,
        InEuint32 calldata incomeConsistency
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _encryptedInputHash(balanceConsistency),
                _encryptedInputHash(repaymentHistory),
                _encryptedInputHash(walletAge),
                _encryptedInputHash(protocolDiversity),
                _encryptedInputHash(incomeConsistency)
            )
        );
    }

    function _encryptedInputHash(InEuint32 calldata input) private pure returns (bytes32) {
        return keccak256(abi.encode(input.ctHash, input.securityZone, input.utype, keccak256(input.signature)));
    }

    function _calculateActivityAdjustedScore(
        address account,
        euint32 balanceConsistency,
        euint32 repaymentHistory,
        euint32 walletAge,
        euint32 protocolDiversity,
        euint32 incomeConsistency,
        int16 adjustment
    ) private returns (euint32) {
        euint32 score = _calculateEncryptedScore(
            balanceConsistency,
            repaymentHistory,
            walletAge,
            protocolDiversity,
            incomeConsistency
        );
        if (adjustment > 0) {
            score = FHE.add(score, FHE.asEuint32(uint32(uint16(adjustment))));
        } else if (adjustment < 0) {
            euint32 penalty = FHE.asEuint32(uint32(uint16(-adjustment)));
            ebool canSubtract = FHE.gte(score, penalty);
            score = FHE.select(canSubtract, FHE.sub(score, penalty), FHE.asEuint32(MIN_SCORE));
        }

        euint32 bounded = FHE.min(FHE.max(score, FHE.asEuint32(MIN_SCORE)), FHE.asEuint32(MAX_SCORE));
        profiles[account].lastRefreshAdjustment = adjustment;
        return bounded;
    }

    function _storeEncryptedScore(address account, euint32 encryptedScore) private returns (bytes32 encryptedScoreHandle) {
        encryptedScores[account] = encryptedScore;
        profiles[account].encryptedUpdatedAt = uint64(block.timestamp);
        profiles[account].snapshotsSubmitted += 1;

        FHE.allowThis(encryptedScore);
        FHE.allowSender(encryptedScore);
        FHE.allowPublic(encryptedScore);

        encryptedScoreHandle = FHE.unwrap(encryptedScore);
    }

    function _validatePoolTerms(
        uint16 minScore,
        uint16 baseCollateralBps,
        uint16 interestBps,
        uint32 durationSeconds,
        uint256 maxLoanAmount,
        uint256 supplied,
        uint256 collateralPriceWei
    ) private pure returns (uint32 resolvedDuration) {
        resolvedDuration = durationSeconds == 0 ? DEFAULT_DURATION : durationSeconds;
        if (
            supplied == 0 ||
            minScore < MIN_SCORE ||
            minScore > MAX_SCORE ||
            baseCollateralBps == 0 ||
            baseCollateralBps > MAX_COLLATERAL_BPS ||
            interestBps > MAX_INTEREST_BPS ||
            resolvedDuration < MIN_DURATION ||
            resolvedDuration > MAX_DURATION ||
            maxLoanAmount == 0 ||
            maxLoanAmount > supplied ||
            collateralPriceWei == 0
        ) revert InvalidPoolTerms();
    }

    function _interestFor(uint256 amount, uint16 interestBps, uint32 durationSeconds) private pure returns (uint256) {
        return (amount * interestBps * durationSeconds) / (uint256(BPS) * 365 days);
    }

    function _requiredCollateral(Pool storage pool, uint256 amount, uint16 collateralBps) private view returns (uint256) {
        if (pool.asset == NATIVE_ASSET) {
            return (amount * collateralBps) / BPS;
        }

        return (amount * pool.collateralPriceWei * collateralBps) / (BPS * (10 ** pool.assetDecimals));
    }

    function _pullToken(address token, address from, uint256 amount) private returns (uint256 received) {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert InvalidPoolTerms();
    }

    function _safeAssetDecimals(address asset) private view returns (uint8) {
        try IERC20Metadata(asset).decimals() returns (uint8 decimals) {
            if (decimals > 18) revert InvalidAsset();
            return decimals;
        } catch {
            return 18;
        }
    }

    function _transferAsset(address asset, address payable recipient, uint256 amount) private {
        if (asset == NATIVE_ASSET) {
            _sendValue(recipient, amount);
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
    }

    function _sendValue(address payable recipient, uint256 amount) private {
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }
}
