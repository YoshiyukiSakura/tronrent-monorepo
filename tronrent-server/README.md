# Tronrent Server

Express + Sequelize backend for TronRent.

The current implementation contains the legacy queue demo plus the first safe
slice of the energy-rental business flow:

- Server-owned energy plan catalog.
- Order creation with idempotency keys.
- Payment instruction records for wallet/deposit-address flows.
- Client-side TronLink TRX payment initiation for wallet orders; chain scanning
  remains the confirmation authority.
- Unique per-order payable tail amounts for shared treasury matching.
- Chain deposit watcher records confirmed Tron inbound deposits and matches only
  unambiguous payments.
- Dev-only payment confirmation behind an explicit environment gate.
- Dry-run provider jobs for energy fulfillment, plus a gated apitrx adapter.
- TRX/USDT exchange quotes, deposit orders, and gated payout jobs.

Backend fund movement is dry-run by default. Wallet transactions are initiated
by the user in the browser and still require chain-deposit confirmation.
Upstream energy-provider calls and exchange payout broadcasts require explicit
live configuration.

## Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Required local database:

```bash
DATABASE_URL=postgresql://tronrent_user:your_password@localhost:5432/tronrent
```

## Environment

Key safety-related variables:

```bash
TREASURY_TRON_ADDRESS=
EXCHANGE_TREASURY_TRON_ADDRESS=
ENABLE_DEV_PAYMENT_CONFIRMATION=false
PROVIDER_LIVE=false
ENERGY_PROVIDER=apitrx
APITRX_API_BASE_URL=https://web.apitrx.com
APITRX_API_KEY=
APITRX_TIMEOUT_MS=15000
ENABLE_QUEUE_CRON=false
ENABLE_ORDER_PROVIDER_CRON=false
ENABLE_DEPOSIT_WATCHER_CRON=false
ENABLE_EXCHANGE_PAYOUT_CRON=false
ENABLE_ORDER_EXPIRY_CRON=false
ENABLE_EXCHANGE_EXPIRY_CRON=false
ENABLE_DEPOSIT_SCAN_ENDPOINT=false
ENABLE_READINESS_ENDPOINT=false
ENABLE_PROVIDER_JOB_ENDPOINT=false
ENABLE_EXCHANGE_PAYOUT_ENDPOINT=false
EXCHANGE_PAYOUT_LIVE=false
EXCHANGE_PAYOUT_PRIVATE_KEY=
EXCHANGE_PAYOUT_FROM_ADDRESS=
EXCHANGE_PAYOUT_TRX_RESERVE_SUN=50000000
EXCHANGE_PAYOUT_FEE_LIMIT_SUN=100000000
DEPOSIT_WATCHER_ADMIN_TOKEN=
MAX_PAYMENT_OFFSET_SUN=9999
ORDER_CREATE_MAX_ATTEMPTS=8
EXCHANGE_MAX_PAYMENT_OFFSET_BASE_UNITS=9999
EXCHANGE_ORDER_CREATE_MAX_ATTEMPTS=8
TRONGRID_API_BASE_URL=https://api.trongrid.io
DEPOSIT_SCAN_LOOKBACK_MINUTES=180
DEPOSIT_SCAN_MAX_PAGES=20
TRON_TRC20_ALLOWLIST=USDT:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t:6
```

`ENABLE_DEV_PAYMENT_CONFIRMATION=true` is only for local development. It is
blocked in `NODE_ENV=production`.

## Runtime Readiness

`GET /api/admin/readiness` is a read-only operator endpoint for checking whether
the deployment is dry-run, partially live, or fully live-ready. It is disabled by
default and uses the same admin gate as deposit/provider/payout admin endpoints:

```bash
ENABLE_READINESS_ENDPOINT=true
DEPOSIT_WATCHER_ADMIN_TOKEN=replace-with-a-private-token
```

```bash
curl -H "x-admin-token: $DEPOSIT_WATCHER_ADMIN_TOKEN" \
  http://localhost:4000/api/admin/readiness
```

The response reports only booleans, enums, counts, and warnings. It does not
return treasury addresses, API keys, private keys, or TRC20 contract addresses,
and it does not call APITRX, TronGrid, or any hot-wallet signer.

## Deposit Scan Pagination

Deposit scans follow TronGrid pagination cursors so a busy treasury does not
silently miss older deposits after the first page. `DEPOSIT_SCAN_MAX_PAGES`
defaults to `20` and is capped at `200`. When the cap is reached while TronGrid
still reports another page, the scan returns `truncated: true` with
`truncationWarnings[]` and logs a warning for operator follow-up.

