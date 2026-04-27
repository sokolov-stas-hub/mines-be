# Mines Backend

Server-side backend for the Week 3 Mines homework. Multi-tenant via the
`X-Player-Id` request header. All game logic — including the random mine
placement, multiplier formula, and balance bookkeeping — is enforced on
the server. The frontend never sees mine positions while a game is
active.

## API

Base URL: `https://<your-deployment>.vercel.app`

Every request **must** include:

```
X-Player-Id: <unique string per student, e.g. "ivan-petrenko">
Content-Type: application/json
```

A new `X-Player-Id` is auto-created on first request with a starting
balance of **10 000**.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| GET  | `/api/health` | Liveness probe (no auth) |
| GET  | `/api/balance` | Current player balance |
| GET  | `/api/history` | Last 20 games for player |
| POST | `/api/games` | Create new game |
| POST | `/api/games/:gameId/reveal` | Open a cell |
| POST | `/api/games/:gameId/cashout` | Collect winnings |
| GET  | `/api/games/:gameId` | Game state (for reload-restore) |
| GET  | `/api/games/active` | Player's active game (extension) |

Detailed request/response payloads: see the homework HTML doc.

### Quick example

```bash
curl -X POST https://<host>/api/games \
  -H "X-Player-Id: ivan" -H "Content-Type: application/json" \
  -d '{"betAmount":100,"minesCount":5}'
```

## Local development

```bash
npm install
npx vercel link --yes
npx vercel env pull .env.local --yes
npm run migrate              # one-time, applies migrations/001_init.sql
npm run dev
# → http://localhost:3000
```

## Stack

TypeScript · Express · Neon Postgres (serverless) · zod · Vercel.

## Spec & plan

- `docs/superpowers/specs/2026-04-26-mines-backend-design.md`
- `docs/superpowers/plans/2026-04-26-mines-backend.md`
