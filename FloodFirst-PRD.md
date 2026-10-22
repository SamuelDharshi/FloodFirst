# FloodFirst: Product Requirements Document

**Hackathon:** Web3 for Social Good Hackathon 2026 (SMU SCIS, GSR Foundation, University of Málaga, on DoraHacks)
**Track:** Idea Track (with a working prototype to support it)
**Status:** Draft v1, written 2026-10-22
**Submission deadline:** Oct 25, 2026 (HackList lists Oct 24; treat Oct 24 as the safe date)
**Shortlist:** Oct 26. **Finals:** Nov 26, SMU Singapore.

> Scores quoted below come from two critic subagents applying the official rubric. They are not the real judges' scores.

---

## 1. Summary

FloodFirst pays flood-prone households **before** a flood peaks. A donor pool pre-funds small voucher tranches that are released automatically when two independent data sources (a flood forecast and a government river gauge) both cross a threshold. The key Web3 feature is a **shared, privacy-preserving nullifier registry** that lets competing NGOs stop paying the same household twice **without revealing their beneficiary lists to each other**.

One-line pitch: *"Anticipatory cash for flood-prone villages, with a shared registry that stops double payments across NGOs without anyone sharing a beneficiary list."*

## 2. Problem

- Post-disaster aid is slow and arrives after the damage is done. Anticipatory (forecast-based) cash is an established humanitarian approach, but disbursement is slow and opaque to donors.
- Multiple NGOs and donors often serve the same villages. Each guards its beneficiary list, so duplicate payments and gaps are hard to detect.
- Existing Web3 aid entries (PRENDICO, OpenRelief, DesiClaim, NovaAid, Mercy Corps + Aleo pilot) focus on identity and payout. The crowded lane means FloodFirst must lead with what is different: the cross-NGO registry and the pre-peak trigger.

## 3. Goals and non-goals

### Goals
1. Release capped voucher tranches to enrolled households when a 2-of-2 oracle trigger fires.
2. Block a second payment to the same household across participating NGOs, without any NGO disclosing its list.
3. Let a household with no wallet and no data connection claim and redeem.
4. Give donors a public, aggregate audit view of flows.
5. State honestly where the system is weak (false positives, enrollment trust, gauge outages).

### Non-goals (for the 72-hour submission)
- Solving digital identity. Dedup holds per household secret and depends on enrollment honesty.
- A production SMS gateway, fiat off-ramp or licensed insurance product.
- Multi-basin coverage. One basin only.
- Actuarial or insurance pricing. Framing is humanitarian grant disbursement through a partner NGO, **not insurance**.

## 4. Users

| User | Need | How FloodFirst helps |
| --- | --- | --- |
| Household in a flood-prone village | Cash before the flood, simple to use, no crypto | Claim code and SMS or QR; no wallet or gas |
| Field agent (NGO staff or volunteer) | Enroll households and issue claim codes quickly | Enrollment app that registers a commitment, not a name |
| Local merchant | Be paid for goods sold against vouchers | Offline redemption of signed vouchers, synced later |
| NGO program manager | Avoid duplicate payments without sharing lists | Shared nullifier registry |
| Donor | See that money moved on a verified trigger and reached households once | Public dashboard with aggregate flows |

## 5. Product scope

### 5.1 Core flow

1. **Pool funding:** several donors or NGOs fund a pool contract.
2. **Enrollment:** a field agent helps a household create its own secret on a basic phone or paper card; only a **commitment** to the secret is added to that NGO's Merkle root. No name, phone number or location goes on-chain.
3. **Trigger:** an oracle quorum checks (a) a flood forecast (GloFAS) and (b) a government river-gauge reading for the basin. Both must cross the threshold. A community report can only **veto or break a tie**, never trigger alone.
4. **Tranche release:** the contract releases one tranche, capped at **30% of the pool**, as vouchers for enrolled households.
5. **Claim:** the household proves membership in an NGO Merkle root and presents a nullifier derived from its secret (`nullifier = H(secret, domain)`, where `domain` is program-agnostic). The registry rejects a nullifier already used for this event.
6. **Redemption:** the household shows a QR or code at a local merchant. The merchant verifies a signed voucher offline and syncs redemptions later.
7. **Expiry:** unspent vouchers expire back to the pool, which caps the cost of a false alarm.
8. **Audit:** the dashboard shows pool balance, trigger events, claims, redemptions and returned funds, all aggregate.

