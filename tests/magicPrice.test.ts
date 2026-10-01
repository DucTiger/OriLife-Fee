import { describe, expect, it } from "vitest";
import { type PriceParam, Q, assertPriceFresh, requiredNanogic } from "../src/magicPrice.js";

// Test beacons. These numbers are fixtures, not prices: they are copied from MAGIC's own test
// `ConsumeMAGIC/tests/consume_required.test.ts` at MagicLampEco/MAGIC origin/main 4f5b86db, so the
// expected values below are the values MAGIC's `requiredFromBeacon` produces for the same inputs.
const beacon: PriceParam = {
  op_prices: [
    { op_type: 1n, base_price: 3_000_000n, demand_mult: 1_000_000_000n },
    { op_type: 2n, base_price: 500_000n, demand_mult: 1_000_000_000n },
  ],
  m_min: 500_000_000n,
  m_max: 2_000_000_000n,
  epoch: 6n,
};

// MAGIC's normative parity vector ("== Aiken required_fold_floor_no_undercharge"):
// base = 1e6, demand = 1_333_333_333, count = 1000.
const parityBeacon: PriceParam = {
  op_prices: [{ op_type: 1n, base_price: 1_000_000n, demand_mult: 1_333_333_333n }],
  m_min: 500_000_000n,
  m_max: 2_000_000_000n,
  epoch: 6n,
};

describe("requiredNanogic — MAGIC formula, values from MAGIC's tests", () => {
  it("reads base_price from the beacon: 3_000_000 × Q × 5 / Q = 15_000_000", () => {
    expect(requiredNanogic(beacon, 1, 5n)).toBe(15_000_000n);
  });

  it("op_count = 1 is the lower bound and prices normally", () => {
    expect(requiredNanogic(beacon, 1, 1n)).toBe(3_000_000n);
  });

  it("parity vector: fold-then-floor once gives 1_333_333_333", () => {
    expect(requiredNanogic(parityBeacon, 1, 1000n)).toBe(1_333_333_333n);
  });

  it("flooring per unit would give a different, smaller number on the same input", () => {
    // The wrong formula, computed here only to show the vector discriminates between the two.
    const row = parityBeacon.op_prices[0]!;
    const perUnitFloor = ((row.base_price * row.demand_mult) / Q) * 1000n;
    expect(perUnitFloor).toBe(1_333_333_000n);
    expect(requiredNanogic(parityBeacon, 1, 1000n)).not.toBe(perUnitFloor);
  });
});

describe("requiredNanogic — rejections", () => {
  it("throws when the beacon has no row for the op type", () => {
    expect(() => requiredNanogic(beacon, 99, 1n)).toThrow(/no row for op_type 99/);
  });

  it("throws on op_count 0 and negative", () => {
    expect(() => requiredNanogic(beacon, 1, 0n)).toThrow(/op_count must be ≥ 1/);
    expect(() => requiredNanogic(beacon, 1, -3n)).toThrow(/op_count must be ≥ 1/);
  });

  it("throws when the beacon has two rows for the op type", () => {
    const dup: PriceParam = {
      ...beacon,
      op_prices: [beacon.op_prices[0]!, { op_type: 1n, base_price: 10_000_000n, demand_mult: Q }],
    };
    expect(() => requiredNanogic(dup, 1, 1n)).toThrow(/2 rows for op_type 1/);
  });
});

describe("assertPriceFresh — mirrors consume.ak's stale-price check", () => {
  it("accepts the beacon's own epoch and exactly max_price_stale epochs later", () => {
    expect(() => assertPriceFresh(beacon, 6n, 2n)).not.toThrow();
    expect(() => assertPriceFresh(beacon, 8n, 2n)).not.toThrow();
  });

  it("rejects one epoch beyond max_price_stale", () => {
    expect(() => assertPriceFresh(beacon, 9n, 2n)).toThrow(/3 epochs old/);
  });

  it("rejects a beacon from the future", () => {
    expect(() => assertPriceFresh(beacon, 5n, 2n)).toThrow(/ahead of the current epoch/);
  });
});
