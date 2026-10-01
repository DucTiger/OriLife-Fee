// The example from OriLife-Core `MasterIdentify/MOBILE-API-CONTRACT.md` §14.6-bis
// (origin/main dca31f3): a tree registration with three images, default server configuration.
// The two `reason` strings are elided as "..." in the contract too.
export const contractExample = {
  task_key: "tree.register",
  ops: [{ op_type: 1, op_count: 3, unit: "image" }],
  pending: [
    { op_type: 3, unit: "storage_event", reason: "..." },
    { op_type: 4, unit: "compute_event", reason: "..." },
  ],
  missing: [],
  not_applicable: [],
  coverage: "policy_partial",
};
