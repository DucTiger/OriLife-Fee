// Parser for `op_declaration`, the field OriLife-Core attaches to every billable API response.
//
// Source of the shape: `OriLife-Core` `MasterIdentify/MOBILE-API-CONTRACT.md` §14.6-bis (read at
// `origin/main` dca31f3, 2026-10-02) and the code that emits it,
// `MasterIdentify/core/magic_ops.py` (`OpDeclaration.to_response_dict`).
//
// The declaration carries QUANTITIES, never a price. The price comes from MAGIC's PriceParam
// beacon (see `magicPrice.ts`).
//
// Every malformed shape THROWS. Nothing here substitutes a default for a missing or odd value:
// a declaration that is silently patched into something plausible goes straight onto the money
// path, and an empty `ops` reads as "free".

/** Op codes and units published by Core (`magic_ops.py` `OP_UNITS`). Units are owned by the
 *  MAGIC Registry, not by OriLife; an unknown code is accepted with whatever unit it carries. */
export const OP_IMAGE = 1;
export const OP_CID = 2;
export const OP_STORAGE = 3;
export const OP_COMPUTE = 4;

export const KNOWN_OP_UNITS: Readonly<Record<number, string>> = Object.freeze({
  [OP_IMAGE]: "image",
  [OP_CID]: "cid",
  [OP_STORAGE]: "storage_event",
  [OP_COMPUTE]: "compute_event",
});

/** Codes Core never charges today: code 3 counts one storage event, not bytes, so Core always puts
 *  it in `pending` (`magic_ops.py` `STORAGE_PENDING_REASON`). A code 3 line in `ops` means a Core
 *  that drifted back to declaring storage, and is refused here rather than priced. Remove the
 *  code from this set only when the Registry publishes a unit that Core is allowed to charge. */
export const OPS_PENDING_ONLY: ReadonlySet<number> = new Set([OP_STORAGE]);

/** Ceiling on `op_count`: 2^53 − 1 (`magic_ops.py` `MAX_OP_COUNT`). Above it a reader that
 *  parses JSON numbers as float64 loses precision silently, and the burn must equal the
 *  required amount exactly. */
export const MAX_OP_COUNT = Number.MAX_SAFE_INTEGER;

export const COVERAGE_VALUES = ["full", "policy_partial", "anomaly"] as const;
export type Coverage = (typeof COVERAGE_VALUES)[number];

/** A line that goes into a ConsumeMAGIC transaction. */
export interface OpLine {
  opType: number;
  opCount: number;
  unit: string;
}

/** A line that does NOT go into a transaction (`pending`, `missing`, `not_applicable`).
 *  It never carries a count. */
export interface OpNote {
  opType: number;
  unit: string;
  reason?: string;
}

export interface OpDeclaration {
  taskKey: string;
  ops: OpLine[];
  pending: OpNote[];
  missing: OpNote[];
  notApplicable: OpNote[];
  coverage: Coverage;
}

export class OpDeclarationError extends Error {
  constructor(message: string) {
    super(`op_declaration: ${message}`);
    this.name = "OpDeclarationError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new OpDeclarationError(`\`${key}\` must be an array, got ${describe(v)}`);
  }
  return v;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return `number ${v}`;
  return typeof v;
}

function parseOpType(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
    throw new OpDeclarationError(`${where}.op_type must be a positive integer, got ${describe(v)}`);
  }
  return v;
}

function parseUnit(v: unknown, opType: number, where: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new OpDeclarationError(`${where}.unit must be a non-empty string, got ${describe(v)}`);
  }
  const known = KNOWN_OP_UNITS[opType];
  if (known !== undefined && v !== known) {
    throw new OpDeclarationError(
      `${where}.unit is "${v}" but op_type ${opType} is counted in "${known}"`,
    );
  }
  return v;
}

function parseOpCount(v: unknown, where: string): number {
  // Number.isSafeInteger rejects non-numbers, NaN, ±Infinity, fractions and |v| > 2^53 − 1.
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new OpDeclarationError(
      `${where}.op_count must be an integer no greater than ${MAX_OP_COUNT}, got ${describe(v)}`,
    );
  }
  if (v < 1) {
    throw new OpDeclarationError(
      `${where}.op_count must be ≥ 1, got ${v} (a line with nothing to charge belongs in ` +
        "`missing` or `not_applicable`, not in `ops`)",
    );
  }
  return v;
}

