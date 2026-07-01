# TronRent Light-Asset Progress

This tracker keeps the product direction tied to verifiable implementation
state. TronRent should stay light-asset: users pay the treasury, the backend
confirms deposits from chain data, then the service buys energy through a
prepaid provider balance or performs exchange payouts through explicitly gated
wallet automation.

## Current Proven Slices

- Energy rental plans are server-owned and priced in 65k USDT transfer units.
- Energy rental orders support connected-wallet TRX payment and manual treasury
  transfer instructions.
- Chain scanning is the settlement authority for wallet and manual transfers.
- Existing rental deposits match pre-created `Payment` rows by treasury address
  and exact unique amount, including per-order sun offsets.
- Orderless direct-pay rental deposits can create paid energy orders when a TRX
  transfer to `TREASURY_TRON_ADDRESS` exactly equals one catalog base price.
- Matched paid rental orders can trigger provider jobs after a deposit scan.
- Provider execution is dry-run by default and only calls APITRX when live gates
  and secrets are configured.
- TRX/USDT exchange orders support exact deposit matching and gated payout jobs.
- Ops readiness reports overall mode plus separate energy-rental and
  exchange-payout modes.
- Ops console can load readiness/backlog and manually trigger scan or queue
  drains without rendering raw addresses, txids, or upstream payloads.

## Direct-Pay Rental Slice

The user goal includes an orderless direct-pay rental path:

> A user transfers a package amount to a designated address; the system watches
> the chain, identifies the amount, and returns the corresponding energy package.

The first backend slice is implemented with these boundaries:

- Only handle TRX deposits to `TREASURY_TRON_ADDRESS`.
- Only accept amounts that exactly equal one catalog energy plan base price,
  without the per-order offset.
- Continue to match pre-created orders first, so displayed offset payments keep
  priority and remain unambiguous.
- Use the deposit `fromAddress` as both `targetAddress` and
  `customerWalletAddress`.
- Create the `Order` and confirmed `Payment` inside the same
  `recordAndMatchDeposit` transaction that owns the `ChainDeposit` row.
- Use `idempotencyKey = direct-deposit:<depositKey>` and metadata
  `orderSource = direct_deposit`, `matchedBy = direct_plan_amount`.
- Return the created order ID as `matchedOrderId`, allowing the existing
  post-match provider path to fulfill it.
- Do not infer energy targets for TRC20 transfers, exchange deposits, memo-less
  third-party senders, or custodial exchange withdrawals.

There is not yet a user-facing page that advertises the direct-pay amounts or
explains the sender-address caveat.

## Acceptance Criteria

- Existing pre-created order matching remains unchanged and takes precedence.
- Duplicate scans of the same transfer do not create duplicate orders.
- A base-price TRX deposit creates one paid energy order targeting the sender
  address and confirms one payment.
- A non-plan amount remains unmatched.
- A TRC20 deposit never creates a direct energy order.
- A direct-pay matched order is included in post-match provider processing when
  `processProviderJobs=true`.
- Direct-pay metadata and API responses do not leak secrets or raw provider
  payloads.

## Verification Commands

```bash
npm test --workspace tronrent-server
npm run test:e2e:wallet --workspace tronrent -- --grep "rent"
npm run build:web
npm run lint:web
```

DB-backed proof should also run when `TEST_DATABASE_URL` is available:

```bash
TEST_DATABASE_URL=postgresql://... npm run test:e2e:dry-run --workspace tronrent-server
TEST_DATABASE_URL=postgresql://... npm run test:e2e:http-dry-run --workspace tronrent-server
```

## Decision Status

Claude Code reviewed the direct-pay design on 2026-07-01 and required these
changes before shipping: gate on `TREASURY_TRON_ADDRESS`, populate all required
order fields, write `matchedOrderId`, reject ambiguous plan prices, and validate
`fromAddress`. The implementation includes those changes.

## Remaining Gaps

- Add a user-facing direct-pay rental view that clearly says energy is delivered
  to the sending address.
- Add operator/refund handling for unmatched direct deposits and custodial
  exchange withdrawals.
- Run DB-backed E2E with `TEST_DATABASE_URL` before treating the direct-pay path
  as production-ready.
