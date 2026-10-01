# AUDIT — orilife-fee

## 2026-10-02 — MAGIC pricing replaces the LAMP prototype

OriLife services are priced in MAGIC; network fees are paid in ADA. The LAMP quote engine and
bridge were removed and replaced by three pure modules: `src/opDeclaration.ts` (parse
`op_declaration`, OriLife-Core contract §14.6-bis), `src/magicPrice.ts` (`requiredNanogic`,
`assertPriceFresh`, mirrored from MAGIC `origin/main` `4f5b86db`), `src/consumePlan.ts` (plan and
quote ConsumeMAGIC). Current checks, what the tests do not pin, and the mutations run against
them: `STATUS.md`.

Design points a reviewer should check:

- **No price lives in this repository.** Every amount is computed from a PriceParam beacon datum
  passed in by the caller. The only constants are `NANOGIC_PER_MAGIC` and `Q` (both 10⁹), copied
  with their source.
- **Fold, then floor once per line.** Flooring per unit under-charges, and the vault burn must
  equal the required amount, so the transaction would be rejected.
- **Absent is not free.** A response without `op_declaration` plans as `not_declared`, a distinct
  kind from `no_charge` (`ops: []`); `replay` is distinct from both.
- **Malformed throws.** `parseOpDeclaration` rejects `op_count` that is 0, negative, fractional or
  above 2⁵³ − 1, an unknown `coverage`, a `coverage` inconsistent with `pending`/`missing`, a unit
  that does not match a known op code, a count on a non-`ops` line, and an op code that appears
  twice.

`onchain/` was not touched by this change.

---

The sections below are the audit of the **LAMP prototype** (built 2026-06-09, re-measured
2026-08-21), kept as history. The code they describe was removed on 2026-10-02 and is at commit
`fef2ee2`; file names, test counts and commands below refer to that commit, not to the current tree.

**Scope then:** the pricing core for OriLife user task fees, plus the bridge that deposits the
resulting LAMP into treasury buckets, demonstrated by one real Collect transaction through the
`custody.custody.spend` Plutus validator.

---

## 1. What was in the repository (LAMP prototype)

### Code (`orilife-fee/`)
| File | Role |
|---|---|
| `src/params.ts` | DAO-governed economic constants plus their safety bounds (lampUsd, cut, resource split, caps) |
| `src/buckets.ts` | Treasury bucket taxonomy (PROTOCOL / LAMPNET_REWARD / ANCHOR ↔ category 0/1/2) |
| `src/tasks.ts` | Catalogue of 9 tasks, their pricing profiles, and bounded DAO setters |
| `src/feeEngine.ts` | `quoteFee` (pricing), `splitOil` (bucket split), `demandFactorFromSignals`, `DemandController` |
| `src/bridge.ts` | `quoteToCollectItems`, `assertBridgeInvariants`, `utf8ToHex` — the interface contract into Treasury |
| `src/treasuryClient.ts` | `buildFeeCollectTx` — calls LAMP Treasury's real `buildCollectTx` |
| `src/index.ts` | Barrel export |
| `e2e/harness.ts` | Reusable emulator harness (1 collect and N collects through the real validator) |
| `e2e/collect_emulator.ts` | Prints the evidence |
| `tests/feeEngine.test.ts` | 44 tests: pricing, conservation, DAO bounds, bigint behaviour |
| `tests/bridge.test.ts` | 7 tests: the bridge contract |
| `tests/custodyAddress.test.ts` | 3 tests: the vendored blueprint still derives the deployed address |
| `tests/emulator.integration.test.ts` | 3 tests: real transactions through the Plutus validator, including multi-collect |
| `vendor/treasury-custody.plutus.json` | The custody blueprint this repository is pinned to |
| `scripts/pin-lamp.sh` | Materialises `vendor/lamp` at the LAMP commit matching that blueprint (reads LAMP, never writes to it) |

