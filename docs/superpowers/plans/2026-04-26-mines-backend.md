# Mines Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a multi-tenant Node.js + Express + TypeScript backend for the Mines game, deployed to Vercel with Neon Postgres, implementing the API contract from the homework HTML doc plus a `GET /api/games/active` extension.

**Architecture:** Single Express app exported as a Vercel serverless function (`api/index.ts`). All state in Neon Postgres via the serverless WebSocket driver. Players auto-created on first request via `X-Player-Id` header. Game economy enforced by SQL transactions (`SELECT … FOR UPDATE`) and a partial unique index that guarantees one active game per player.

**Tech Stack:** TypeScript, Express, `@neondatabase/serverless`, `zod`, `cors`, `tsx` (dev), Vercel hosting, Neon Postgres (Vercel Marketplace integration).

**Spec reference:** `docs/superpowers/specs/2026-04-26-mines-backend-design.md`

> **No tests** — explicitly out of scope per spec. Each task ends in a commit; verification is done via `tsc --noEmit` and manual `curl` smoke tests.

---

## File map (locked in before tasks)

```
mines-backend/
├── api/
│   └── index.ts                  # Vercel entry — exports Express app
├── src/
│   ├── app.ts                    # createApp() — wires middleware + routes
│   ├── dev-server.ts             # local dev — calls app.listen
│   ├── db.ts                     # Neon pool + withTransaction helper
│   ├── types.ts                  # API DTOs (shareable with frontend)
│   ├── domain/
│   │   ├── multiplier.ts         # multiplier + nextMultiplier (pure)
│   │   ├── board.ts              # placeMines, isMine, toFullBoard (pure)
│   │   └── schemas.ts            # zod schemas for request bodies
│   ├── middleware/
│   │   ├── errors.ts             # AppError + errorHandler
│   │   └── playerId.ts           # X-Player-Id + auto-create
│   └── routes/
│       ├── balance.ts            # GET /api/balance
│       ├── history.ts            # GET /api/history
│       └── games.ts              # POST/GET games, reveal, cashout, active
├── migrations/
│   └── 001_init.sql              # CREATE TABLE/TYPE/INDEX
├── scripts/
│   └── migrate.ts                # apply migrations to DATABASE_URL
├── package.json
├── tsconfig.json
├── vercel.json
├── .gitignore
└── README.md
```

---

## Task 1: Project scaffold + dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `vercel.json`, `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mines-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --env-file=.env.local --import tsx --watch src/dev-server.ts",
    "typecheck": "tsc --noEmit",
    "migrate": "node --env-file=.env.local --import tsx scripts/migrate.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.0.2",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vercel": "^39.0.0"
  }
}
```

> `ws` is the Node WebSocket polyfill required by `@neondatabase/serverless` `Pool` (transactions) outside browsers/Edge. The HTTP `neon()` client doesn't need it, but we use `Pool` because we need stateful transactions with `SELECT … FOR UPDATE`.

> Both `dev` and `migrate` scripts use Node's native `--env-file` flag (Node ≥ 20.6) to load `.env.local`. The flag is a no-op in production on Vercel — runtime env vars come from the Vercel platform, not `.env.local` (which is git-ignored).

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "api/**/*", "scripts/**/*"]
}
```

- [ ] **Step 3: Create `vercel.json`**

```json
{
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
.env*
.vercel
dist
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vercel.json .gitignore
git commit -m "chore: scaffold TypeScript project with Express + Neon"
```

---

## Task 2: Database migration SQL + script

**Files:**
- Create: `migrations/001_init.sql`
- Create: `scripts/migrate.ts`

