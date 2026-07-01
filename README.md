# TronRent Monorepo Workspace

This workspace contains the TronRent frontend and backend projects side by side for cross-project development.

## Projects

- `tronrent`: Next.js frontend. Development server defaults to port `3100`.
- `tronrent-server`: Express backend service. Development server defaults to the server `PORT` value, documented as `4000`.

## Setup

```bash
npm install
```

## Common Commands

```bash
npm run dev:web
npm run dev:server
npm run build:web
npm run lint:web
npm run start:server
```

## Product Progress

The active light-asset automation direction and direct-pay energy rental gap are
tracked in `docs/light-asset-progress.md`.

Server Docker helpers:

```bash
npm run docker:server:up
npm run docker:server:down
```

## Source Repositories

- `tronrent`: https://github.com/YoshiyukiSakura/tronrent, imported from `edeb202`
- `tronrent-server`: https://github.com/YoshiyukiSakura/tronrent-server, imported from `af12ac5`

The two project directories are stored as regular directories in this monorepo.
