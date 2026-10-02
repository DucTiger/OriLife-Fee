import { describe, expect, it } from "vitest";
import { MAX_OP_COUNT, OpDeclarationError, parseOpDeclaration } from "../src/opDeclaration.js";
import { contractExample } from "./fixtures.js";

function withOps(ops: unknown[]): Record<string, unknown> {
  return { ...contractExample, ops };
}

describe("parseOpDeclaration — accepts the contract's shapes", () => {
  it("parses the §14.6-bis example", () => {
    const d = parseOpDeclaration(contractExample);
    expect(d.taskKey).toBe("tree.register");
    expect(d.ops).toEqual([{ opType: 1, opCount: 3, unit: "image" }]);
    expect(d.pending.map((p) => p.opType)).toEqual([3, 4]);
    expect(d.coverage).toBe("policy_partial");
  });

  it("parses a storage-only task: `ops: []` with code 3 pending (care.log)", () => {
    const d = parseOpDeclaration({
      task_key: "care.log",
      ops: [],
      pending: [{ op_type: 3, unit: "storage_event", reason: "..." }],
      missing: [],
      not_applicable: [],
      coverage: "policy_partial",
    });
    expect(d.ops).toEqual([]);
  });

  it("parses not_applicable without a reason (fruit_video without fruit_id)", () => {
    const d = parseOpDeclaration({
      task_key: "evidence.ingest",
      ops: [],
      pending: [{ op_type: 3, unit: "storage_event", reason: "..." }],
      missing: [],
      not_applicable: [{ op_type: 1, unit: "image" }],
      coverage: "policy_partial",
    });
    expect(d.notApplicable).toEqual([{ opType: 1, unit: "image" }]);
  });

  it("parses an anomaly: a code in `missing` makes coverage anomaly even with pending present", () => {
    // Core's rule (`magic_ops.py` OpDeclaration.coverage): anomaly wins over policy_partial.
    // "khai lượng 0" is the reason Core writes when a measured count comes out as zero.
    const decl = parseOpDeclaration({
      task_key: "fruit.video",
      ops: [],
      pending: [{ op_type: 3, unit: "storage_event", reason: "..." }],
      missing: [{ op_type: 1, unit: "image", reason: "khai lượng 0" }],
      not_applicable: [],
      coverage: "anomaly",
    });
    expect(decl.coverage).toBe("anomaly");
    expect(() =>
      parseOpDeclaration({
        task_key: "fruit.video",
        ops: [],
        pending: [{ op_type: 3, unit: "storage_event", reason: "..." }],
        missing: [{ op_type: 1, unit: "image", reason: "khai lượng 0" }],
        not_applicable: [],
        coverage: "policy_partial",
      }),
    ).toThrow(OpDeclarationError);
  });

  it("reads an absent not_applicable (Core before contract v2.51) as empty", () => {
    const { not_applicable: _drop, ...older } = contractExample;
    const decl = parseOpDeclaration(older);
    expect(decl.notApplicable).toEqual([]);
    expect(decl.coverage).toBe("policy_partial");
  });

  it("accepts op_count = 2^53 − 1 and an unknown op code with its own unit", () => {
    const d = parseOpDeclaration(withOps([{ op_type: 9, op_count: MAX_OP_COUNT, unit: "widget" }]));
    expect(d.ops[0]).toEqual({ opType: 9, opCount: 2 ** 53 - 1, unit: "widget" });
  });
});

