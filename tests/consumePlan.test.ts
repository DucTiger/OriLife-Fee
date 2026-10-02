import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planConsume, planConsumeFromResponse, quoteConsume } from "../src/consumePlan.js";
import { type PriceParam, Q } from "../src/magicPrice.js";
import { parseOpDeclaration } from "../src/opDeclaration.js";
import { contractExample } from "./fixtures.js";

// Fixture beacon (not a price): base prices match the trial table in MAGIC's
// `ConsumeMAGIC/pricing/src/price.ts` `MVP_PRICE_TABLE` at origin/main 4f5b86db, demand 1.0×,
// except op 4, whose demand is set so that flooring matters.
const beacon: PriceParam = {
  op_prices: [
    { op_type: 1n, base_price: 10_000_000n, demand_mult: Q },
    { op_type: 2n, base_price: 1_000_000n, demand_mult: Q },
    { op_type: 4n, base_price: 1_000_000n, demand_mult: 1_333_333_333n },
  ],
  m_min: 500_000_000n,
  m_max: 2_000_000_000n,
  epoch: 10n,
};

const storageOnly = parseOpDeclaration({
  task_key: "care.log",
  ops: [],
  pending: [{ op_type: 3, unit: "storage_event", reason: "..." }],
  missing: [],
  not_applicable: [],
  coverage: "policy_partial",
});

// `tree.scan` with compute declared (`OLT_MAGIC_DECLARE_COMPUTE=1`): two lines, one task.
const twoLines = parseOpDeclaration({
  task_key: "tree.scan",
  ops: [
    { op_type: 1, op_count: 2, unit: "image" },
    { op_type: 4, op_count: 5, unit: "compute_event" },
  ],
  pending: [],
  missing: [],
  not_applicable: [],
  coverage: "full",
});

describe("planConsume — outcomes stay distinct", () => {
  it("multi_line_held: one task is one transaction, so two lines are held, not split in two", () => {
    const plan = planConsume(twoLines, { idempotentReplay: false });
    expect(plan.kind).toBe("multi_line_held");
    if (plan.kind !== "multi_line_held") throw new Error("unreachable");
    expect(plan.requests.map((r) => r.opType)).toEqual([1, 4]);
  });

  it("multi_line_held wins over replay: a held run was never charged either", () => {
    expect(planConsume(twoLines, { idempotentReplay: true }).kind).toBe("multi_line_held");
  });

  it("a replay of `ops: []` is no_charge: there is no amount to show", () => {
    expect(planConsume(storageOnly, { idempotentReplay: true }).kind).toBe("no_charge");
  });

  it("charge: one line, one ConsumeMAGIC request", () => {
    const plan = planConsume(parseOpDeclaration(contractExample), { idempotentReplay: false });
    expect(plan.kind).toBe("charge");
    if (plan.kind !== "charge") throw new Error("unreachable");
    expect(plan.requests).toEqual([{ opType: 1, opCount: 3n, unit: "image" }]);
  });

  it("no_charge: `ops: []`", () => {
    expect(planConsume(storageOnly, { idempotentReplay: false }).kind).toBe("no_charge");
  });

  it("not_declared: field absent — never reported as no_charge", () => {
    const plan = planConsume(undefined, { idempotentReplay: false });
    expect(plan.kind).toBe("not_declared");
    expect(plan.kind).not.toBe("no_charge");
  });

  it("not_declared wins over replay: with no declaration there is nothing to replay", () => {
    expect(planConsume(undefined, { idempotentReplay: true }).kind).toBe("not_declared");
  });

  it("replay: kept apart from charge, but still carries what was declared", () => {
    // A replay may follow a first response lost in transit (§14.12), so the first run may never
    // have been consumed for. The app decides from its own record; it needs the lines to do so.
    const plan = planConsume(parseOpDeclaration(contractExample), { idempotentReplay: true });
    expect(plan.kind).toBe("replay");
    if (plan.kind !== "replay") throw new Error("unreachable");
    expect(plan.requests).toEqual([{ opType: 1, opCount: 3n, unit: "image" }]);
  });
});