### Documentation (`OriLife-Specs/Fee/`)
`FeeMechanism-CONTRACT.md` (the backbone), `-FEAT.md`, `-MATH.md`, `-TECH.md`, `-EXEC.md`.

---

## 2. How it works

1. **Pricing** (`feeEngine.quoteFee`): fee in USD = `(base + valueAdd) × demand × anchorTier ×
   eventMult`, clamped to `≤ min(0.5 × traditional cost, 100 USD)`; the USD→oil conversion is
   **pure bigint** (deterministic, no float overflow). The result is split across 3 buckets, with
   ANCHOR absorbing the remainder so that `Σ buckets = feeOil` exactly.
2. **Bridge** (`bridge` + `treasuryClient`): a FeeQuote becomes `CollectItem[]` — one item per
   bucket, `category` = bucket, `amount` = oil. Invariants are checked (cut_bps = 10000, sums
   match, asset ∈ accepted) before `buildCollectTx` is called.
3. **On-chain**: the OriLife custody instance runs `cut_bps = 10000`, so `cut = amount` and the
   entire fee lands in the treasury, split three ways inside a single transaction (one custody
   input, one custody output). The Collect branch of `custody.ak` enforces C-MINT-0 and
   C-COL-1..5: nothing burned, `Σout = Σin`, and the ledger increases by `Σcut` in the right
   bucket.

---

## 3. Red-team findings and what was done about them

Two independent red-team passes. The "Status" column says what the code actually does today, not
what was intended.

| ID | Severity | Finding | Status |
|---|---|---|---|
| H-1 | High | `demandFactor` arrives as an argument, so a caller could pin it to 0.5 and pay the minimum; the EMA is not wired | **PARTIAL.** The field is documented as TRUSTED SERVER INPUT and `DemandController` exists as a server-side source — but nothing outside `src/feeEngine.ts` and its own tests calls it, so today the guarantee rests entirely on the API layer rejecting the field. That layer is not in this repository. |
| H-2 | High | MAGIC consumed/generated signals are unauthenticated | **DEFERRED to v1.1** (wire the MAGIC AppEconomics oracle). Recorded as a gap in `-EXEC.md`. |
| H-3 | High | `feeOil` went through float64 → non-deterministic, and lossy above 2⁵³ | **FIXED**: pure bigint (`feeUsdMicro × OIL / lampUsdMicro`). |
| M-1 | Medium | Unbounded DAO setters → denial of service (lampUsd ≈ 0) or negative fees | **FIXED**: `daoSetLampUsd` clamps to [10⁻⁶, 10⁶]; `daoSetTask` forces fields ≥ 0 and valueBps ≤ 1000. |
| M-2 | Medium | The cap was anchored to a self-declared traditionalCost — a tautology | **FIXED**: added the absolute ceiling `MAX_FEE_USD_ABSOLUTE = 100`. |
| M-3 | Medium | `RESOURCE_SPLIT_BPS.anchor` was unused, and a skewed split was silent | **FIXED**: `assertResourceSplitSound()` enforces Σ = 10000 at load time. |
| L-1 | Low | A caller could downgrade `anchorTier` to no_anchor to dodge the anchoring fee | **FIXED**: on-chain tasks lock the tier at ≥ defaultAnchorTier. |
| L-2 | Low | `feeOil = 0` let a task through free | **FIXED**: floor `MIN_FEE_OIL = 1000` whenever feeUsd > 0. |
| L-3 | Low | cut_bps = 10000 was only enforced off-chain | Documented in CONTRACT: deployment must verify cut_bps, and every path goes through `assertBridgeInvariants`. |
| B1 | Medium | The mirrored `CollectItem` used `as`, which would hide a type drift silently | **FIXED**: compile-time type-equality assertion (`_ItemCompat`). |
| B2 | Medium | No multi-collect test, so the incremental-ledger branch was untested | **FIXED**: `runEmulatorMultiCollect` plus a 2-collect test through the real validator. |
| B3 | Low | The asset was not checked against accepted_assets | **FIXED**: `BRIDGE-004` in `buildFeeCollectTx`. |

