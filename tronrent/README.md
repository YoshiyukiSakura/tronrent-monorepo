# TronRent Frontend

TronRent is the browser surface for a lightweight Tron energy rental and
TRX/USDT exchange service. Users create an order, pay the exact amount to a
treasury address by connected wallet or manual transfer, and the backend chain
scanner remains the source of truth for settlement. After payment confirmation,
the backend can buy energy from the prepaid APITRX provider balance or broadcast
an exchange payout from the configured hot wallet.

The frontend is a transaction helper and status surface. It never marks orders
as paid, never stores provider API keys or hot-wallet secrets, and fails closed
when public treasury or token allowlists are missing.

## Features

- **Energy rental orders**: Users choose a server-priced energy plan, enter the
  target Tron address, and receive exact TRX payment instructions.
- **USDT transfer-unit plans**: Rental plans are displayed as approximate USDT
  transfer counts, using the 65k energy unit common for TRC20 transfer flows.
- **Two payment paths**: Orders support connected-wallet payment to the treasury
  or manual transfer to the displayed treasury address and unique amount.
- **TRX/USDT exchange orders**: Users can quote and create TRX-to-USDT or
  USDT-to-TRX orders, then deposit the exact required asset amount.
- **Wallet transaction helpers**: TronLink can initiate TRX and allowlisted USDT
  transfers, but backend chain scanning still confirms funding.
- **Operator console**: `/ops` exposes admin-gated readiness, backlog, scan, and
  drain actions without persisting the admin token or rendering raw secrets.

## Getting Started

### Prerequisites

- Node.js 18.0 or later
- npm or yarn

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/tronrent.git
   cd tronrent
   ```

2. Install dependencies:

   ```bash
   npm install
   # or
   yarn install
   ```

3. Run the development server:

   ```bash
   npm run dev
   # or
   yarn dev
   ```

4. Open [http://localhost:3100](http://localhost:3100) in your browser to see the application.

## Technology Stack

- **Frontend**: Next.js, React, TypeScript, TailwindCSS
- **Wallet integration**: TronLink-compatible TronWeb flow through the wallet
  context.
- **Backend integration**: REST APIs served by `tronrent-server` for plans,
  orders, exchange quotes/orders, readiness, backlog, and admin actions.

## Verification Hooks

The rent, exchange, and ops pages expose stable `data-testid` selectors for
browser smoke tests:

- Rent: `rent-create-order-cta`, `rent-payment-instructions`,
  `rent-order-id`, `rent-order-status`, `rent-refresh-status`,
  `rent-wallet-payment-cta`, `rent-wallet-payment-txid`,
  `rent-payment-method-wallet`, `rent-payment-method-deposit`,
  `rent-payment-amount`, `rent-payment-address`,
  `rent-payment-reference`, `rent-polling-error`
- Exchange: `exchange-create-order-cta`, `exchange-deposit-instructions`,
  `exchange-order-id`, `exchange-order-status`, `exchange-refresh-status`,
  `exchange-wallet-deposit-cta`, `exchange-wallet-deposit-txid`,
  `exchange-polling-error`
- Ops: `ops-token-input`, `ops-load-status`, `ops-mode`,
  `ops-ready-for-live`, `ops-warnings`, `ops-backlog-summary`,
  `ops-confirm-actions`, `ops-scan-deposits`, `ops-drain-provider`,
  `ops-drain-exchange`, `ops-action-result`, `ops-error`

Run the frontend regression checks with:

```bash
npm test
```

These tests include a React server-render smoke for the selector-bearing proof
components and source checks that the pages wire those components to the stable
selectors. They are a prerequisite for browser E2E, not a replacement for a
full Playwright flow.

The wallet payment browser smoke uses a dev/test-only TronLink-compatible mock.
It is enabled only when `NODE_ENV !== "production"` and
`NEXT_PUBLIC_E2E_WALLET_MOCK=1`; production builds fail fast if that flag is set.
The mock only broadcasts TRX/TRC20 transactions and records txids. Order
settlement still comes from backend polling and chain scanning.

Run the browser wallet smoke with:

```bash
npm run test:e2e:wallet
```

The Playwright config starts Next on port `3110`, injects the wallet mock, and
writes browser artifacts outside the app directory at
`../outputs/tronrent-wallet-e2e` so Next dev does not hot-reload on test output.

## Operator Console

`/ops` is an unlisted operator page for the existing admin-gated backend routes.
It keeps the admin token in React state only, sends it as `x-admin-token`, and
does not persist it to storage, cookies, or the URL.

The page reads:

- `GET /api/admin/readiness`
- `GET /api/admin/automation/backlog`

It can trigger:

- `POST /api/deposits/scan` with an empty body, so scan-triggered provider or
  payout processing is not enabled from the UI.
- `POST /api/provider-jobs/process` with no `orderIds`, draining pending paid
  energy orders through the backend gate.
- `POST /api/exchange/payout-jobs/process` with no `exchangeOrderIds`,
  draining pending exchange payouts through the backend gate.

Action responses are reduced to counts and status fields; raw order rows,
addresses, txids, upstream payloads, and secret-shaped fields are not rendered.

## Roadmap

- [x] Energy rental order creation and exact treasury payment instructions
- [x] Connected-wallet TRX payment helper for rental orders
- [x] Manual deposit-address payment path with browser E2E proof
- [x] TRX/USDT exchange quote and order surface
- [x] Connected-wallet TRX/USDT deposit helpers for exchange orders
- [x] Admin-gated operator console for readiness, backlog, scan, and drains
- [ ] Exchange manual-deposit selector parity with rental payment instructions
- [ ] User-facing order history and manual-review status explanations
- [ ] Mobile layout pass for repeated rental/exchange workflows

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contact

For any inquiries, please reach out to us at contact@tronrent.com (placeholder).

---

Built for the TronRent monorepo.