- [ ] **Step 1: Create `migrations/001_init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS players (
    id           TEXT PRIMARY KEY,
    balance      NUMERIC(12, 2) NOT NULL DEFAULT 10000.00,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    CREATE TYPE game_status AS ENUM ('active', 'won', 'lost');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS games (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id             TEXT NOT NULL REFERENCES players(id),
    bet_amount            NUMERIC(12, 2) NOT NULL,
    mines_count           SMALLINT NOT NULL,
    status                game_status NOT NULL DEFAULT 'active',
    mine_positions        JSONB NOT NULL,
    revealed_cells        JSONB NOT NULL DEFAULT '[]'::jsonb,
    gems_found            SMALLINT NOT NULL DEFAULT 0,
    cashed_out_multiplier NUMERIC(10, 4),
    win_amount            NUMERIC(12, 2),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_game_per_player
    ON games (player_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS games_player_created_idx
    ON games (player_id, created_at DESC);
```

- [ ] **Step 2: Create `scripts/migrate.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Run `vercel env pull .env.local` first.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const dir = join(process.cwd(), 'migrations');
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8');
  console.log(`Running ${file}...`);
  await pool.query(sql);
}

console.log('Migrations done.');
await pool.end();
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: no errors. (No source files yet under `src/`, so this only checks `scripts/`.)

- [ ] **Step 4: Commit**

```bash
git add migrations/ scripts/
git commit -m "feat(db): add initial schema and migration runner"
```

> Migration will be **applied** in Task 13 once `DATABASE_URL` is provisioned via Vercel/Neon.

---

## Task 3: Domain layer — multiplier, board, schemas

**Files:**
- Create: `src/domain/multiplier.ts`
- Create: `src/domain/board.ts`
- Create: `src/domain/schemas.ts`

- [ ] **Step 1: Create `src/domain/multiplier.ts`**

```ts
const HOUSE_EDGE = 0.01;
const TOTAL_CELLS = 25;

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

export function multiplier(minesCount: number, gemsFound: number): number {
  if (gemsFound === 0) return 1.0;
  const safe = TOTAL_CELLS - minesCount;
  const raw = combinations(TOTAL_CELLS, gemsFound) / combinations(safe, gemsFound);
  const withEdge = (1 - HOUSE_EDGE) * raw;
  return Math.round(withEdge * 100) / 100;
}

export function nextMultiplier(
  minesCount: number,
  gemsFound: number,
): number | null {
  const safeRemaining = TOTAL_CELLS - minesCount - gemsFound;
  if (safeRemaining <= 0) return null;
  return multiplier(minesCount, gemsFound + 1);
}
```

- [ ] **Step 2: Create `src/domain/board.ts`**

```ts
import { randomInt } from 'node:crypto';

export type Coord = [row: number, col: number];
export type CellType = 'gem' | 'mine';

export const TOTAL_CELLS = 25;
export const GRID_SIZE = 5;

export function placeMines(minesCount: number): Coord[] {
  const indices = Array.from({ length: TOTAL_CELLS }, (_, i) => i);
  for (let i = TOTAL_CELLS - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, minesCount).map(idx => [
    Math.floor(idx / GRID_SIZE),
    idx % GRID_SIZE,
  ]);
}

export function isMine(positions: Coord[], row: number, col: number): boolean {
  return positions.some(([r, c]) => r === row && c === col);
}

export function isCellRevealed(
  revealed: Array<{ row: number; col: number }>,
  row: number,
  col: number,
): boolean {
  return revealed.some(cell => cell.row === row && cell.col === col);
}

export function toFullBoard(positions: Coord[]): CellType[][] {
  const board: CellType[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 'gem' as CellType),
  );
  for (const [r, c] of positions) board[r][c] = 'mine';
  return board;
}
```

- [ ] **Step 3: Create `src/domain/schemas.ts`**

```ts
import { z } from 'zod';

export const createGameSchema = z.object({
  betAmount: z.number().positive().max(10_000),
  minesCount: z.union([
    z.literal(1),
    z.literal(3),
    z.literal(5),
    z.literal(10),
    z.literal(24),
  ]),
});