Axes examined and found sound, with no change made: conservation `Σ = feeOil` (proved in MATH §5),
the floor against under-declaring, `utf8ToHex`, `itemCut(_, 10000) = amount`, and no dependence on
iteration order.

### Found later, by review of the pull request itself

- **The CI gate does not cover the money-spending layer.** `tsconfig.core.json:29-30` excludes
  `src/treasuryClient.ts`, and CI cannot run the emulator tests without LAMP. This was proved by
  deliberately breaking that file: the two steps of the `core` job still returned exit 0 and
  51 passed. Partly closed by `tests/custodyAddress.test.ts`, which pins the deployed address
  without needing LAMP. The rest is stated openly in the job output rather than papered over.
- **`scripts/02_collect_preview.ts` used to check its invariants after submitting**, and compared
  a *cumulative* ledger against a *single* quote — so the next run would always have thrown after
  the money had already moved. Now it checks before submitting, reconciles by delta, and its
  failure message says plainly that the transaction has already settled and must not be re-run.
- **`scripts/pin-lamp.sh` used to pin by a 7-character name and verify itself in a circle**, and
  it registered a worktree inside the LAMP repository. It now pins by the full 40-character hash,
  verifies by content, and uses `git archive`, which leaves the source repository untouched.

---

## 4. Evidence

```
npx tsc --noEmit                          → clean (needs vendor/lamp)
npm test                                  → 57 tests pass, 4 files
npm run e2e:emulator                      → one real Collect through the Plutus validator,
                                            8 invariants, a real txHash
```

The integration tests run real transactions through `custody.custody.spend` in the Lucid Emulator,
with no wallet, faucet, or Blockfrost needed: the LAMP fee is deposited into 3 buckets, value is
conserved (`Σout = Σin`), and the ledger accumulates correctly across 2 transactions.

What CI runs is the narrower LAMP-free subset — see `STATUS.md` for both numbers side by side.

---

## 5. Deploying to Preview

See TECH §6. You need a Preview wallet holding tADA and a Blockfrost Preview key, both read from
environment variables (`WALLET_SEED`, `BLOCKFROST_KEY` — see `.env.example` and
`scripts/config_preview.ts`), plus test LAMP minted and a custody instance deployed with
`cut_bps = 10000`. The pricing core and the bridge are used unchanged; only the emulator is
swapped for the Blockfrost provider and a real wallet.

---

## 6. Open items and remaining risk

- **The blueprint is vendored, and that is by design on both sides.** An earlier version of this
  file claimed LAMP's committed `Treasury/onchain/plutus.json` was stale. That was wrong: LAMP does
  not commit that file at all — `LAMP/.gitignore:7,9` excludes `**/onchain/plutus.json` as a build
  artifact, and `git ls-files` finds none. So the blueprint has to come from somewhere, and this
  repository vendors one and pins the LAMP commit that produced it. The real hazard is unchanged
  and is the reason `scripts/rebuild-blueprint.sh` was deleted: re-applying parameters onto a
  blueprint built from different sources changes the script hash and therefore the address.
  Anyone writing similar deploy tooling should check `parameters.length` before applying.
- **Deferred to v1.1**: the LAMP/USD oracle (Score DEX TWAP); authenticating the demand signals
  (H-2); wiring MAGIC ConsumeMAGIC/AppEconomics; paying LampNet nodes through Release + vesting.
- **Integration**: orilife-core (Python) does not call this TypeScript layer yet — neither through
  an HTTP gateway nor as a service. The live fee catalogue is still
  `orilife-core/MasterIdentify/core/animal_fee.py::TASK_CATALOG`.
- **Risk**: the economic parameters here are simulation placeholders, to be set by the DAO later;
  and the absolute cap of 100 USD per task needs DAO confirmation per asset class.

OriLife agent
