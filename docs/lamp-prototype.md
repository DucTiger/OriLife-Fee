# LAMP prototype — what was removed, and what still holds assets

From July to August 2026 this repository priced OriLife tasks in LAMP and deposited the fee into a
LAMP Treasury custody contract on Preview. OriLife services are now priced in MAGIC (see
`README.md`), so that code was removed from the tree. The custody address it deployed still holds
assets, and this file is the record of where they are and how to reach the code that spends them.

## The custody instance on Preview

| | |
|---|---|
| Network | Cardano Preview |
| Custody address | `addr_test1wzz0uxpt58vllu2patcldqa7dvgwkr2j5yagcs8s9lmh37gq34gs9` |
| Genesis UTxO | `44f0c35cf697e87b7cea2f325f074ccee9bc4e3e247fc5e5992826e1ed097c52#0` |
| LAMP policy id | `28e916b097be13ed955330f00710bd93e2ea74bbc89aa5f5cd0f12b4` |
| LAMP asset name | `4c414d50` |

Copied from `scripts/deployed_preview.json` at commit `fef2ee2` (the last commit that holds it).

Balance read from Blockfrost Preview on 2026-08-21, as recorded in `STATUS.md` at that time. This
is a dated reading, not a live one; query the address again before acting on it.

```
lovelace                                       12,000,000
28e916b0…4c414d50   (LAMP)                     19,500,000
b1474a77…744c414d50 (tLAMP)                   120,000,000
c123bdfb…744c414d50 (tLAMP, other policy)       1,000,000
0c2ab8cf…747265732d7265736576 (tres-resev)              1
171350413…74726561737572792d6c616d70 (treasury-lamp)    1
```

## Why the address depends on exact versions

The address is derived from the custody script hash, and the script hash depends on the exact
LAMP source and compiler that produced the blueprint. The blueprint that matches this address was
built from LAMP commit `ebafc2e1ed6895e741e9febf0d66b62f7873d2ab`. Rebuilding it from any other
LAMP commit produces a different address, and the assets above can no longer be spent through it.

## Where the spending code is

The code that builds and spends against this address — `src/treasuryClient.ts`,
`scripts/01_deploy_custody_preview.ts`, `scripts/02_collect_preview.ts`,
`scripts/config_preview.ts`, `scripts/pin-lamp.sh` (pins LAMP at the commit above), and the
vendored blueprint `vendor/treasury-custody.plutus.json` — is at commit
`fef2ee2d1405d0008430cd7ef920082ea2e394ac`, which is part of `main`'s history and stays reachable
from it.

To recover it: `git checkout fef2ee2`, then follow the README of that commit.
