# TronRent - Tron Energy Rental Service

TronRent is a platform that allows users to rent Tron energy resources on-demand, helping them save on transaction fees and optimize their DApp performance without long-term staking commitments.

## Features

- **Instant Energy Access**: Get immediate access to Tron energy resources without long-term staking commitments.
- **Cost-Effective**: Pay only for the energy you need, reducing overall transaction costs on the Tron network.
- **Secure & Trustless**: Our smart contracts ensure secure, transparent, and trustless energy rental transactions.
- **Flexible Rental Options**: Choose from various rental packages based on your needs and budget.
- **Provider Opportunities**: Stake your TRX and earn passive income by becoming an energy provider.

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

4. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Technology Stack

- **Frontend**: Next.js, React, TailwindCSS
- **Blockchain Integration**: TronWeb (to be implemented)
- **Smart Contracts**: Solidity (to be implemented)

## Verification Hooks

The rent and exchange pages expose stable `data-testid` selectors for browser
smoke tests:

- Rent: `rent-create-order-cta`, `rent-payment-instructions`,
  `rent-order-id`, `rent-order-status`, `rent-refresh-status`,
  `rent-wallet-payment-cta`, `rent-wallet-payment-txid`,
  `rent-polling-error`
- Exchange: `exchange-create-order-cta`, `exchange-deposit-instructions`,
  `exchange-order-id`, `exchange-order-status`, `exchange-refresh-status`,
  `exchange-wallet-deposit-cta`, `exchange-wallet-deposit-txid`,
  `exchange-polling-error`

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

- [x] Initial landing page
- [ ] Wallet connection functionality
- [ ] Smart contract development for energy rental
- [ ] User dashboard for managing rentals
- [ ] Provider dashboard for managing energy offerings
- [ ] Payment integration
- [ ] Mobile optimization

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contact

For any inquiries, please reach out to us at contact@tronrent.com (placeholder).

---

Built with ❤️ for the Tron community.