describe("parseOpDeclaration — throws on strange shapes", () => {
  const badCounts: Array<[string, unknown]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["above 2^53 − 1", 2 ** 53],
    ["string", "3"],
    ["missing", undefined],
    ["NaN", Number.NaN],
  ];
  for (const [label, count] of badCounts) {
    it(`op_count ${label}`, () => {
      expect(() => parseOpDeclaration(withOps([{ op_type: 1, op_count: count, unit: "image" }]))).toThrow(
        OpDeclarationError,
      );
    });
  }

  it("unknown coverage value", () => {
    expect(() => parseOpDeclaration({ ...contractExample, coverage: "partial" })).toThrow(/coverage must be one of/);
  });

  it("coverage that contradicts pending/missing", () => {
    expect(() => parseOpDeclaration({ ...contractExample, coverage: "full" })).toThrow(/imply "policy_partial"/);
  });

  it("op_type zero, negative or fractional", () => {
    for (const t of [0, -1, 1.5]) {
      expect(() => parseOpDeclaration(withOps([{ op_type: t, op_count: 1, unit: "image" }]))).toThrow(/op_type/);
    }
  });

  it("unit that does not match a known op code", () => {
    expect(() => parseOpDeclaration(withOps([{ op_type: 1, op_count: 1, unit: "byte" }]))).toThrow(
      /counted in "image"/,
    );
  });

  it("a pending line that carries op_count", () => {
    expect(() =>
      parseOpDeclaration({
        ...contractExample,
        pending: [{ op_type: 3, unit: "storage_event", reason: "...", op_count: 200000 }],
        coverage: "policy_partial",
      }),
    ).toThrow(/carries op_count/);
  });

  it("the same op code twice in ops, or in ops and pending", () => {
    expect(() =>
      parseOpDeclaration(
        withOps([
          { op_type: 1, op_count: 1, unit: "image" },
          { op_type: 1, op_count: 2, unit: "image" },
        ]),
      ),
    ).toThrow(/appears in both/);
    expect(() => parseOpDeclaration(withOps([{ op_type: 4, op_count: 1, unit: "compute_event" }]))).toThrow(
      /appears in both `ops` and `pending`/,
    );
  });

  it("pending or missing without a reason", () => {
    expect(() => parseOpDeclaration({ ...contractExample, pending: [{ op_type: 3, unit: "storage_event" }] })).toThrow(
      /pending\[0\]\.reason/,
    );
    expect(() =>
      parseOpDeclaration({
        ...contractExample,
        pending: [],
        missing: [{ op_type: 3, unit: "storage_event" }],
        coverage: "anomaly",
      }),
    ).toThrow(/missing\[0\]\.reason/);
  });

  it("missing arrays, null, non-object", () => {
    const { missing: _drop, ...noMissing } = contractExample;
    expect(() => parseOpDeclaration(noMissing)).toThrow(/`missing` must be an array/);
    const { pending: _dropPending, ...noPending } = contractExample;
    expect(() => parseOpDeclaration(noPending)).toThrow(/`pending` must be an array/);
    expect(() => parseOpDeclaration({ ...contractExample, not_applicable: null })).toThrow(
      /`not_applicable` must be an array/,
    );
    expect(() => parseOpDeclaration(null)).toThrow(OpDeclarationError);
    expect(() => parseOpDeclaration([])).toThrow(OpDeclarationError);
    expect(() => parseOpDeclaration({ ...contractExample, task_key: "" })).toThrow(/task_key/);
  });

  it("code 3 in ops: Core never charges storage today, so it is refused, not priced", () => {
    expect(() =>
      parseOpDeclaration({
        task_key: "tree.register",
        ops: [{ op_type: 3, op_count: 200000, unit: "storage_event" }],
        pending: [],
        missing: [],
        not_applicable: [],
        coverage: "full",
      }),
    ).toThrow(/ops\[0\]\.op_type 3 is never charged today/);
  });

  it("the same op code in missing and not_applicable", () => {
    expect(() =>
      parseOpDeclaration({
        task_key: "evidence.ingest",
        ops: [],
        pending: [],
        missing: [{ op_type: 1, unit: "image", reason: "..." }],
        not_applicable: [{ op_type: 1, unit: "image" }],
        coverage: "anomaly",
      }),
    ).toThrow(/appears in both `missing` and `not_applicable`/);
  });

  it("not_applicable with an empty reason (a reason may be absent, never empty)", () => {
    expect(() =>
      parseOpDeclaration({ ...contractExample, not_applicable: [{ op_type: 2, unit: "cid", reason: "" }] }),
    ).toThrow(/not_applicable\[0\]\.reason/);
  });

  it("an empty unit, even on an op code this package does not know", () => {
    expect(() => parseOpDeclaration(withOps([{ op_type: 9, op_count: 1, unit: "" }]))).toThrow(/unit must be/);
  });

  it("op_type above 2^53 − 1", () => {
    expect(() => parseOpDeclaration(withOps([{ op_type: 2 ** 53, op_count: 1, unit: "x" }]))).toThrow(/op_type/);
  });
});