function parseOpLine(raw: unknown, where: string): OpLine {
  if (!isPlainObject(raw)) throw new OpDeclarationError(`${where} must be an object`);
  const opType = parseOpType(raw.op_type, where);
  if (OPS_PENDING_ONLY.has(opType)) {
    throw new OpDeclarationError(
      `${where}.op_type ${opType} is never charged today; it belongs in \`pending\` (contract §14.6-bis)`,
    );
  }
  const opCount = parseOpCount(raw.op_count, where);
  const unit = parseUnit(raw.unit, opType, where);
  return { opType, opCount, unit };
}

function parseOpNote(raw: unknown, where: string, reasonRequired: boolean): OpNote {
  if (!isPlainObject(raw)) throw new OpDeclarationError(`${where} must be an object`);
  const opType = parseOpType(raw.op_type, where);
  const unit = parseUnit(raw.unit, opType, where);
  if ("op_count" in raw) {
    throw new OpDeclarationError(
      `${where} carries op_count; only \`ops\` lines carry a count (contract §14.6-bis)`,
    );
  }
  const note: OpNote = { opType, unit };
  if (raw.reason !== undefined || reasonRequired) {
    if (typeof raw.reason !== "string" || raw.reason.length === 0) {
      throw new OpDeclarationError(
        `${where}.reason must be a non-empty string, got ${describe(raw.reason)}`,
      );
    }
    note.reason = raw.reason;
  }
  return note;
}

/** `coverage` as Core derives it (`magic_ops.py` `OpDeclaration.coverage`): `anomaly` wins over
 *  `policy_partial`. */
function expectedCoverage(pending: OpNote[], missing: OpNote[]): Coverage {
  if (missing.length > 0) return "anomaly";
  if (pending.length > 0) return "policy_partial";
  return "full";
}

/**
 * Parse the value of an `op_declaration` field. Throws `OpDeclarationError` on any shape that does
 * not match contract §14.6-bis. Unknown extra keys are ignored.
 *
 * Absence of the field is NOT handled here — it is a different state from an empty declaration
 * and is decided by the caller (see `consumePlan.ts`).
 */
export function parseOpDeclaration(raw: unknown): OpDeclaration {
  if (!isPlainObject(raw)) {
    throw new OpDeclarationError(`must be an object, got ${describe(raw)}`);
  }
  if (typeof raw.task_key !== "string" || raw.task_key.length === 0) {
    throw new OpDeclarationError(`task_key must be a non-empty string, got ${describe(raw.task_key)}`);
  }

  const ops = requireArray(raw, "ops").map((x, i) => parseOpLine(x, `ops[${i}]`));
  const pending = requireArray(raw, "pending").map((x, i) => parseOpNote(x, `pending[${i}]`, true));
  const missing = requireArray(raw, "missing").map((x, i) => parseOpNote(x, `missing[${i}]`, true));
  // `not_applicable` is additive since contract v2.51; a Core older than that omits it. Absent is
  // read as [] — it carries no amount and does not enter `coverage`, so nothing priced changes.
  // Present but not an array still throws.
  const notApplicable = (raw.not_applicable === undefined ? [] : requireArray(raw, "not_applicable")).map(
    (x, i) => parseOpNote(x, `not_applicable[${i}]`, false),
  );

  // One op code appears in at most one place. Two `ops` lines for the same code would be two
  // charges for one measurement; a code both charged and pending contradicts itself.
  const seen = new Map<number, string>();
  const sections: Array<[string, Array<OpLine | OpNote>]> = [
    ["ops", ops],
    ["pending", pending],
    ["missing", missing],
    ["not_applicable", notApplicable],
  ];
  for (const [name, lines] of sections) {
    for (const line of lines) {
      const prev = seen.get(line.opType);
      if (prev !== undefined) {
        throw new OpDeclarationError(`op_type ${line.opType} appears in both \`${prev}\` and \`${name}\``);
      }
      seen.set(line.opType, name);
    }
  }

  const coverage = raw.coverage;
  if (typeof coverage !== "string" || !(COVERAGE_VALUES as readonly string[]).includes(coverage)) {
    throw new OpDeclarationError(
      `coverage must be one of ${COVERAGE_VALUES.join(", ")}, got ${describe(coverage)}`,
    );
  }
  const derived = expectedCoverage(pending, missing);
  if (coverage !== derived) {
    throw new OpDeclarationError(
      `coverage is "${coverage}" but pending/missing imply "${derived}"`,
    );
  }

  return { taskKey: raw.task_key, ops, pending, missing, notApplicable, coverage: coverage as Coverage };
}
