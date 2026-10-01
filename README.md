# @orilife/fee

**OriLife services are priced in MAGIC. Network fees are paid in ADA.** This repository does not
implement that pricing. It holds two earlier prototypes of fee settlement. Their code and tests
still price in LAMP and in a test token, as described below. They are kept for their tests and
because testnet addresses built from them still hold assets.

## Where pricing happens

- **Quantities, not prices, come from OriLife.** Every billable OriLife API response carries an
  `op_declaration` field: the measured quantity of each MAGIC operation type the task used (images
  processed, CIDs anchored, …). It carries no MAGIC amount. The source is
  `MasterIdentify/core/magic_ops.py` in `OriLife-Core`, and the field is documented in
  `MOBILE-API-CONTRACT.md` §14.6-bis.
- **The price comes from MAGIC's price beacon** when the transaction is built. The charge is a
  `ConsumeMAGIC` transaction on MAGIC's contracts, signed by the user from their own MAGIC vault;
  OriLife's server cannot sign it. A user obtains MAGIC by buying credit or by holding LAMP that
  generates it.
- **The Cardano network fee is ADA.**

Those same responses also still carry a legacy `fee_quote` (`MOBILE-API-CONTRACT.md` §14.6). It is
denominated in LAMP and ADA and comes from the same prototype pricing model as this repository
(`animal_fee.quote_fee` in `OriLife-Core`). It is an estimate: no code in `OriLife-Core` collects
it.

## Why this repository says LAMP

The first prototype (July–August 2026) priced a task in USD, converted the amount to LAMP at an
oracle rate, and deposited the LAMP into the LAMP Treasury custody contract on Preview. That was
the working model at the time. `src/feeEngine.ts` (`fee_oil = fee_usd / lampUsd × OIL_PER_LAMP`)
and the `feeLamp` field of `FeeQuote` still implement it, and the rest of this file describes that
code as it is.

## What this repository contains

| Layer | Settles in | Network | Where |
|---|---|---|---|
| Quote engine + Collect bridge | LAMP ("oil", its smallest unit) | Preview | `src/`, `e2e/`, `scripts/*_preview.ts` |
| Fee vault + donation escrow | `tCARP`, a test stand-in for CARP | Preprod | `onchain/`, see [`onchain/README.md`](onchain/README.md) |

Neither layer is on the path described in "Where pricing happens".

### Quote engine + Collect bridge (LAMP, Preview)

A task (register a tree, run an identity scan, anchor on-chain) goes to `quoteFee`, which prices it
in LAMP and splits the amount across three buckets (PROTOCOL / LAMPNET_REWARD / ANCHOR).
`buildFeeCollectTx` then builds one Collect transaction that deposits the whole fee into the
treasury. The `custody.custody.spend` Plutus validator enforces `Σout = Σin`: LAMP has a fixed
supply and is never burned.

The **core** part of this layer needs nothing external. The **bridge** part needs the LAMP
repository, which is not public today.

| | Needs LAMP? | Contains |
|---|---|---|
| **Core** | no | `feeEngine` (pricing) · `bridge` (invariants) · `buckets` · `tasks` |
| **Bridge** | yes | `treasuryClient` · `e2e/` · `scripts/*_preview.ts` |

#### Running the core part — clone and go

```bash
npm install
npx tsc --noEmit -p tsconfig.core.json
npx vitest run tests/feeEngine.test.ts tests/bridge.test.ts tests/custodyAddress.test.ts
```

This is exactly what the CI gate runs (`.github/workflows/ci.yml`, job `core`). The gate states
what it does **not** cover, so that one green check does not imply coverage it never had.

#### Running both parts — needs the LAMP repository on disk

```bash
bash scripts/pin-lamp.sh    # materialises vendor/lamp, pinned to commit ebafc2e1
npm test
npm run typecheck
npm run e2e:emulator        # prints the evidence: 1 Collect tx, 8 invariants, a real txHash
```

`scripts/pin-lamp.sh` **pins** LAMP to exactly one commit instead of following HEAD. The reason is
at the top of that file; read it before touching anything. Commit `ebafc2e1` is the last commit
that still matches `vendor/treasury-custody.plutus.json`, i.e. the custody instance already
deployed on Preview, and that address holds assets. Rebuilding the blueprint against a newer LAMP
changes the script hash, which changes the address, which means losing the ability to spend what
is sitting there.

`vendor/lamp/` is in `.gitignore`: this repository pins another repository's commit; it does not
copy that repository's code.

#### Architecture

```
quoteFee (feeEngine) ──FeeQuote──▶ quoteToCollectItems (bridge) ──CollectItem[]──▶
  buildFeeCollectTx (treasuryClient) ──▶ buildCollectTx (@magiclamp/treasury-sdk) ──▶
  custody.ak Collect validator ──▶ custody UTxO: value += feeOil, 3-bucket ledger += oil
```

`src/params|buckets|tasks|feeEngine|bridge` is pure off-chain code, and its tests do not need the
LAMP repository. Only `treasuryClient` and `e2e/` touch the Treasury SDK.

### Fee vault + donation escrow (tCARP, Preprod)

This layer is a prototype of one specific guarantee: a fixed share of fee inflow must be paid to
the Cardano treasury, and the contract, not an operating procedure, enforces it. It uses
`treasury_donation`, a Conway-era transaction body field. Its unit is `tCARP`, a single-signature
test token, because CARP has not been issued. The design, the invariants, and the transactions
already run on Preprod are in [`onchain/README.md`](onchain/README.md).

## Documentation

`OriLife-Specs/Fee/` (`FeeMechanism-CONTRACT.md` · `-FEAT.md` · `-MATH.md` · `-TECH.md` ·
`-EXEC.md`) describes the LAMP prototype above, not MAGIC pricing. Build report and review notes:
`AUDIT.md`. Current state of each part: `STATUS.md`.