## API

### Plans

```http
GET /api/catalog/plans
```

### Orders

```http
POST /api/orders
```

```json
{
  "planId": "standard",
  "targetAddress": "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  "customerWalletAddress": "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  "paymentMethod": "deposit_address",
  "idempotencyKey": "client-generated-key"
}
```

The request does not accept a price. The backend resolves the price from the
server catalog and adds a small per-order sun offset so deposits to a shared
treasury address can be matched without guessing. Users must pay the exact
displayed amount.

For `wallet_connect` orders, the frontend can ask TronLink to transfer the exact
TRX amount to `paymentInstructions.address`. The frontend never marks the order
as paid; it only displays the wallet txid and polls `GET /api/orders/:id`.
Payment confirmation still comes from the chain deposit watcher.

Active payments have a database-level uniqueness guard on address, asset, and
expected amount. Expired pending orders are swept to an expired payment status
before new order allocation, releasing their tail amount for reuse.

```http
GET /api/orders/:id
POST /api/orders/:id/dev-confirm-payment
```

### Provider Jobs

```http
GET /api/provider-jobs/review
POST /api/provider-jobs/process
POST /api/provider-jobs/:orderId/resolve
```

Provider jobs remain dry-run unless the apitrx live-provider gates below are
explicitly enabled.

This manual endpoint is privileged in every environment. Set
`ENABLE_PROVIDER_JOB_ENDPOINT=true`, set `DEPOSIT_WATCHER_ADMIN_TOKEN`, and send
the token as `x-admin-token`. The scheduled cron path is controlled separately by
`ENABLE_ORDER_PROVIDER_CRON`.

The apitrx live adapter is present but fail-closed. It only calls the upstream
provider when all of these are true:

- `ENERGY_PROVIDER=apitrx`
- `PROVIDER_LIVE=true`
- `APITRX_API_KEY` is set
- `APITRX_API_BASE_URL` points at the API host, normally
  `https://web.apitrx.com`

Live provisioning calls apitrx `GET /getenergy` with the order's target address,
energy amount, and duration. Before that spend call, it fail-closed preflights
apitrx `GET /price` and `GET /balance`; both must return JSON with `code: 200`,
the selected duration must have a TRX price, and the prepaid provider balance
must cover the quoted TRX cost. The live adapter only supports the apitrx
duration keys `1`, `24`, `72`, `168`, `336`, and `720` hours.

The API key is never stored in `provider_jobs` and is redacted from provider
errors. The adapter only treats a JSON response with `code: 200` as success.
Preflight failures from `price` or `balance` are deterministic failures because
no spend call has happened yet. Ambiguous failures after the `getenergy` spend
call, such as timeouts, network failures, unrecognized responses, or upstream
gateway errors, are recorded as `provisioning_indeterminate` /
`indeterminate` for manual reconciliation and are not auto-retried. If the
provider accepts the order but the local fulfilled-state transaction fails, the
order is also moved to `provisioning_indeterminate` and the provider response is
preserved for review.

Use `GET /api/provider-jobs/review` for provider manual-review queues. This
read-only endpoint returns all `provisioning_indeterminate` orders plus stale
`provisioning` orders, including the latest provider job when one exists.
Operators should reconcile by target address, energy amount, duration, and
provisioned time window; apitrx may not return a durable upstream order id.

After operator reconciliation, `POST /api/provider-jobs/:orderId/resolve` can
close a `provisioning_indeterminate` order as `fulfilled` or `failed`. This is a
local state update only; it never calls apitrx. Send `x-admin-token`,
`x-admin-actor`, and a note. Successful `fulfilled` resolutions require an
`upstreamOrderId` evidence value, stored under `manualResolution` rather than as
a provider-returned id.

### Chain Deposits

```http
POST /api/deposits/scan
GET /api/deposits
```

These routes are privileged in every environment. Set
`ENABLE_DEPOSIT_SCAN_ENDPOINT=true`, set `DEPOSIT_WATCHER_ADMIN_TOKEN`, and send
the token as `x-admin-token`.

The scanner reads confirmed inbound TronGrid transactions for
`TREASURY_TRON_ADDRESS` and `EXCHANGE_TREASURY_TRON_ADDRESS`, stores them in
`chain_deposits`, and only marks a payment/order confirmed when exactly one
active candidate matches the treasury address, asset, contract, and unique
amount. Ambiguous or expired matches are recorded but not confirmed.

### Exchange Quotes

```http
POST /api/exchange/quotes
```