export const revealSchema = z.object({
  row: z.number().int().min(0).max(4),
  col: z.number().int().min(0).max(4),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;
export type RevealInput = z.infer<typeof revealSchema>;
```

- [ ] **Step 4: Quick sanity check on multiplier in REPL**

Run:
```bash
npx tsx -e "import('./src/domain/multiplier.ts').then(m => { console.log('5/1:', m.multiplier(5, 1)); console.log('5/3:', m.multiplier(5, 3)); console.log('24/1:', m.multiplier(24, 1)); console.log('1/1:', m.multiplier(1, 1)); });"
```

Expected output:
```
5/1: 1.3
5/3: 2.42
24/1: 24.75
1/1: 1.03
```

If numbers diverge from these, the formula or rounding is wrong — fix before moving on.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/
git commit -m "feat(domain): add multiplier formula, mine placement, and zod schemas"
```

---

## Task 4: Shared API DTO types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
export type GameStatus = 'active' | 'won' | 'lost';
export type CellType = 'gem' | 'mine';

export interface RevealedCell {
  row: number;
  col: number;
  type: 'gem';
}

export interface CreateGameResponse {
  gameId: string;
  minesCount: number;
  betAmount: number;
  currentMultiplier: number;
  status: GameStatus;
  revealedCells: RevealedCell[];
  balance: number;
}

export interface RevealGemResponse {
  result: 'gem';
  currentMultiplier: number;
  revealedCells: RevealedCell[];
  status: 'active';
  gemsFound: number;
  nextMultiplier: number | null;
}

export interface RevealMineResponse {
  result: 'mine';
  status: 'lost';
  revealedCell: { row: number; col: number; type: 'mine' };
  fullBoard: CellType[][];
  balance: number;
}

export interface CashoutResponse {
  status: 'won';
  cashedOutMultiplier: number;
  winAmount: number;
  profit: number;
  fullBoard: CellType[][];
  balance: number;
}

export interface GameStateResponse {
  gameId: string;
  minesCount: number;
  betAmount: number;
  currentMultiplier: number;
  status: GameStatus;
  revealedCells: RevealedCell[];
  gemsFound: number;
  nextMultiplier: number | null;
}

export interface BalanceResponse {
  balance: number;
}

export interface HistoryGame {
  gameId: string;
  betAmount: number;
  minesCount: number;
  status: GameStatus;
  multiplier: number | null;
  profit: number | null;
  gemsFound: number;
  createdAt: string;
}

export interface HistoryResponse {
  games: HistoryGame[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add API DTO types"
```

---

## Task 5: DB module (Neon pool + withTransaction)

**Files:**
- Create: `src/db.ts`

- [ ] **Step 1: Create `src/db.ts`**

```ts
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// In Node.js (non-Edge), the Neon serverless driver needs a WebSocket polyfill.
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type PoolClient = Awaited<ReturnType<typeof pool.connect>>;

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat(db): add Neon pool and withTransaction helper"
```

---

## Task 6: Middleware — errors and playerId

**Files:**
- Create: `src/middleware/errors.ts`
- Create: `src/middleware/playerId.ts`

- [ ] **Step 1: Create `src/middleware/errors.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const path = issue.path.join('.');
    return res
      .status(400)
      .json({ error: path ? `${path}: ${issue.message}` : issue.message });
  }
  // Postgres unique_violation → partial unique index on active games
  if (typeof err === 'object' && err !== null && 'code' in err) {
    if ((err as { code: unknown }).code === '23505') {
      return res.status(400).json({ error: 'Active game already exists' });
    }
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 2: Create `src/middleware/playerId.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db.ts';
import { AppError } from './errors.ts';

declare global {
  namespace Express {
    interface Request {
      playerId: string;
    }
  }
}

export async function playerIdMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const playerId = req.header('X-Player-Id');
    if (!playerId || playerId.trim().length === 0) {
      throw new AppError(400, 'X-Player-Id header is required');
    }
    await pool.query(
      'INSERT INTO players (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [playerId],
    );
    req.playerId = playerId;
    next();
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/middleware/
git commit -m "feat(middleware): add error handler and X-Player-Id auto-create"
```

---

## Task 7: Routes — balance and history

**Files:**
- Create: `src/routes/balance.ts`
- Create: `src/routes/history.ts`

- [ ] **Step 1: Create `src/routes/balance.ts`**

```ts
import { Router } from 'express';
import { pool } from '../db.ts';
import type { BalanceResponse } from '../types.ts';

export const balanceRouter = Router();

balanceRouter.get('/balance', async (req, res, next) => {
  try {
    const result = await pool.query<{ balance: string }>(
      'SELECT balance FROM players WHERE id = $1',
      [req.playerId],
    );
    const row = result.rows[0];
    const response: BalanceResponse = { balance: Number(row.balance) };
    res.json(response);
  } catch (err) {
    next(err);
  }
});
```

> Note: `playerIdMiddleware` runs before this and guarantees the player row exists, so `rows[0]` is always defined.

- [ ] **Step 2: Create `src/routes/history.ts`**

```ts
import { Router } from 'express';
import { pool } from '../db.ts';
import type { HistoryResponse, GameStatus } from '../types.ts';

interface HistoryRow {
  id: string;
  bet_amount: string;
  mines_count: number;
  status: GameStatus;
  cashed_out_multiplier: string | null;
  win_amount: string | null;
  gems_found: number;
  created_at: Date;
}

export const historyRouter = Router();

historyRouter.get('/history', async (req, res, next) => {
  try {
    const result = await pool.query<HistoryRow>(
      `SELECT id, bet_amount, mines_count, status, cashed_out_multiplier,
              win_amount, gems_found, created_at
         FROM games
        WHERE player_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [req.playerId],
    );

    const response: HistoryResponse = {
      games: result.rows.map(r => ({
        gameId: r.id,
        betAmount: Number(r.bet_amount),
        minesCount: r.mines_count,
        status: r.status,
        multiplier: r.cashed_out_multiplier
          ? Number(r.cashed_out_multiplier)
          : null,
        profit: r.win_amount
          ? Math.round((Number(r.win_amount) - Number(r.bet_amount)) * 100) / 100
          : null,
        gemsFound: r.gems_found,
        createdAt: r.created_at.toISOString(),
      })),
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/balance.ts src/routes/history.ts
git commit -m "feat(routes): add GET /api/balance and GET /api/history"
```

---

## Task 8: Games router — POST /api/games (create)

**Files:**
- Create: `src/routes/games.ts`

- [ ] **Step 1: Create `src/routes/games.ts` with shared types and create handler**

```ts
import { Router } from 'express';
import { pool, withTransaction } from '../db.ts';
import { AppError } from '../middleware/errors.ts';
import { createGameSchema, revealSchema } from '../domain/schemas.ts';
import { multiplier, nextMultiplier } from '../domain/multiplier.ts';
import {
  placeMines,
  isMine,
  isCellRevealed,
  toFullBoard,
  type Coord,
} from '../domain/board.ts';
import type {
  CreateGameResponse,
  RevealGemResponse,
  RevealMineResponse,
  CashoutResponse,
  GameStateResponse,
  RevealedCell,
} from '../types.ts';

export const gamesRouter = Router();

interface GameRow {
  id: string;
  player_id: string;
  bet_amount: string;
  mines_count: number;
  status: 'active' | 'won' | 'lost';
  mine_positions: Coord[];
  revealed_cells: RevealedCell[];
  gems_found: number;
  cashed_out_multiplier: string | null;
  win_amount: string | null;
}

// POST /api/games — create new game (debit balance + insert with unique index)
gamesRouter.post('/games', async (req, res, next) => {
  try {
    const { betAmount, minesCount } = createGameSchema.parse(req.body);
    const minePositions = placeMines(minesCount);

    const result = await withTransaction(async client => {
      const balanceRes = await client.query<{ balance: string }>(
        'SELECT balance FROM players WHERE id = $1 FOR UPDATE',
        [req.playerId],
      );
      const balance = Number(balanceRes.rows[0].balance);
      if (balance < betAmount) {
        throw new AppError(400, 'Insufficient balance');
      }

      await client.query(
        'UPDATE players SET balance = balance - $1 WHERE id = $2',
        [betAmount, req.playerId],
      );

      const gameRes = await client.query<{ id: string }>(
        `INSERT INTO games (player_id, bet_amount, mines_count, mine_positions)
              VALUES ($1, $2, $3, $4)
           RETURNING id`,
        [req.playerId, betAmount, minesCount, JSON.stringify(minePositions)],
      );

      return {
        gameId: gameRes.rows[0].id,
        newBalance: Math.round((balance - betAmount) * 100) / 100,
      };
    });

    const response: CreateGameResponse = {
      gameId: result.gameId,
      minesCount,
      betAmount,
      currentMultiplier: 1.0,
      status: 'active',
      revealedCells: [],
      balance: result.newBalance,
    };
    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Imports for reveal/cashout/state are present but unused yet — TS is fine with that since we didn't enable `noUnusedLocals`.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/games.ts
git commit -m "feat(routes): POST /api/games creates game atomically"
```

---

## Task 9: Games router — POST /api/games/:gameId/reveal

**Files:**
- Modify: `src/routes/games.ts`

- [ ] **Step 1: Append the reveal handler to `src/routes/games.ts`**

Add this block at the end of the file (after the `POST /games` handler):

```ts
// POST /api/games/:gameId/reveal — open a cell
gamesRouter.post('/games/:gameId/reveal', async (req, res, next) => {
  try {
    const { row, col } = revealSchema.parse(req.body);
    const { gameId } = req.params;

    const result = await withTransaction(async client => {
      const gameRes = await client.query<GameRow>(
        `SELECT * FROM games
          WHERE id = $1 AND player_id = $2
            FOR UPDATE`,
        [gameId, req.playerId],
      );
      const game = gameRes.rows[0];
      if (!game) throw new AppError(404, 'Game not found');
      if (game.status !== 'active') throw new AppError(400, 'Game not active');
      if (isCellRevealed(game.revealed_cells, row, col)) {
        throw new AppError(400, 'Cell already revealed');
      }

      // Mine hit → game over
      if (isMine(game.mine_positions, row, col)) {
        await client.query(
          `UPDATE games SET status = 'lost', finished_at = now() WHERE id = $1`,
          [gameId],
        );
        const balanceRes = await client.query<{ balance: string }>(
          'SELECT balance FROM players WHERE id = $1',
          [req.playerId],
        );
        const response: RevealMineResponse = {
          result: 'mine',
          status: 'lost',
          revealedCell: { row, col, type: 'mine' },
          fullBoard: toFullBoard(game.mine_positions),
          balance: Number(balanceRes.rows[0].balance),
        };
        return response;
      }

      // Gem found → append to revealed_cells, bump multiplier
      const newCell: RevealedCell = { row, col, type: 'gem' };
      const newRevealed = [...game.revealed_cells, newCell];
      const newGems = game.gems_found + 1;
      const mult = multiplier(game.mines_count, newGems);

      await client.query(
        `UPDATE games
            SET revealed_cells = $1, gems_found = $2
          WHERE id = $3`,
        [JSON.stringify(newRevealed), newGems, gameId],
      );

      const response: RevealGemResponse = {
        result: 'gem',
        currentMultiplier: mult,
        revealedCells: newRevealed,
        status: 'active',
        gemsFound: newGems,
        nextMultiplier: nextMultiplier(game.mines_count, newGems),
      };
      return response;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/games.ts
git commit -m "feat(routes): POST /reveal — gem updates multiplier, mine ends game"
```

---

## Task 10: Games router — POST /api/games/:gameId/cashout

**Files:**
- Modify: `src/routes/games.ts`

- [ ] **Step 1: Append cashout handler to `src/routes/games.ts`**

Add this block after the reveal handler:

```ts
// POST /api/games/:gameId/cashout — collect winnings
gamesRouter.post('/games/:gameId/cashout', async (req, res, next) => {
  try {
    const { gameId } = req.params;

    const result = await withTransaction(async client => {
      const gameRes = await client.query<GameRow>(
        `SELECT * FROM games
          WHERE id = $1 AND player_id = $2
            FOR UPDATE`,
        [gameId, req.playerId],
      );
      const game = gameRes.rows[0];
      if (!game) throw new AppError(404, 'Game not found');
      if (game.status !== 'active') throw new AppError(400, 'Game not active');
      if (game.gems_found === 0) {
        throw new AppError(400, 'No gems revealed yet');
      }

      const mult = multiplier(game.mines_count, game.gems_found);
      const bet = Number(game.bet_amount);
      const winAmount = Math.round(bet * mult * 100) / 100;
      const profit = Math.round((winAmount - bet) * 100) / 100;

      await client.query(
        `UPDATE games
            SET status = 'won',
                cashed_out_multiplier = $1,
                win_amount = $2,
                finished_at = now()
          WHERE id = $3`,
        [mult, winAmount, gameId],
      );

      const balanceRes = await client.query<{ balance: string }>(
        `UPDATE players
            SET balance = balance + $1
          WHERE id = $2
          RETURNING balance`,
        [winAmount, req.playerId],
      );

      const response: CashoutResponse = {
        status: 'won',
        cashedOutMultiplier: mult,
        winAmount,
        profit,
        fullBoard: toFullBoard(game.mine_positions),
        balance: Number(balanceRes.rows[0].balance),
      };
      return response;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/games.ts
git commit -m "feat(routes): POST /cashout — credits winnings and reveals board"
```

---

## Task 11: Games router — GET /api/games/active and GET /api/games/:gameId

**Files:**
- Modify: `src/routes/games.ts`

> **Routing order matters:** `GET /games/active` MUST be registered **before** `GET /games/:gameId` — otherwise Express would treat `"active"` as a `:gameId` value and never reach the active handler.

- [ ] **Step 1: Append the two GET handlers to `src/routes/games.ts`**

Add this block after the cashout handler:

```ts
// GET /api/games/active — current active game for player (extension beyond doc)
gamesRouter.get('/games/active', async (req, res, next) => {
  try {
    const result = await pool.query<GameRow>(
      `SELECT * FROM games
        WHERE player_id = $1 AND status = 'active'
        LIMIT 1`,
      [req.playerId],
    );
    const game = result.rows[0];
    if (!game) throw new AppError(404, 'No active game');

    const response: GameStateResponse = {
      gameId: game.id,
      minesCount: game.mines_count,
      betAmount: Number(game.bet_amount),
      currentMultiplier: multiplier(game.mines_count, game.gems_found),
      status: game.status,
      revealedCells: game.revealed_cells,
      gemsFound: game.gems_found,
      nextMultiplier: nextMultiplier(game.mines_count, game.gems_found),
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// GET /api/games/:gameId — fetch any game by id (for restore-on-reload)
gamesRouter.get('/games/:gameId', async (req, res, next) => {
  try {
    const { gameId } = req.params;
    const result = await pool.query<GameRow>(
      'SELECT * FROM games WHERE id = $1 AND player_id = $2',
      [gameId, req.playerId],
    );
    const game = result.rows[0];
    if (!game) throw new AppError(404, 'Game not found');

    const response: GameStateResponse = {
      gameId: game.id,
      minesCount: game.mines_count,
      betAmount: Number(game.bet_amount),
      currentMultiplier: multiplier(game.mines_count, game.gems_found),
      status: game.status,
      revealedCells: game.revealed_cells,
      gemsFound: game.gems_found,
      nextMultiplier: nextMultiplier(game.mines_count, game.gems_found),
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/games.ts
git commit -m "feat(routes): GET /games/active and GET /games/:id"
```

---

## Task 12: App assembly + dev server + Vercel entry

**Files:**
- Create: `src/app.ts`
- Create: `src/dev-server.ts`
- Create: `api/index.ts`

- [ ] **Step 1: Create `src/app.ts`**

```ts
import express from 'express';
import cors from 'cors';
import { playerIdMiddleware } from './middleware/playerId.ts';
import { errorHandler } from './middleware/errors.ts';
import { balanceRouter } from './routes/balance.ts';
import { historyRouter } from './routes/history.ts';
import { gamesRouter } from './routes/games.ts';

export function createApp() {
  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // Health check — no X-Player-Id required
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // All other /api/* routes require X-Player-Id (auto-creates player)
  app.use('/api', playerIdMiddleware);
  app.use('/api', balanceRouter);
  app.use('/api', historyRouter);
  app.use('/api', gamesRouter);

  app.use(errorHandler);
  return app;
}
```

> The `/api/health` route is registered **before** `playerIdMiddleware`, so it bypasses the header check — useful for uptime probes.

- [ ] **Step 2: Create `src/dev-server.ts`**

```ts
import { createApp } from './app.ts';

const app = createApp();
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Mines API listening on http://localhost:${port}`);
});
```

- [ ] **Step 3: Create `api/index.ts`**

```ts
import { createApp } from '../src/app.ts';

export default createApp();
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/dev-server.ts api/index.ts
git commit -m "feat(app): wire middleware + routes + dev/Vercel entry points"
```

---

## Task 13: Provision Neon Postgres + apply migration

> One-time manual setup. Requires a Vercel account, the Vercel CLI, and a GitHub repo for this project. Uses the `vercel integration add neon` flow (preferred per Vercel guidance) instead of the dashboard click-through.

**Files:** none (configuration in Vercel + Neon).

- [ ] **Step 1: Push repo to GitHub**

```bash
gh repo create mines-backend --private --source=. --remote=origin --push
```

(Or create via the GitHub UI and `git remote add origin … && git push -u origin main`.)

- [ ] **Step 2: Confirm Vercel CLI auth and link the repo**

```bash
npx vercel --version
npx vercel whoami
npx vercel link --yes
```

The `link` command will prompt for team/project — pick or create a project named `mines-backend`. After it succeeds, `.vercel/project.json` exists.

- [ ] **Step 3: Initial deploy (without DB — routes will 500 but build succeeds)**

```bash
npx vercel deploy
```

Note the preview URL printed at the end. The build must succeed; runtime errors are expected here.

- [ ] **Step 4: Add Neon via Vercel Marketplace integration**

```bash
npx vercel integration add neon
```

Follow the prompts: select free plan, attach to the `mines-backend` project, enable for Production + Preview + Development. This auto-provisions `DATABASE_URL` (and related Neon env vars) into the Vercel project.

- [ ] **Step 5: Pull env vars locally**

```bash
npx vercel env pull .env.local --yes
```

Verify `.env.local` contains a `DATABASE_URL=postgres://…` line:

```bash
grep -c '^DATABASE_URL=' .env.local
```

Expected: `1`.

- [ ] **Step 6: Apply the migration**

```bash
npm run migrate
```

Expected output:
```
Running 001_init.sql...
Migrations done.
```

- [ ] **Step 7: Promote to production**

```bash
git commit --allow-empty -m "chore: trigger production redeploy with Neon connected"
git push
npx vercel deploy --prod
```

(Either action triggers a production deploy; doing both ensures both Git-driven and CLI-driven flows work.)

---

## Task 14: Local smoke test

**Files:** none (manual verification).

- [ ] **Step 1: Start the dev server**

In one terminal:
```bash
npm run dev
```

Expected: `Mines API listening on http://localhost:3000`.

- [ ] **Step 2: Health check**

```bash
curl -s http://localhost:3000/api/health
```

Expected: `{"ok":true}`.

- [ ] **Step 3: Get balance for new player (auto-create)**

```bash
curl -s -H "X-Player-Id: smoke-test" http://localhost:3000/api/balance
```

Expected: `{"balance":10000}`.

- [ ] **Step 4: Reject missing header**

```bash
curl -s -i http://localhost:3000/api/balance | head -1
```

Expected: `HTTP/1.1 400 Bad Request`.

- [ ] **Step 5: Create a game**

```bash
curl -s -X POST -H "X-Player-Id: smoke-test" -H "Content-Type: application/json" \
  -d '{"betAmount":100,"minesCount":5}' \
  http://localhost:3000/api/games
```

Expected: `{"gameId":"…","minesCount":5,"betAmount":100,"currentMultiplier":1,"status":"active","revealedCells":[],"balance":9900}`.
**Save the `gameId`** for the next step.

- [ ] **Step 6: Reject a second concurrent game**

```bash
curl -s -X POST -H "X-Player-Id: smoke-test" -H "Content-Type: application/json" \
  -d '{"betAmount":50,"minesCount":3}' \
  http://localhost:3000/api/games
```

Expected: `{"error":"Active game already exists"}` (HTTP 400).

- [ ] **Step 7: Reveal a cell, then cashout**

Replace `<GAME_ID>` with the saved id. The server randomly placed mines; if a cell happens to be a mine, repeat with another `(row,col)` after starting a new game.

```bash
curl -s -X POST -H "X-Player-Id: smoke-test" -H "Content-Type: application/json" \
  -d '{"row":0,"col":0}' \
  http://localhost:3000/api/games/<GAME_ID>/reveal
```

Expected (gem case): `{"result":"gem","currentMultiplier":1.3,"revealedCells":[…],…}`.

Then:
```bash
curl -s -X POST -H "X-Player-Id: smoke-test" \
  http://localhost:3000/api/games/<GAME_ID>/cashout
```

Expected: `{"status":"won","cashedOutMultiplier":1.3,"winAmount":130,"profit":30,"fullBoard":[…],"balance":10030}`.

- [ ] **Step 8: Check history**

```bash
curl -s -H "X-Player-Id: smoke-test" http://localhost:3000/api/history
```

Expected: `{"games":[{"gameId":"…","status":"won",…}]}` (the game just played appears).

- [ ] **Step 9: Stop the dev server** (Ctrl+C).

If anything diverges from expected, fix and re-run before continuing. No commit — this task is verification-only.

---

## Task 15: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Task 16: Final deployment verification

**Files:** none.

- [ ] **Step 1: Push README and any pending commits**

```bash
git push
```

Wait for the Vercel deployment to finish (~30–60s). Note the production URL from the Vercel dashboard or `npx vercel ls`.

- [ ] **Step 2: Smoke-test the live deployment**

Replace `<HOST>` with the production URL.

```bash
curl -s https://<HOST>/api/health
# → {"ok":true}

curl -s -H "X-Player-Id: prod-smoke" https://<HOST>/api/balance
# → {"balance":10000}

curl -s -X POST -H "X-Player-Id: prod-smoke" -H "Content-Type: application/json" \
  -d '{"betAmount":100,"minesCount":5}' \
  https://<HOST>/api/games
# → {"gameId":"...","balance":9900,...}
```

If any of these fail:
- Check the Vercel runtime logs (`npx vercel logs <deployment-url>`).
- Confirm Neon integration is connected and `DATABASE_URL` is set in **Production** env vars (Vercel dashboard → Project → Settings → Environment Variables).
- Re-run the migration if the `players` / `games` tables are missing.

- [ ] **Step 3: Done**

Share the production URL with the frontend students. No further commits required.

---

## Self-review notes

- All spec sections covered: schema (Task 2), domain logic (Tasks 3–4), DB layer (Task 5), middleware (Task 6), all 7 endpoints (Tasks 7–11), assembly (Task 12), deployment (Task 13), verification (Tasks 14, 16), docs (Task 15).
- No tests by design (spec §10).
- Routing order for `/games/active` vs `/games/:gameId` is explicitly called out in Task 11.
- Money rounding to 0.01 is consistent across multiplier output, cashout `winAmount`/`profit`, and balance arithmetic.
- `mine_positions` is never returned to the client while `status = 'active'` — only `toFullBoard()` mappings on cashout/lost responses.
- All function names are stable across tasks (`multiplier`, `nextMultiplier`, `placeMines`, `isMine`, `isCellRevealed`, `toFullBoard`, `withTransaction`, `playerIdMiddleware`, `errorHandler`, `createApp`).
