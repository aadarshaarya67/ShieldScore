// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FHE, euint32, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract ShieldScoreProtocol is ReentrancyGuard {
    uint16 public constant MIN_SCORE = 300;
    uint16 public constant MAX_SCORE = 850;
    uint16 public constant BPS = 10_000;
    uint32 public constant DEFAULT_DURATION = 30 days;

    struct CreditProfile {
        uint16 publicScore;
        uint64 encryptedUpdatedAt;
        uint64 scorePublishedAt;
        uint32 snapshotsSubmitted;
        uint32 loansRepaid;
        uint32 loansDefaulted;
        uint256 totalBorrowed;
        uint256 totalRepaid;
    }

    struct Pool {
        address payable lender;
        uint16 minScore;
        uint16 baseCollateralBps;
        uint16 interestBps;
        uint32 durationSeconds;
        uint256 maxLoanAmount;
        uint256 liquidity;
        uint256 totalSupplied;
        uint256 totalBorrowed;
        uint256 totalRepaid;
        uint256 interestEarned;
        uint256 defaultedPrincipal;
        uint256 borrowerScoreTotal;
        uint32 loanCount;
        uint32 defaultCount;
        bool active;
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

    struct ScoreAttestation {
        address owner;
        uint16 threshold;
        uint16 scoreAtIssue;
        uint64 issuedAt;
        bool revoked;
    }

    mapping(address => euint32) private encryptedScores;
    mapping(address => CreditProfile) public profiles;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) private borrowerLoans;
    mapping(address => bytes32[]) private ownerAttestations;
    mapping(bytes32 => ScoreAttestation) public attestations;
    mapping(address => uint256) private attestationNonces;

    uint256 public poolCount;
    uint256 public loanCount;

    event EncryptedSnapshotSubmitted(address indexed account, bytes32 indexed encryptedScoreHandle);
    event ScorePublished(address indexed account, uint16 score);
    event PoolCreated(
        uint256 indexed poolId,
        address indexed lender,
        uint16 minScore,
        uint16 baseCollateralBps,
        uint16 interestBps,
        uint256 supplied
    );
    event PoolFunded(uint256 indexed poolId, address indexed lender, uint256 amount);
    event PoolPaused(uint256 indexed poolId, bool active);
    event PoolWithdrawn(uint256 indexed poolId, address indexed lender, uint256 amount);
    event LoanBorrowed(uint256 indexed loanId, uint256 indexed poolId, address indexed borrower, uint256 principal, uint256 collateral);
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 interest);
    event LoanDefaulted(uint256 indexed loanId, address indexed borrower, uint256 recoveredCollateral);
    event ScoreAttestationIssued(bytes32 indexed attestationId, address indexed owner, uint16 threshold);
    event ScoreAttestationRevoked(bytes32 indexed attestationId, address indexed owner);

    error InvalidScore();
    error MissingEncryptedScore();
    error InvalidDecryptSignature();
    error InvalidPoolTerms();
    error PoolNotActive();
    error NotPoolLender();
    error InsufficientLiquidity();
    error ScoreNotPublished();
    error ScoreTooLow();
    error LoanAmountInvalid();
    error CollateralTooLow();
    error LoanNotActive();
    error LoanNotDue();
    error RepaymentTooLow();
    error AttestationUnavailable();
    error NativeTransferFailed();

    function submitEncryptedSnapshot(
        InEuint32 calldata balanceConsistency,
        InEuint32 calldata repaymentHistory,
        InEuint32 calldata walletAge,
        InEuint32 calldata protocolDiversity,
        InEuint32 calldata incomeConsistency
    ) external returns (bytes32 encryptedScoreHandle) {
        euint32 encryptedScore = _calculateEncryptedScore(
            FHE.asEuint32(balanceConsistency),
            FHE.asEuint32(repaymentHistory),
            FHE.asEuint32(walletAge),
            FHE.asEuint32(protocolDiversity),
            FHE.asEuint32(incomeConsistency)
        );

        encryptedScores[msg.sender] = encryptedScore;
        profiles[msg.sender].encryptedUpdatedAt = uint64(block.timestamp);
        profiles[msg.sender].snapshotsSubmitted += 1;

        FHE.allowThis(encryptedScore);
        FHE.allowSender(encryptedScore);
        FHE.allowPublic(encryptedScore);

        encryptedScoreHandle = FHE.unwrap(encryptedScore);
        emit EncryptedSnapshotSubmitted(msg.sender, encryptedScoreHandle);
    }

    function publishScore(uint32 decryptedScore, bytes calldata signature) external {
        euint32 encryptedScore = encryptedScores[msg.sender];
        if (FHE.unwrap(encryptedScore) == bytes32(0)) revert MissingEncryptedScore();
        if (decryptedScore < MIN_SCORE || decryptedScore > MAX_SCORE) revert InvalidScore();
        if (!FHE.verifyDecryptResult(encryptedScore, decryptedScore, signature)) revert InvalidDecryptSignature();

        profiles[msg.sender].publicScore = uint16(decryptedScore);
        profiles[msg.sender].scorePublishedAt = uint64(block.timestamp);

        emit ScorePublished(msg.sender, uint16(decryptedScore));
    }

    function createPool(
        uint16 minScore,
        uint16 baseCollateralBps,
        uint16 interestBps,
        uint32 durationSeconds,
        uint256 maxLoanAmount
    ) external payable nonReentrant returns (uint256 poolId) {
        if (
            msg.value == 0 ||
            minScore < MIN_SCORE ||
            minScore > MAX_SCORE ||
            baseCollateralBps == 0 ||
            baseCollateralBps > 15_000 ||
            interestBps > 5_000 ||
            maxLoanAmount == 0 ||
            maxLoanAmount > msg.value
        ) revert InvalidPoolTerms();

        poolId = ++poolCount;
        pools[poolId] = Pool({
            lender: payable(msg.sender),
            minScore: minScore,
            baseCollateralBps: baseCollateralBps,
            interestBps: interestBps,
            durationSeconds: durationSeconds == 0 ? DEFAULT_DURATION : durationSeconds,
            maxLoanAmount: maxLoanAmount,
            liquidity: msg.value,
            totalSupplied: msg.value,
            totalBorrowed: 0,
            totalRepaid: 0,
            interestEarned: 0,
            defaultedPrincipal: 0,
            borrowerScoreTotal: 0,
            loanCount: 0,
            defaultCount: 0,
            active: true
        });

        emit PoolCreated(poolId, msg.sender, minScore, baseCollateralBps, interestBps, msg.value);
    }

    function fundPool(uint256 poolId) external payable nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.lender == address(0)) revert InvalidPoolTerms();
        if (msg.sender != pool.lender) revert NotPoolLender();
        if (msg.value == 0) revert InvalidPoolTerms();

        pool.liquidity += msg.value;
        pool.totalSupplied += msg.value;

        emit PoolFunded(poolId, msg.sender, msg.value);
    }

    function setPoolActive(uint256 poolId, bool active) external {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.lender) revert NotPoolLender();
        pool.active = active;
        emit PoolPaused(poolId, active);
    }

    function withdrawAvailable(uint256 poolId, uint256 amount) external nonReentrant {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.lender) revert NotPoolLender();
        if (amount == 0 || amount > pool.liquidity) revert InsufficientLiquidity();

        pool.liquidity -= amount;
        _sendValue(pool.lender, amount);

        emit PoolWithdrawn(poolId, msg.sender, amount);
    }

    function borrow(uint256 poolId, uint256 amount) external payable nonReentrant returns (uint256 loanId) {
        Pool storage pool = pools[poolId];
        CreditProfile storage profile = profiles[msg.sender];

        if (!pool.active || pool.lender == address(0)) revert PoolNotActive();
        if (profile.scorePublishedAt == 0) revert ScoreNotPublished();
        if (profile.publicScore < pool.minScore) revert ScoreTooLow();
        if (amount == 0 || amount > pool.maxLoanAmount) revert LoanAmountInvalid();
        if (amount > pool.liquidity) revert InsufficientLiquidity();

        uint16 requiredCollateralBps = collateralBpsForScore(profile.publicScore);
        if (pool.baseCollateralBps < requiredCollateralBps) {
            requiredCollateralBps = pool.baseCollateralBps;
        }

        uint256 requiredCollateral = (amount * requiredCollateralBps) / BPS;
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

        emit LoanBorrowed(loanId, poolId, msg.sender, amount, requiredCollateral);

        uint256 excessCollateral = msg.value - requiredCollateral;
        _sendValue(payable(msg.sender), amount);
        if (excessCollateral > 0) {
            _sendValue(payable(msg.sender), excessCollateral);
        }
    }

    function repay(uint256 loanId) external payable nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        if (msg.sender != loan.borrower) revert LoanNotActive();

        uint256 due = loan.principal + loan.interest;
        if (msg.value < due) revert RepaymentTooLow();

        Pool storage pool = pools[loan.poolId];
        CreditProfile storage profile = profiles[msg.sender];

        loan.status = LoanStatus.Repaid;
        pool.liquidity += due;
        pool.totalRepaid += loan.principal;
        pool.interestEarned += loan.interest;
        profile.totalRepaid += due;
        profile.loansRepaid += 1;

        emit LoanRepaid(loanId, msg.sender, loan.principal, loan.interest);

        _sendValue(loan.borrower, loan.collateral);
        uint256 refund = msg.value - due;
        if (refund > 0) {
            _sendValue(payable(msg.sender), refund);
        }
    }

    function markDefault(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        if (block.timestamp <= loan.dueTime) revert LoanNotDue();

        Pool storage pool = pools[loan.poolId];
        CreditProfile storage profile = profiles[loan.borrower];

        loan.status = LoanStatus.Defaulted;
        pool.liquidity += loan.collateral;
        pool.defaultedPrincipal += loan.principal;
        pool.defaultCount += 1;
        profile.loansDefaulted += 1;

        emit LoanDefaulted(loanId, loan.borrower, loan.collateral);
    }

    function issueScoreAttestation(uint16 threshold) external returns (bytes32 attestationId) {
        CreditProfile storage profile = profiles[msg.sender];
        if (threshold < MIN_SCORE || threshold > MAX_SCORE) revert InvalidScore();
        if (profile.scorePublishedAt == 0 || profile.publicScore < threshold) revert AttestationUnavailable();

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
        return
            attestation.owner == owner &&
            attestation.threshold >= threshold &&
            attestation.scoreAtIssue >= threshold &&
            attestation.issuedAt != 0 &&
            !attestation.revoked;
    }

    function encryptedScoreOf(address account) external view returns (euint32) {
        return encryptedScores[account];
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
        uint256 denominator = pool.liquidity + pool.totalBorrowed - pool.totalRepaid;
        if (denominator > 0) {
            utilizationBps = uint16(((pool.totalBorrowed - pool.totalRepaid) * BPS) / denominator);
        }
        if (pool.loanCount > 0) {
            averageScore = uint16(pool.borrowerScoreTotal / pool.loanCount);
            defaultRateBps = uint16((uint256(pool.defaultCount) * BPS) / pool.loanCount);
        }
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

    function _interestFor(uint256 amount, uint16 interestBps, uint32 durationSeconds) private pure returns (uint256) {
        return (amount * interestBps * durationSeconds) / (uint256(BPS) * 365 days);
    }

    function _sendValue(address payable recipient, uint256 amount) private {
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }
}