```json
{
  "direction": "TRX_TO_USDT",
  "inputAmount": "100"
}
```

Quotes expire after 60 seconds and must be converted into an exchange order
before they can be used.

### Exchange Orders

```http
POST /api/exchange/orders
GET /api/exchange/orders/:id
GET /api/exchange/payout-jobs/review
POST /api/exchange/payout-jobs/process
POST /api/exchange/payout-jobs/:exchangeOrderId/resolve
```

```json
{
  "quoteId": "quote-id",
  "outputAddress": "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  "customerWalletAddress": "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  "idempotencyKey": "client-generated-key"
}
```

Exchange orders use the separate `EXCHANGE_TREASURY_TRON_ADDRESS` so exchange
deposits cannot collide with energy-rental deposits. The order snapshots the
quote rate/spread, adds a small unique tail amount to the user deposit, and
waits for a matching chain deposit.

Payout jobs are dry-run unless all live payout gates are enabled:

- `EXCHANGE_PAYOUT_LIVE=true`
- `EXCHANGE_PAYOUT_PRIVATE_KEY` is set
- `EXCHANGE_PAYOUT_FROM_ADDRESS` is set and valid
- `TRONGRID_API_BASE_URL` is set
- `TRON_TRC20_ALLOWLIST` pins the USDT contract for USDT payouts

Live payout preflights the hot wallet balance before broadcasting. TRX payouts
require the output amount plus `EXCHANGE_PAYOUT_TRX_RESERVE_SUN`; USDT payouts
require enough USDT plus the TRX reserve for fees. The private key is never
stored in `exchange_payout_jobs` and is redacted from payout errors.

The current live payout success state means the transfer was broadcast and a txid
was returned, not that the chain later finalized it. Responses store
`completionMeaning=broadcast_submitted_not_final_chain_confirmation`. Broadcast
errors with ambiguous outcome are marked `payout_indeterminate` /
`indeterminate`, a manual-review terminal state that is not auto-retried.

Use `GET /api/exchange/payout-jobs/review` for payout manual-review queues.
This endpoint is admin-gated, read-only, and never retries or changes payout
state. It returns all `payout_indeterminate` orders plus `payout_processing`
orders older than the stale threshold, including the latest payout job when one
exists. A `payout_processing` order without a payout job is still surfaced so a
crash during claim setup does not disappear from operator view. Long-lived
`payout_processing` and all `payout_indeterminate` items must be reconciled
manually before any reattempt.

The exchange payout review/process endpoints are privileged in every
environment. Set `ENABLE_EXCHANGE_PAYOUT_ENDPOINT=true`, set
`DEPOSIT_WATCHER_ADMIN_TOKEN`, and send the token as `x-admin-token`.
`POST /api/exchange/payout-jobs/process` keeps explicit-ID processing when
`exchangeOrderIds` is present, including an explicit empty array no-op. When no
IDs are supplied, it drains pending
`funds_received` exchange orders by `limit` (default 10). The scheduled version
is separately gated by `ENABLE_EXCHANGE_PAYOUT_CRON=true` and is off by default.
The readiness report marks full live exchange payout automation only when both
deposit-triggered payout processing and this pending-drain cron are enabled.

After operator reconciliation, `POST /api/exchange/payout-jobs/:exchangeOrderId/resolve`
can close a `payout_indeterminate` order as `completed` or `failed`. This is a
local state update only; it never broadcasts a payout. Send `x-admin-token`,
`x-admin-actor`, and a note. Successful `completed` resolutions require a `txid`
evidence value, stored under `manualResolution` rather than as a broadcast
response txid.

The frontend can initiate exchange deposits from the user's wallet, but it is
still only a transaction helper. It never marks an exchange order funded. For
fund-loss protection, wallet deposit initiation requires public frontend
allowlists:

```bash
NEXT_PUBLIC_EXCHANGE_TREASURY_TRON_ADDRESS=
NEXT_PUBLIC_TRON_USDT_CONTRACT_ADDRESS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
```

The frontend verifies the order treasury/deposit destination against the public
treasury allowlist and verifies USDT transfers against the public USDT contract
allowlist before asking TronLink to sign. If those variables are absent, users
can still copy the payment instructions, but the wallet helper fails closed.

### Legacy Queue

```http
POST /api/queue
GET /api/queue
POST /api/queue/process
```

The legacy queue processor requires `THIRD_PARTY_API_URL` and the scheduled
queue cron only runs when `ENABLE_QUEUE_CRON=true`.

## Verification

```bash
npm test
node --check app.js
```

## License

ISC
