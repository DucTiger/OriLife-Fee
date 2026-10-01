// From an `op_declaration` to the list of ConsumeMAGIC transactions the user has to sign.
//
// Four outcomes, kept as four distinct kinds on purpose (contract §14.6-bis, "four rules for the
// app"):
//   not_declared — the response has no `op_declaration`. Nothing to consume, and NOT "free":
//                  the UI must not show a zero price for it.
//   replay       — the response is an idempotent replay (`idempotent_replay: true`, §14.12).
//                  The original request was already consumed for; do not consume again.
//   no_charge    — `ops: []`. This run has nothing to consume yet. Not an error.
//   charge       — one ConsumeMAGIC per `ops` line.
//
// Building and signing the transaction is NOT done here: that is MAGIC's SDK
// (`@magiclamp/consumemagic` `buildConsumeTx`), signed by the user from their vault.

import { type Coverage, type OpDeclaration, parseOpDeclaration } from "./opDeclaration.js";
import { type PriceParam, requiredNanogic } from "./magicPrice.js";

/** Parameters for one ConsumeMAGIC transaction. The on-chain redeemer `Consume` carries exactly
 *  one (op_type, op_count) pair, so a declaration with N lines means N transactions. */
export interface ConsumeRequest {
  opType: number;
  opCount: bigint;
  unit: string;
}

export type ConsumePlan =
  | { kind: "not_declared" }
  | { kind: "replay"; declaration: OpDeclaration }
  | { kind: "no_charge"; declaration: OpDeclaration }
  | { kind: "charge"; declaration: OpDeclaration; requests: ConsumeRequest[] };

export interface PlanOptions {
  /** Value of `idempotent_replay` on the response. */
  idempotentReplay: boolean;
}

/**
 * Decide what to consume for one API response.
 *
 * An absent declaration is checked first: with no declaration there is nothing to replay either.
 */
export function planConsume(declaration: OpDeclaration | undefined, options: PlanOptions): ConsumePlan {
  if (declaration === undefined) return { kind: "not_declared" };
  if (options.idempotentReplay) return { kind: "replay", declaration };
  if (declaration.ops.length === 0) return { kind: "no_charge", declaration };
  return {
    kind: "charge",
    declaration,
    requests: declaration.ops.map((line) => ({
      opType: line.opType,
      opCount: BigInt(line.opCount),
      unit: line.unit,
    })),
  };
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
  const declaration =
    "op_declaration" in record ? parseOpDeclaration(record.op_declaration) : undefined;
  return planConsume(declaration, { idempotentReplay: replay === true });
}

export interface QuotedLine extends ConsumeRequest {
  requiredNanogic: bigint;
}

export type ConsumeQuote =
  | { kind: "not_declared" }
  | { kind: "replay" }
  | { kind: "no_charge"; coverage: Coverage }
  | { kind: "charge"; lines: QuotedLine[]; totalNanogic: bigint; coverage: Coverage };

/**
 * Price a plan against a PriceParam beacon datum.
 *
 * Each line is its own transaction, so each line is floored once on its own and the total is the
 * sum of those — which is exactly what the vaults will burn. `coverage` is passed through so the
 * UI can say when the total is partial (`policy_partial`) or suspect (`anomaly`).
 *
 * The caller is responsible for checking the beacon's age first (`assertPriceFresh`).
 */
export function quoteConsume(plan: ConsumePlan, pp: PriceParam): ConsumeQuote {
  switch (plan.kind) {
    case "not_declared":
      return { kind: "not_declared" };
    case "replay":
      return { kind: "replay" };
    case "no_charge":
      return { kind: "no_charge", coverage: plan.declaration.coverage };
    case "charge": {
      const lines = plan.requests.map((r) => ({
        ...r,
        requiredNanogic: requiredNanogic(pp, r.opType, r.opCount),
      }));
      const totalNanogic = lines.reduce((sum, l) => sum + l.requiredNanogic, 0n);
      return { kind: "charge", lines, totalNanogic, coverage: plan.declaration.coverage };
    }
  }
}
