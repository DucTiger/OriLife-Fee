# @orilife/fee

**OriLife services are priced in MAGIC. Cardano network fees are paid in ADA.** This repository is
the OriLife side of that pricing: it reads the `op_declaration` that OriLife-Core attaches to every
billable response, quotes it against MAGIC's price beacon, and plans the `ConsumeMAGIC`
transactions the user has to sign. Building and signing those transactions is not done here: that
is MAGIC's SDK (`@magiclamp/consumemagic`, `buildConsumeTx`), and the user signs from their own
MAGIC vault. OriLife's server cannot sign it.

The repository also holds `onchain/`, an earlier prototype of fee settlement that pays a fixed
share of fee inflow to the Cardano treasury (see below).

## How a task is charged

1. **OriLife-Core declares quantities, not prices.** Each billable API response carries
   `op_declaration`: the measured quantity of each MAGIC operation type the task used (images
   processed, CIDs anchored, …). It carries no MAGIC amount. Source:
   `MasterIdentify/core/magic_ops.py` in `OriLife-Core`; shape and rules in
   `MOBILE-API-CONTRACT.md` §14.6-bis.
2. **This package turns the declaration into a plan** (`planConsume`, `planConsumeFromResponse`).
   There are five outcomes and they are kept apart:
   - `charge` — `ops` has one line: one `ConsumeMAGIC` transaction (the on-chain `Consume`
     redeemer carries a single op type and count);
   - `multi_line_held` — `ops` has more than one line. One task is one transaction, and a
     transaction carrying several pairs needs a new `ConsumeMAGIC` validator, so the task is not
     charged yet and is never split into one transaction per line. The quote carries no amount.
     With the default Core configuration `ops` has at most one line;
   - `no_charge` — `ops: []`, nothing to consume for this run;
   - `not_declared` — the field is absent: nothing to consume, and the UI must **not** show it as
     free;
   - `replay` — an idempotent replay (`idempotent_replay: true`). The first response may have been
     lost before the consume was made, so the plan and quote keep the lines and amounts; the app
     consumes only if its own record shows no consume for that `client_event_id`. A replay of a
     run with `ops: []` is `no_charge`.

   Code 3 (`storage_event`) in `ops` is refused: Core counts one storage event, not bytes, and
   always lists it under `pending`.
3. **The price comes from the PriceParam beacon** (`quoteConsume`, `requiredNanogic`):
   `required = ⌊ base_price × demand_mult × op_count / Q ⌋` nanogic, multiplied first and floored
   once — the same formula as MAGIC's `requiredFromBeacon` and the on-chain `required_for`. The
   beacon datum is passed in by the caller; this package contains no price. `assertPriceFresh`
   applies the same staleness rule as the `ConsumeMAGIC` validator.
4. **MAGIC's SDK builds the transaction and the user signs it.** The Cardano network fee for that
   transaction is ADA.

Some OriLife-Core versions also return an older `fee_quote` field (§14.6), denominated in LAMP and
ADA. This package does not read it.

## Using it

The package is not built or published yet (`"private": true`, no `exports`); import the source,
`src/index.ts`.

```ts
import { assertPriceFresh, planConsumeFromResponse, priceEpochAt, quoteConsume } from "./src/index.js";

const plan = planConsumeFromResponse(responseBody); // throws if op_declaration is malformed
// The validator's epoch is POSIX ms / ms_per_epoch, not the Cardano epoch number.
assertPriceFresh(priceParam, priceEpochAt(tipPosixMs, msPerEpoch), maxPriceStale);
const quote = quoteConsume(plan, priceParam);
// kind: charge | multi_line_held | no_charge | not_declared | replay
```

For `POST /api/identify/auto` the declaration is at `result.op_declaration`; pass `body.result`.

| Module | Contains |
|---|---|
| `src/opDeclaration.ts` | `parseOpDeclaration` — validates the §14.6-bis shape, throws on anything else |
| `src/magicPrice.ts` | `PriceParam`/`OpPrice` types, `requiredNanogic`, `priceEpochAt`, `assertPriceFresh`, `NANOGIC_PER_MAGIC`, `Q` |
| `src/consumePlan.ts` | `planConsume`, `planConsumeFromResponse`, `quoteConsume` |

Pure code: no I/O, no network, no dependency on another repository.

```bash
npm install
npx tsc --noEmit -p tsconfig.core.json
npx vitest run
```

This is what the CI gate runs (`.github/workflows/ci.yml`, job `core`).

## Fee vault + donation escrow (`onchain/`, tCARP, Preprod)

This is a prototype of one specific guarantee: a fixed share of fee inflow must be paid to the
Cardano treasury, and the contract, not an operating procedure, enforces it. It uses
`treasury_donation`, a Conway-era transaction body field. Its unit is `tCARP`, a single-signature
test token, because CARP has not been issued. The design, the invariants, and the transactions
already run on Preprod are in [`onchain/README.md`](onchain/README.md). CI checks it with
`aiken check` (job `onchain`).

## The earlier LAMP prototype

Until 2026-10-02 this repository also held a LAMP-denominated quote engine and a bridge into a
LAMP Treasury custody contract on Preview. That code has been removed. The custody address it
deployed still holds assets; where they are and how to reach the code that spends them is in
[`docs/lamp-prototype.md`](docs/lamp-prototype.md). `OriLife-Specs/Fee/` (`FeeMechanism-*.md`)
still describes that prototype, not MAGIC pricing.

Current state of each part: `STATUS.md`. Review history: `AUDIT.md`.
