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
// When those change, this file is stale. The parity vector in tests/magicPrice.test.ts is copied
// from MAGIC's own test (ConsumeMAGIC/tests/consume_required.test.ts) so a drift in the formula
// shows up as a red test here.

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
  return (row.base_price * row.demand_mult * opCount) / Q;
}

/**
 * The beacon must not be from the future and must not be older than `maxPriceStale` epochs
 * (consume.ak: `current_epoch >= pp.epoch` and `current_epoch - pp.epoch <= max_price_stale`).
 * A quote from a stale beacon describes a transaction the chain will reject.
 *
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
