# ShieldScore — Full Breakdown

## What Is It, In Plain English?

Right now, if you want to borrow money in DeFi, you have to lock up MORE than you're borrowing. Want $1000? Lock $1500 first. That's like a bank saying "give us your car before we give you a loan." It's backwards and it exists because DeFi has no way to know if you're trustworthy without seeing all your financial data — which nobody wants public on a blockchain.

ShieldScore fixes this. It's a protocol that figures out how creditworthy you are **without ever seeing your actual financial data.** Your data goes in encrypted, a score comes out, and nobody — not the lender, not the protocol, not even the blockchain — ever sees your raw numbers. Only the final score is revealed.

That's only possible because of Fhenix's FHE (Fully Homomorphic Encryption), which can do math on encrypted data. Think of it like this — imagine someone calculating your average salary without ever being allowed to open the envelope containing your payslip. FHE makes that mathematically possible.

---

## The Core Problem It Solves

| Problem | Today | With ShieldScore |
|---|---|---|
| Borrowing in DeFi | Lock $1500 to borrow $1000 | Borrow based on your score, less collateral |
| Financial privacy | Your wallet history is fully public | Data stays encrypted always |
| Institutional adoption | Banks won't touch public-chain data | Compliant, private rails |
| Credit without identity | Impossible on-chain | Score derived from encrypted history |

---

## How It Actually Works — Technical Flow

Here's the step by step of what happens under the hood:

**Step 1 — Data Submission**
You connect your wallet and submit encrypted snapshots of your financial data. This could be things like your average wallet balance over 6 months, your repayment history on other protocols, your income stream consistency, and your DeFi activity. None of this is stored in plaintext anywhere.

**Step 2 — Encrypted Computation**
The Fhenix smart contract receives your encrypted data and runs a scoring algorithm directly on the ciphertext. The contract adds weights, applies thresholds, computes a final number — all while your data stays encrypted. The contract never decrypts it mid-process.

**Step 3 — Score Output**
Only the final credit score (say, a number between 300–850, just like a FICO score) is revealed. Nothing else. The lender sees "this wallet has a score of 720" and nothing more.

**Step 4 — Loan Eligibility**
Lenders set minimum score thresholds in their pools. If your score meets the threshold, you can borrow with reduced collateral — or in advanced versions, no collateral at all for small amounts.

**Step 5 — Repayment Tracking**
Repayments are tracked on-chain and fed back into your encrypted profile, improving your score over time — just like a real credit history builds up.

---

## User POV — What Does a Real Person Actually Experience?

### Borrower Journey

You open the ShieldScore app. First thing you see is a clean dashboard that shows your current credit score (or prompts you to generate one if you're new).

You click **"Generate My Score"** and connect your wallet. The app pulls your on-chain history — wallet age, past protocol interactions, balance history — and encrypts it client-side using the Fhenix SDK before sending it to the contract. You never upload raw data. It's encrypted on your device before it leaves.

A few seconds later your score appears. Let's say it's 680. The app shows you a breakdown — not of your raw data, but of which categories helped or hurt your score. Something like:

- Wallet age: ✅ Strong
- Repayment history: ✅ Good
- Balance consistency: ⚠️ Moderate
- Protocol diversity: ✅ Good

You then go to the **Lending Marketplace** tab. You can see available pools from lenders, each showing their minimum score requirement and their loan terms. You qualify for pools requiring 650+ score.

You pick a pool, say you want to borrow 500 USDC. Instead of locking 750 USDC as collateral, you only need to lock 200 USDC because your score covers the rest of the risk. You confirm the transaction, sign with your wallet, and the USDC lands in your wallet.

You pay it back in 30 days. Your score goes up to 695. Next time you need less collateral.

---

### Lender Journey

You're a lender with 10,000 USDC sitting idle. You open ShieldScore and go to the **Create Pool** tab. You set your parameters:

- Minimum credit score: 650
- Loan duration: 30 days
- Interest rate: 8% APY
- Max loan size per borrower: 1000 USDC
- Collateral requirement: 40% (instead of the usual 150%)

You deposit your USDC into the pool contract. From this point the protocol handles everything. Borrowers whose encrypted scores meet your threshold can draw from your pool automatically. You earn interest on every loan. You never see any borrower's personal data — just their score and their repayment status.

---

## Full Feature List

### Core Features

**Encrypted Credit Scoring Engine**
The heart of the protocol. Takes encrypted financial snapshots and produces a single score. Built in Solidity using Fhenix's encrypted types. The algorithm weights multiple factors — balance history, repayment track record, wallet age, protocol activity, and income stream consistency.

**Score Dashboard**
A clean UI showing your score, your score history over time (as a graph), and a category breakdown telling you what's helping and hurting your score. No raw data shown anywhere, to anyone.

**Lending Marketplace**
A permissionless marketplace where lenders create pools with their own parameters. Borrowers browse pools they qualify for based on score. Think of it like a DeFi Aave but where your score determines your access tier instead of your collateral ratio.

**Tiered Collateral System**
Instead of a binary "collateralized or not," ShieldScore has tiers:

- Score 300–499: Standard overcollateralization (150%)
- Score 500–599: Reduced collateral (100%)
- Score 600–699: Low collateral (50%)
- Score 700–799: Minimal collateral (25%)
- Score 800+: Near-zero collateral for small loans

**Repayment History Tracker**
Every repayment (on time or late) is recorded and fed back into your encrypted profile, building your score over time. Late repayments hurt your score. Early repayments help it.

**Score Attestation (Shareable Proof)**
You can generate a cryptographic attestation of your score — a proof that says "this wallet has a score above X" without revealing the exact score. You can share this attestation with other protocols that want to gate access based on creditworthiness.

**Lender Risk Dashboard**
Lenders see aggregate pool health metrics — default rates, average borrower score in their pool, total interest earned, utilization rate. No individual borrower data exposed.

**Privacy-Preserving Data Inputs**
Integration with Privara SDK for payment history data. Supports importing encrypted history from multiple chains. Client-side encryption before any data leaves the user's device.

---

## How the Fhenix Integration Is Load-Bearing

This is important for the judges — FHE isn't cosmetic here. The entire value proposition collapses without it:

- If scoring was done off-chain (like an oracle), the oracle sees your data. Privacy gone.
- If scoring was done with ZK proofs, you can prove facts about data but can't run arbitrary computation on it. Can't build a flexible scoring algorithm.
- If scoring was done on a regular smart contract, the data is public on chain. Privacy gone.

FHE is the only primitive that lets you run a scoring algorithm on data that stays encrypted the whole time. ShieldScore is therefore a native FHE use case, not a "we added FHE as a feature" use case. That distinction will matter to the Fhenix team when evaluating.

---

## Why This Wins the Buildathon

The judges are evaluating on Privacy Architecture, Innovation, UX, Technical Execution, and Market Potential. ShieldScore hits all five:

**Privacy Architecture** — FHE is structurally necessary. Without it the product doesn't exist. That's the strongest possible answer to this criterion.

**Innovation** — Undercollateralized on-chain lending based on encrypted credit scoring doesn't exist yet. This isn't a variation of something existing.

**UX** — The borrower and lender flows are familiar (similar to Aave/Compound) which means low learning curve. The privacy is invisible to the user — it just works.

**Technical Execution** — Scoped enough to actually build. Wave 4 you prove the encrypted scoring math. Wave 5 you add the lending marketplace and score dashboard.

**Market Potential** — This is enormous. The global credit market is $10+ trillion. DeFi has been stuck on overcollateralization since day one. Institutions that want on-chain exposure but can't do public credit checks would pay for this infrastructure.

---

 