describe("quoteConsume", () => {
  it("prices the contract example against the beacon: 3 images × 0.01 MAGIC = 30_000_000 nanogic", () => {
    const quote = quoteConsume(planConsume(parseOpDeclaration(contractExample), { idempotentReplay: false }), beacon);
    expect(quote).toEqual({
      kind: "charge",
      lines: [{ opType: 1, opCount: 3n, unit: "image", requiredNanogic: 30_000_000n }],
      totalNanogic: 30_000_000n,
      coverage: "policy_partial",
    });
  });

  it("a single line is floored once: 1000 × 1_000_000 × 1.333333333 → 1_333_333_333", () => {
    const decl = parseOpDeclaration({
      task_key: "tree.scan",
      ops: [{ op_type: 4, op_count: 1000, unit: "compute_event" }],
      pending: [],
      missing: [],
      not_applicable: [],
      coverage: "full",
    });
    const quote = quoteConsume(planConsume(decl, { idempotentReplay: false }), beacon);
    if (quote.kind !== "charge") throw new Error(`expected charge, got ${quote.kind}`);
    expect(quote.lines.map((l) => l.requiredNanogic)).toEqual([1_333_333_333n]);
    expect(quote.totalNanogic).toBe(1_333_333_333n);
  });

  it("multi_line_held carries no amount: how MAGIC floors several pairs is not decided", () => {
    const quote = quoteConsume(planConsume(twoLines, { idempotentReplay: false }), beacon);
    expect(quote).toEqual({ kind: "multi_line_held", lineCount: 2, coverage: "full" });
  });

  it("replay is priced like charge and keeps coverage, under its own kind", () => {
    const quote = quoteConsume(planConsume(parseOpDeclaration(contractExample), { idempotentReplay: true }), beacon);
    expect(quote.kind).toBe("replay");
    if (quote.kind !== "replay") throw new Error("unreachable");
    expect(quote.totalNanogic).toBe(30_000_000n);
    expect(quote.coverage).toBe("policy_partial");
  });

  it("not_declared and no_charge carry no amount at all", () => {
    expect(quoteConsume(planConsume(undefined, { idempotentReplay: false }), beacon)).toEqual({ kind: "not_declared" });
    expect(quoteConsume(planConsume(storageOnly, { idempotentReplay: false }), beacon)).toEqual({
      kind: "no_charge",
      coverage: "policy_partial",
    });
  });

  it("throws when the beacon has no row for a declared op", () => {
    const decl = parseOpDeclaration({
      task_key: "tree.anchor",
      ops: [{ op_type: 7, op_count: 1, unit: "rotation" }],
      pending: [],
      missing: [],
      not_applicable: [],
      coverage: "full",
    });
    expect(() => quoteConsume(planConsume(decl, { idempotentReplay: false }), beacon)).toThrow(/no row for op_type 7/);
  });
});

describe("planConsumeFromResponse", () => {
  it("absent field → not_declared", () => {
    expect(planConsumeFromResponse({ ok: true, tree_id: "t1" }).kind).toBe("not_declared");
  });

  it("present field → parsed; idempotent_replay: true → replay", () => {
    expect(planConsumeFromResponse({ ok: true, op_declaration: contractExample }).kind).toBe("charge");
    expect(
      planConsumeFromResponse({ ok: true, op_declaration: contractExample, idempotent_replay: true }).kind,
    ).toBe("replay");
  });

  it("present but malformed (including null) throws instead of reading as absent", () => {
    expect(() => planConsumeFromResponse({ op_declaration: null })).toThrow();
    expect(() => planConsumeFromResponse({ op_declaration: { ...contractExample, ops: "1" } })).toThrow();
    expect(() => planConsumeFromResponse({ op_declaration: contractExample, idempotent_replay: "yes" })).toThrow();
  });

  it("the whole /api/identify/auto body (declaration under `result`) throws instead of reading as absent", () => {
    expect(() => planConsumeFromResponse({ ok: true, result: { op_declaration: contractExample } })).toThrow(
      /pass body\.result/,
    );
    expect(planConsumeFromResponse({ op_declaration: contractExample }).kind).toBe("charge");
  });
});

describe("src/ prices nothing in LAMP", () => {
  it("no source file mentions LAMP, oil, feeLamp or custody", () => {
    // `\bLAMP\b` and not `lamp`: MAGIC's own names (`MagicLampEco`, `@magiclamp/…`) contain the
    // letters and are legitimate references to where the formula comes from.
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const hits = files.filter((f) =>
      /\bLAMP\b|\boil\b|feeLamp|custody/i.test(readFileSync(join(srcDir, f), "utf8")),
    );
    expect(hits).toEqual([]);
  });
});
