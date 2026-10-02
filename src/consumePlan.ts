// From an `op_declaration` to the list of ConsumeMAGIC transactions the user has to sign.
//
// Five outcomes, kept as distinct kinds on purpose (contract §14.6-bis, "four rules for the app",
// plus one hold this package adds):
//   not_declared — the response has no `op_declaration`. Nothing to consume, and NOT "free":
//                  the UI must not show a zero price for it.
//   multi_line_held — `ops` has more than one line. One task is one ConsumeMAGIC transaction
//                  (OriLife Fee spec v2.0 §0), and today's `Consume` redeemer carries a single
//                  (op_type, op_count) pair, so such a task cannot be charged yet. Held, not split
//                  into one transaction per line (TREO-nhieu-dong-ops). With the default Core
//                  configuration `ops` has at most one line.
//   replay       — the response is an idempotent replay (`idempotent_replay: true`, §14.12).
//                  The contract's rule is conditional: do not consume again IF a consume was
//                  already made for that `client_event_id`. A replay also covers the case where
//                  the first response was lost in transit, so the first run may never have been
//                  consumed for. This package cannot know which; the plan keeps the declaration
//                  and the quote keeps the amounts, and the app decides from its own consume
//                  record keyed by `client_event_id`.
//                  A replay of a run with `ops: []` is `no_charge`: there is no amount to show.
//   no_charge    — `ops: []`. This run has nothing to consume yet. Not an error.
//   charge       — exactly one `ops` line: one ConsumeMAGIC transaction.
//
// Building and signing the transaction is NOT done here: that is MAGIC's SDK
// (`@magiclamp/consumemagic` `buildConsumeTx`), signed by the user from their vault.

import { type Coverage, type OpDeclaration, parseOpDeclaration } from "./opDeclaration.js";
import { type PriceParam, requiredNanogic } from "./magicPrice.js";

/** One (op_type, op_count) pair. The on-chain redeemer `Consume` carries exactly one pair today,
 *  so only a declaration with one line is charged (see `multi_line_held`). */
export interface ConsumeRequest {
  opType: number;
  opCount: bigint;
  unit: string;
}

export type ConsumePlan =
  | { kind: "not_declared" }
  | { kind: "multi_line_held"; declaration: OpDeclaration; requests: ConsumeRequest[] }
  | { kind: "replay"; declaration: OpDeclaration; requests: [ConsumeRequest] }
  | { kind: "no_charge"; declaration: OpDeclaration }
  | { kind: "charge"; declaration: OpDeclaration; requests: [ConsumeRequest] };

export interface PlanOptions {
  /** Value of `idempotent_replay` on the response. */
  idempotentReplay: boolean;
}

/**
 * Decide what to consume for one API response.
 *
 * Order: an absent declaration first (with no declaration there is nothing to replay either);
 * then a multi-line hold (a replay of a held run was never charged either); then `ops: []`
 * (a replay of it still has nothing to show); then replay; then charge.
 */
export function planConsume(declaration: OpDeclaration | undefined, options: PlanOptions): ConsumePlan {
  if (declaration === undefined) return { kind: "not_declared" };
  const requests = declaration.ops.map((line) => ({
    opType: line.opType,
    opCount: BigInt(line.opCount),
    unit: line.unit,
  }));
  if (requests.length > 1) return { kind: "multi_line_held", declaration, requests };
  const [only] = requests;
  if (only === undefined) return { kind: "no_charge", declaration };
  if (options.idempotentReplay) return { kind: "replay", declaration, requests: [only] };
  return { kind: "charge", declaration, requests: [only] };
}

/**
 * Read `op_declaration` and `idempotent_replay` from a response body and plan.
 *
 * Pass the object that carries the field. For `POST /api/identify/auto` that is `body.result`,
 * not `body` (contract §14.6-bis); a `null` result there means no declaration, which the caller
 * maps to `planConsume(undefined, …)`.
 *
 * A field that is present but malformed throws — it is not treated as absent.
 */
export function planConsumeFromResponse(body: unknown): ConsumePlan {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new TypeError("response body must be an object");
  }
  const record = body as Record<string, unknown>;
  const replay = record.idempotent_replay;
  if (replay !== undefined && typeof replay !== "boolean") {
    throw new TypeError(`idempotent_replay must be a boolean, got ${typeof replay}`);
  }
  // Passing the whole `/api/identify/auto` body would read as "not declared" and skip the consume
  // without a sound. The declaration one level down means the caller passed the wrong object.
  const nested = record.result;
  if (
    !("op_declaration" in record) &&
    typeof nested === "object" && nested !== null && !Array.isArray(nested) &&
    "op_declaration" in nested
  ) {
    throw new TypeError("op_declaration is under `result`: pass body.result (contract §14.6-bis)");
  }
  const declaration =
    "op_declaration" in record ? parseOpDeclaration(record.op_declaration) : undefined;
  return planConsume(declaration, { idempotentReplay: replay === true });
}

export interface QuotedLine extends ConsumeRequest {
  requiredNanogic: bigint;
}

export type ConsumeQuote =
  | { kind: "not_declared" }
  | { kind: "multi_line_held"; lineCount: number; coverage: Coverage }
  | { kind: "replay"; lines: QuotedLine[]; totalNanogic: bigint; coverage: Coverage }
  | { kind: "no_charge"; coverage: Coverage }
  | { kind: "charge"; lines: QuotedLine[]; totalNanogic: bigint; coverage: Coverage };

function priceRequests(requests: ConsumeRequest[], pp: PriceParam): { lines: QuotedLine[]; totalNanogic: bigint } {
  const lines = requests.map((r) => ({ ...r, requiredNanogic: requiredNanogic(pp, r.opType, r.opCount) }));
  return { lines, totalNanogic: lines.reduce((sum, l) => sum + l.requiredNanogic, 0n) };
}

/**
 * Price a plan against a PriceParam beacon datum.
 *
 * A charged plan has one line, floored once — exactly what the vaults will burn. `coverage` is
 * passed through so the UI can say when the total is partial (`policy_partial`) or suspect
 * (`anomaly`).
 *
 * A `replay` is priced the same way as a `charge`: whether to consume is the app's decision
 * (see the header), and it needs the amounts to make it. A `multi_line_held` plan carries no
 * amount: the number a future multi-pair transaction burns depends on how MAGIC floors the pairs,
 * which is not decided yet.
 *
 * The caller is responsible for checking the beacon's age first (`assertPriceFresh`).
 */
export function quoteConsume(plan: ConsumePlan, pp: PriceParam): ConsumeQuote {
  switch (plan.kind) {
    case "not_declared":
      return { kind: "not_declared" };
    case "multi_line_held":
      return { kind: "multi_line_held", lineCount: plan.requests.length, coverage: plan.declaration.coverage };
    case "replay":
      return { kind: "replay", ...priceRequests(plan.requests, pp), coverage: plan.declaration.coverage };
    case "no_charge":
      return { kind: "no_charge", coverage: plan.declaration.coverage };
    case "charge":
      return { kind: "charge", ...priceRequests(plan.requests, pp), coverage: plan.declaration.coverage };
  }
}