### 5.2 Cross-NGO nullifier registry (the differentiator)

**Design flaw found by the critics and its fix.** If each NGO issues its own claim code and derives the secret from it, one household holding codes from two NGOs has two different secrets and gets paid twice.

**Required design:**
- The **household** generates its own secret once (on a basic phone, or printed on a card by the agent's tool).
- Any NGO enrolls the household by adding a **commitment** `C = H(secret)` to its own Merkle root.
- The nullifier is `H(secret, event_id)` with a program-agnostic domain, so the same household produces the same nullifier regardless of which NGO enrolled it.
- The registry only sees nullifiers and roots. No NGO sees another NGO's list.

**Known limit (state this in the pitch):** a household can create two secrets and enroll once with each of two NGOs. FloodFirst reduces double payment; it does not prove one-person-one-household. Mitigations to discuss: field-agent checks, optional shared local salt, post-hoc reconciliation, and later a lightweight uniqueness anchor.

### 5.3 Oracle quorum

- **Trigger = 2-of-2:** forecast source AND government river gauge.
- **Community reporter:** veto or tie-break only.
- **Gauge outage fallback:** if the gauge is unavailable for a defined window, require a secondary independent source or a designated human operator confirmation, and log it publicly. The exact rule is an open decision (see section 12).
- **Backtest plan:** replay a past Brahmaputra-basin flood through the trigger and report precision, recall and the dollar cost of false positives and missed events.

### 5.4 Offline voucher flow

- Vouchers are signed so a merchant device can verify them **offline**.
- Redemptions are batched and synced when connectivity returns.
- Demo requirement: a real phone in airplane mode completes a redemption.

## 6. Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Pool contract accepts funds from multiple donors and tracks balances | Must |
| F2 | Oracle contract or service evaluates the 2-of-2 trigger and emits a trigger event | Must |
| F3 | Tranche release capped at 30% of pool per event | Must |
| F4 | Merkle-root registration per NGO with household commitments | Must |
| F5 | Claim with membership proof and nullifier; reject a repeated nullifier | Must |
| F6 | Wallet-less claim by code, with SMS delivery mocked in the MVP | Must |
| F7 | Signed vouchers verifiable offline by a merchant page | Must |
| F8 | Merchant redemption sync and a redemption record | Must |
| F9 | Voucher expiry returning funds to the pool | Should |
| F10 | Public donor dashboard with aggregate flows only | Must |
| F11 | Community reporter veto or tie-break | Could |
| F12 | Backtest report on a historical flood | Should |
| F13 | Publicly logged fallback when a data source is down | Should |

## 7. Non-functional requirements

- **Privacy:** no personal data on-chain. Only commitments, roots and nullifiers.
- **Low-tech access:** works for a household with a basic phone and no wallet.
- **Transparency:** every trigger, release, claim and redemption is auditable in aggregate.
- **Cost:** deploy on a low-fee EVM testnet for the demo.
- **Honesty:** the UI and docs state mocked components clearly.

## 8. Suggested architecture and stack (adjust to team skills)

- **Contracts (Solidity, EVM testnet):** `Pool`, `TriggerOracle`, `NullifierRegistry`, `VoucherIssuer`.
- **Membership and nullifier:** Merkle tree plus nullifier. A Semaphore-style circuit is ideal; if a full ZK circuit does not fit in 72 hours, implement Merkle proof plus nullifier checking first and label the proof layer accordingly. Do not claim ZK if it is not running.
- **Oracle service:** small backend that reads the forecast source and the gauge source, applies the quorum, and posts the result. Verify data-source access and licensing before relying on them.
- **Agent and merchant apps:** a lightweight web app (PWA) for enrollment, claim and merchant redemption with offline caching.
- **Dashboard:** read-only web page over contract events.

## 9. What is real vs mocked in the 72-hour MVP

| Component | MVP status |
| --- | --- |
| Rainfall or flood data feed crossing a threshold | **Real** (one basin) |
| Pool, trigger, tranche release contracts | **Real** (testnet) |
| Nullifier registry blocking a second claim | **Real** |
| Offline merchant redemption on a phone in airplane mode | **Real** |
| Donor dashboard | **Real** |
| Village register / Merkle root | Mocked (pretend register) |
| SMS delivery | Mocked |
| Stablecoin and fiat cash-out | Mocked (test token) |
| Anchor NGO partner | Outreach plan only; do **not** claim a letter of interest |

## 10. Demo script (finals and video)

1. Show the basin and the live data feed approaching the threshold.
2. Threshold crossed on both sources; contract releases the first tranche (cap visible).
3. A household with no wallet claims with a code; the registry records the nullifier.
4. A second NGO tries to pay the same household; the registry blocks it, and neither NGO sees the other's list.
5. Phone in airplane mode redeems at a merchant page; sync later.
6. Donor dashboard updates; unspent vouchers expire back to the pool.
7. **Failure case shown on purpose:** a false-positive trigger, its cost under the 30% cap, and how the funds return.

## 11. Mapping to the judging rubric

| Criterion (weight) | How FloodFirst addresses it |
| --- | --- |
| Social impact and problem relevance (30%) | Cash before the flood for vulnerable households; evidence-backed anticipatory approach; honest scope on one basin |
| Solution quality (25%) | Concrete contracts, trigger, registry and offline flow; end-to-end demo |
| Innovation and meaningful use of Web3 (20%) | Cross-NGO dedup without list sharing is the one thing a single database cannot do between mutually distrustful organizations |
| Feasibility and sustainability (15%) | Capped tranches, expiry back to pool, partner outreach plan, legal framing as grant disbursement |
| Presentation and demo (10%) | Airplane-mode redemption and a deliberately shown failure case |

**Critic estimate:** about 70.5 out of 100 (73 and 68), assuming the demo genuinely runs. It drops to roughly 62 if the registry and trigger are only mocked.

## 12. Risks and open decisions

| Risk or decision | Notes |
| --- | --- |
| No real NGO partner yet | Biggest credibility gap. Send outreach now; claim only what you have |
| Enrollment honesty and double secrets | Reduces, does not eliminate, double payment; say so |
| Gauge outage blocks payout | Decide the fallback rule and publish it |
| False-positive triggers | 30% cap and expiry; show cost numbers from the backtest |
| Legal and tax status of vouchers | Frame as humanitarian grant via partner NGO; get advice before any pilot |
| Data-source access and licensing | Confirm GloFAS and gauge data availability for the chosen basin |
| Oracle trust | 2-of-2 reduces single-source control but not collusion; document it |
| Whether one team can enter both tracks | Unconfirmed; check DoraHacks or Telegram |

## 13. Plan (IST, deadline Oct 25; aim to submit Oct 24)

| When | Goal |
| --- | --- |
| Oct 22 | Lock design (commitment-based nullifier). Deploy `Pool` and `NullifierRegistry` to testnet. Send partner outreach. Pick the basin and confirm data access |
| Oct 23 | Trigger service reading real data; tranche release; claim flow with nullifier; voucher signing |
| Oct 24 | Merchant offline redemption, donor dashboard, backtest numbers, record the 3-to-5-minute demo video, write the README, submit |
| Oct 25 | Buffer only |

## 14. After shortlisting (Oct 27 to Nov 25)

- Land a named anchor NGO or practitioner conversation.
- Complete the backtest with precision, recall and cost figures.
- Replace mocks where possible (real enrollment flow with a pilot-style register, SMS gateway sandbox).
- Strengthen the uniqueness story and the oracle fallback.
- Prepare Q&A answers, especially: *"Why would competing NGOs join a shared registry, and who issues the credentials it checks?"*

## 15. Future applications (one sentence in the pitch)

The same primitive, "funds released only on independently verified conditions", extends to machine-verified service (for example community internet uptime) and beneficiary-confirmed delivery (for example school meals). These are roadmap items, not part of this submission.

## 16. Source material

Hackathon details came from the HackathonRadar listing and HackList because DoraHacks blocked direct access. Past-winner patterns and the full critic scoring are in the companion Claude Doc, "Web3 for Social Good 2026: Hackathon Analysis and Top 3 Ideas".
