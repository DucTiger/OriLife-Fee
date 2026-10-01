// MAGIC price arithmetic for the OriLife side — a mirror of MAGIC's own, not a second price source.
//
// This module holds NO price. Every amount is computed from a `PriceParam` passed in by the caller:
// the datum of MAGIC's price beacon, read from chain at the time the transaction is built.
//
// Copied with a label (the formula and two constants), from MagicLampEco/MAGIC at origin/main
// 4f5b86db4adb98c02996058baf976e7b4b44fde4 (read 2026-10-02):
//   - ConsumeMAGIC/onchain/lib/magiclamp/consume/pricing.ak  `required_for`, `q`
//   - ConsumeMAGIC/offchain/src/consume.ts                   `requiredFromBeacon`
//   - ConsumeMAGIC/onchain/validators/consume.ak             stale-price check (`max_price_stale`)
// When those change, this file is stale and nothing here turns red: the parity vector in
// tests/magicPrice.test.ts is copied from MAGIC's own test (ConsumeMAGIC/tests/
// consume_required.test.ts), so it pins this copy to MAGIC's value as of the commit above only.

/** 1 MAGIC = 10^9 nanogic. */
export const NANOGIC_PER_MAGIC = 1_000_000_000n;

/** Fixed-point scale of `demand_mult` (pricing.ak `q`). Same value as NANOGIC_PER_MAGIC, different
 *  meaning: a `demand_mult` of Q is a multiplier of 1.0. */
export const Q = 1_000_000_000n;

/** One price row — mirror of on-chain `OpPrice` (consume/types.ak) and MAGIC's `OpPriceT`. */
export interface OpPrice {
  op_type: bigint;
  base_price: bigint;
  demand_mult: bigint;
}

/** Datum of the PriceParam beacon — same field names and types as MAGIC's `PriceParamT`, so a
 *  datum decoded by MAGIC's SDK can be passed in unchanged. */
export interface PriceParam {
  op_prices: OpPrice[];
  m_min: bigint;
  m_max: bigint;
  epoch: bigint;
}

export class PriceQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceQuoteError";
  }
}

/**
 * required = ⌊ base_price × demand_mult × op_count / Q ⌋   (nanogic)
 *
 * Multiply everything first, divide ONCE. Flooring the unit price and then multiplying by
 * op_count drops the remainder on every unit; the vault burn must EQUAL the required amount,
 * so an under-count is a rejected transaction (pricing.ak `required_for`, "FIX #1").
 *
 * Throws when op_count < 1 (on-chain `expect op_count >= 1`), when the beacon has no row for
 * opType (no fallback price on the money path), and when it has more than one row for opType
 * (the on-chain `valid_param` rejects such a beacon, so any number computed from it is wrong).
 *
 * Also throws when `base_price` or `demand_mult` is negative (JS BigInt division truncates toward
 * zero, Aiken floors, so the two disagree below zero), and when the result is 0 (on-chain
 * `expect required > 0`; MAGIC's builder throws CONSUME-003) — a zero must never reach the UI as a
 * price. The remaining `valid_param` rules (band, ordering, ceiling) are left to the chain.
 */
export function requiredNanogic(pp: PriceParam, opType: number, opCount: bigint): bigint {
  if (opCount < 1n) {
    throw new PriceQuoteError(`op_count must be ≥ 1, got ${opCount}`);
  }
  const rows = pp.op_prices.filter((p) => p.op_type === BigInt(opType));
  if (rows.length === 0) {
    throw new PriceQuoteError(`price beacon has no row for op_type ${opType}`);
  }
  if (rows.length > 1) {
    throw new PriceQuoteError(`price beacon has ${rows.length} rows for op_type ${opType}`);
  }
  const row = rows[0]!;
  if (row.base_price < 0n || row.demand_mult < 0n) {
    throw new PriceQuoteError(`price beacon row for op_type ${opType} has a negative operand`);
  }
  const required = (row.base_price * row.demand_mult * opCount) / Q;
  if (required <= 0n) {
    throw new PriceQuoteError(`price for op_type ${opType} × ${opCount} is 0; the chain rejects it`);
  }
  return required;
}

/**
 * The epoch number the ConsumeMAGIC validator compares against `pp.epoch`.
 *
 * It is NOT the Cardano epoch number. On-chain it is `hi / ms_per_epoch`, where `hi` is the upper
 * bound of the transaction's validity range in POSIX milliseconds (`util.ak` `get_epoch`); MAGIC's
 * builder computes it the same way from the tip (`consume.ts` `buildConsumeTx`:
 * `tipPosixMs / mspe`). `msPerEpoch` is a parameter of the deployed instance.
 */
export function priceEpochAt(posixMs: bigint, msPerEpoch: bigint): bigint {
  if (msPerEpoch <= 0n) throw new PriceQuoteError(`ms_per_epoch must be > 0, got ${msPerEpoch}`);
  if (posixMs < 0n) throw new PriceQuoteError(`POSIX time must be ≥ 0, got ${posixMs}`);
  return posixMs / msPerEpoch;
}

/**
 * The beacon must not be from the future and must not be older than `maxPriceStale` epochs
 * (consume.ak: `current_epoch >= pp.epoch` and `current_epoch - pp.epoch <= max_price_stale`).
 * A quote from a stale beacon describes a transaction the chain will reject.
 *
 * `currentEpoch` comes from `priceEpochAt` — not the Cardano epoch number, which is on a different
 * scale and would make every beacon look as if it came from the future.
 * `maxPriceStale` is a parameter of the deployed ConsumeMAGIC instance, not of this repository.
 */
export function assertPriceFresh(pp: PriceParam, currentEpoch: bigint, maxPriceStale: bigint): void {
  if (currentEpoch < pp.epoch) {
    throw new PriceQuoteError(
      `price beacon epoch ${pp.epoch} is ahead of the current epoch ${currentEpoch}`,
    );
  }
  if (currentEpoch - pp.epoch > maxPriceStale) {
    throw new PriceQuoteError(
      `price beacon was posted at epoch ${pp.epoch}, now ${currentEpoch}: ` +
        `${currentEpoch - pp.epoch} epochs old, more than the allowed ${maxPriceStale}`,
    );
  }
}
