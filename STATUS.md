# STATUS — measured 2026-10-02

Measured on the tree of the last commit that touched `src/`
(`git log -1 --format=%h -- src/`). Every count below carries the command that takes
it again: a bare number in this file has no way to learn that its subject moved, and this file has
carried both stale and never-true counts before (see "History").

## What the repository holds

| Part | Where | State |
|---|---|---|
| MAGIC pricing, OriLife side | `src/`, `tests/` | parse `op_declaration`, quote against a PriceParam beacon datum, plan ConsumeMAGIC — pure code |
| Fee vault + donation escrow | `onchain/` | tCARP prototype on Preprod — unchanged by the MAGIC rewrite |
| LAMP prototype | removed; record in `docs/lamp-prototype.md` | Preview custody address still holds assets |

## Checks — 2026-10-02

```
npx tsc --noEmit -p tsconfig.core.json   → exit 0
npx tsc --noEmit                          → exit 0
npx vitest run                            → 60 / 60 pass, 3 files
```

`tsconfig.core.json` now extends `tsconfig.json` and covers the same files: the split existed only
because the LAMP bridge layer needed another repository on disk. CI runs the first and third
commands (`.github/workflows/ci.yml`, job `core`), so the gate and a local run see the same tests.

Mutations run against the suite on 2026-10-02, each with its own marker in the mutated line and
the whole suite run again; every one turned it red:
- flooring per unit instead of once per line (`requiredNanogic`, 3 red), and reporting an absent
  declaration as `no_charge` (`planConsume`, 4 red);
- `anomaly` no longer winning over `policy_partial`; `reason` no longer required on `pending` or on
  `missing`; an absent `pending` read as empty; an absent `not_applicable` thrown on (each 1 red);
- a replay planned with no lines (2 red); a zero price allowed; a negative operand allowed;
  `priceEpochAt` rounding up (each 1 red);
- the multi-line hold removed (3 red); a multi-line replay escaping the hold; a replay checked
  before `ops: []`; code 3 accepted in `ops`; the whole `/api/identify/auto` body read as "not
  declared"; `not_applicable` left out of the duplicate check; an empty `reason` on
  `not_applicable` accepted; an empty `unit` accepted; `op_type` above 2^53 − 1 accepted (each 1
  red).

## What the tests do not pin

- **The formula is a copy.** `requiredNanogic` mirrors MAGIC's `requiredFromBeacon` and on-chain
  `required_for` at MAGIC `origin/main` `4f5b86db`. The parity vector in `tests/magicPrice.test.ts`
  is copied from MAGIC's own test, so it pins this copy to MAGIC's value **as of that commit**. If
  MAGIC changes its formula, nothing here turns red.
- **The declaration shape is a copy.** `parseOpDeclaration` follows OriLife-Core
  `MOBILE-API-CONTRACT.md` §14.6-bis at Core `origin/main` `dca31f3`. A shape change in Core shows
  up as a thrown error at runtime, not as a red test here.
- **Beacon validity is only partly re-checked.** `requiredNanogic` rejects a missing or duplicated
  row, a negative operand and a zero result, but not the other `valid_param` rules (band, ceiling,
  ordering); a beacon that breaks them is rejected by the chain, not here.
- **A task with more than one `ops` line is held, not charged.** One task is one ConsumeMAGIC
  transaction, and the redeemer that carries several pairs does not exist yet. When it does, the
  hold is replaced by a plan for that transaction, priced the way MAGIC floors several pairs.
- **Whether a replay was already consumed for is not decided here.** `replay` keeps its lines and
  amounts; the decision needs the app's own record keyed by `client_event_id`, which this package
  does not hold.

## Onchain (`onchain/`) — carried over from the 2026-09-21 measurement

1. `onchain/orilife_treasury/validators/fee_vault.ak` and `donation_escrow.ak`, merged in `2b35232`
   on 2026-08-21, driven by `onchain/scripts/01_mint_test_carp.mjs` through `06_close_vault.mjs`.
2. `onchain/scripts/deployed_preprod.json` records a lifecycle executed end to end on Preprod —
   mint, open, collect, skim, donate, close — each step with its transaction hash. Its `previous`
   block records an earlier validator revision with no `Close` branch, where every branch forced
   `lovelace_of(out) >= lovelace_of(in)`: 5,000,000 lovelace at `addr_test1wrxmzy4…` cannot be
   withdrawn by any redeemer. The 900,000 tCARP at the same address are not stranded — `Operate`
   still spends those. The current revision has `Close`.
3. `onchain/scripts/*.mjs` import `@lucid-evolution/lucid` from this repository's root
   `package.json`; that is the only reason the dependency is still there.

## History

- **Until 2026-10-02** the repository priced tasks in LAMP: `src/feeEngine.ts` and friends, a
  bridge into a LAMP Treasury custody contract on Preview, pinned to LAMP commit `ebafc2e1` by
  `scripts/pin-lamp.sh`. All of it is at commit `fef2ee2`; `docs/lamp-prototype.md` records the
  custody address and its assets.
- **2026-09-21** (`a21c7a9`): this file was rewritten to attach a command to every count after two
  failures — counts that went stale when tests were added (`54 / 54`, `57 / 57`), and a file count
  that had never been true (16 stated, 17 at every commit). Both are why the counts above carry
  their commands.
- **2026-09-14**: this file said the CARP validator lived on an unmerged branch; it had been merged
  two commits later and the branch was deleted by 2026-09-21. For the current state, read the tree
  (`git ls-tree -r HEAD onchain/`), not a paragraph naming a branch.

OriLife agent
