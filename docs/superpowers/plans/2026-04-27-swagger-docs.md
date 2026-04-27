# Swagger Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interactive Swagger UI at `/api/docs` and a raw OpenAPI spec at `/api/openapi.yaml`, both publicly accessible (no `X-Player-Id` required), so students can read and try the Mines API in their browser.

**Architecture:** Hand-written `openapi.yaml` at repo root (single source of truth for documentation). New `docsRouter` reads and parses it once at module load, serves the raw YAML and a Swagger UI page. Router is registered before `playerIdMiddleware` so docs endpoints are public.

**Tech Stack:** `swagger-ui-express` (UI) · `yaml` (parser) · existing TypeScript Express + Vercel runtime.

**Spec reference:** `docs/superpowers/specs/2026-04-27-swagger-docs-design.md`

---

## File map

```
mines-backend/
├── openapi.yaml             # NEW — full OpenAPI 3.0 spec
├── package.json             # MODIFY — add 2 deps + 1 type dep
└── src/
    ├── routes/
    │   └── docs.ts          # NEW — docsRouter (UI + raw YAML)
    └── app.ts               # MODIFY — register docsRouter before playerIdMiddleware
```

---

## Task 1: Add dependencies

**Files:**
- Modify: `/Users/stas/Desktop/mines-backend/package.json`

- [ ] **Step 1: Add deps to `package.json`**

In `dependencies` (alphabetical position), add:
```
"swagger-ui-express": "^5.0.1",
"yaml": "^2.6.0",
```

In `devDependencies`, add:
```
"@types/swagger-ui-express": "^4.1.6",
```

Final relevant blocks should look like:
```json
"dependencies": {
  "@neondatabase/serverless": "^1.0.2",
  "cors": "^2.8.5",
  "express": "^4.21.0",
  "swagger-ui-express": "^5.0.1",
  "ws": "^8.18.0",
  "yaml": "^2.6.0",
  "zod": "^3.23.8"
},
"devDependencies": {
  "@types/cors": "^2.8.17",
  "@types/express": "^4.17.21",
  "@types/node": "^22.0.0",
  "@types/swagger-ui-express": "^4.1.6",
  "@types/ws": "^8.5.13",
  "tsx": "^4.19.0",
  "typescript": "^5.6.0",
  "vercel": "^52.0.0"
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: 3 new packages added (`swagger-ui-express`, `yaml`, `@types/swagger-ui-express`) plus their transitives. No errors.

- [ ] **Step 3: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: no errors.

---

## Task 2: Create `openapi.yaml`

**Files:**
- Create: `/Users/stas/Desktop/mines-backend/openapi.yaml`

- [ ] **Step 1: Create `openapi.yaml` with EXACT content**

```yaml
openapi: 3.0.3

info:
  title: Mines Backend API
  version: 0.1.0
  description: |
    Server-driven Mines game backend.
    Multi-tenant via the `X-Player-Id` request header — auto-creates a new
    player on first request with starting balance 10 000.

servers:
  - url: https://mines-be.vercel.app
    description: Production
  - url: http://localhost:3000
    description: Local development

tags:
  - name: System
    description: Liveness and meta endpoints (no auth)
  - name: Player
    description: Balance and history
  - name: Game
    description: Game lifecycle — create, reveal, cashout, state

components:
  securitySchemes:
    PlayerId:
      type: apiKey
      in: header
      name: X-Player-Id
      description: |
        Unique player identifier. Any non-empty string. New IDs are
        auto-created with a starting balance of 10 000.

  schemas:
    Error:
      type: object
      required: [error]
      properties:
        error:
          type: string
      example:
        error: Insufficient balance

    GameStatus:
      type: string
      enum: [active, won, lost]

    CellType:
      type: string
      enum: [gem, mine]

    RevealedCell:
      type: object
      required: [row, col, type]
      properties:
        row:  { type: integer, minimum: 0, maximum: 4 }
        col:  { type: integer, minimum: 0, maximum: 4 }
        type: { type: string, enum: [gem] }

    FullBoard:
      type: array
      description: 5×5 matrix of cell types — only returned on game end.
      minItems: 5
      maxItems: 5
      items:
        type: array
        minItems: 5
        maxItems: 5
        items:
          $ref: '#/components/schemas/CellType'

    CreateGameRequest:
      type: object
      required: [betAmount, minesCount]
      properties:
        betAmount:
          type: number
          exclusiveMinimum: 0
          maximum: 10000
        minesCount:
          type: integer
          enum: [1, 3, 5, 10, 24]
      example:
        betAmount: 100
        minesCount: 5

    RevealRequest:
      type: object
      required: [row, col]
      properties:
        row: { type: integer, minimum: 0, maximum: 4 }
        col: { type: integer, minimum: 0, maximum: 4 }
      example:
        row: 2
        col: 3

    CreateGameResponse:
      type: object
      required: [gameId, minesCount, betAmount, currentMultiplier, status, revealedCells, balance]
      properties:
        gameId:            { type: string, format: uuid }
        minesCount:        { type: integer }
        betAmount:         { type: number }
        currentMultiplier: { type: number }
        status:            { $ref: '#/components/schemas/GameStatus' }
        revealedCells:
          type: array
          items: { $ref: '#/components/schemas/RevealedCell' }
        balance:           { type: number }
      example:
        gameId: "4f548be0-4913-4f36-9779-a56b993ebcf5"
        minesCount: 5
        betAmount: 100
        currentMultiplier: 1
        status: active
        revealedCells: []
        balance: 9900

    RevealGemResponse:
      type: object
      required: [result, currentMultiplier, revealedCells, status, gemsFound, nextMultiplier]
      properties:
        result:            { type: string, enum: [gem] }
        currentMultiplier: { type: number }
        revealedCells:
          type: array
          items: { $ref: '#/components/schemas/RevealedCell' }
        status:            { type: string, enum: [active] }
        gemsFound:         { type: integer }
        nextMultiplier:
          type: number
          nullable: true
      example:
        result: gem
        currentMultiplier: 1.24
        revealedCells:
          - { row: 2, col: 3, type: gem }
        status: active
        gemsFound: 1
        nextMultiplier: 1.56

    RevealMineResponse:
      type: object
      required: [result, status, revealedCell, fullBoard, balance]
      properties:
        result: { type: string, enum: [mine] }
        status: { type: string, enum: [lost] }
        revealedCell:
          type: object
          required: [row, col, type]
          properties:
            row:  { type: integer }
            col:  { type: integer }
            type: { type: string, enum: [mine] }
        fullBoard: { $ref: '#/components/schemas/FullBoard' }
        balance:   { type: number }

    CashoutResponse:
      type: object
      required: [status, cashedOutMultiplier, winAmount, profit, fullBoard, balance]
      properties:
        status:              { type: string, enum: [won] }
        cashedOutMultiplier: { type: number }
        winAmount:           { type: number }
        profit:              { type: number }
        fullBoard:           { $ref: '#/components/schemas/FullBoard' }
        balance:             { type: number }
      example:
        status: won
        cashedOutMultiplier: 2.47
        winAmount: 247
        profit: 147
        fullBoard:
          - [gem, gem, mine, gem, gem]
          - [gem, mine, gem, gem, gem]
          - [gem, gem, gem, mine, gem]
          - [mine, gem, gem, gem, gem]
          - [gem, gem, gem, gem, mine]
        balance: 10147

    GameStateResponse:
      type: object
      required: [gameId, minesCount, betAmount, currentMultiplier, status, revealedCells, gemsFound, nextMultiplier]
      properties:
        gameId:            { type: string, format: uuid }
        minesCount:        { type: integer }
        betAmount:         { type: number }
        currentMultiplier: { type: number }
        status:            { $ref: '#/components/schemas/GameStatus' }
        revealedCells:
          type: array
          items: { $ref: '#/components/schemas/RevealedCell' }
        gemsFound:         { type: integer }
        nextMultiplier:
          type: number
          nullable: true

    BalanceResponse:
      type: object
      required: [balance]
      properties:
        balance: { type: number }
      example:
        balance: 10000

    HistoryGame:
      type: object
      required: [gameId, betAmount, minesCount, status, multiplier, profit, gemsFound, createdAt]
      properties:
        gameId:     { type: string, format: uuid }
        betAmount:  { type: number }
        minesCount: { type: integer }
        status:     { $ref: '#/components/schemas/GameStatus' }
        multiplier:
          type: number
          nullable: true
        profit:
          type: number
          nullable: true
        gemsFound:  { type: integer }
        createdAt:  { type: string, format: date-time }

    HistoryResponse:
      type: object
      required: [games]
      properties:
        games:
          type: array
          items: { $ref: '#/components/schemas/HistoryGame' }

security:
  - PlayerId: []

paths:
  /api/health:
    get:
      summary: Liveness probe
      tags: [System]
      security: []
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
              example: { ok: true }

  /api/balance:
    get:
      summary: Get player balance
      tags: [Player]
      responses:
        '200':
          description: Player balance
          content:
            application/json:
              schema: { $ref: '#/components/schemas/BalanceResponse' }
        '400':
          description: Missing X-Player-Id header
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /api/history:
    get:
      summary: Last 20 games for player
      tags: [Player]
      responses:
        '200':
          description: Game history
          content:
            application/json:
              schema: { $ref: '#/components/schemas/HistoryResponse' }

  /api/games:
    post:
      summary: Create new game
      description: |
        Debits the bet from balance, places mines randomly, returns the
        new gameId. Fails with 400 if the player already has an active
        game (enforced by partial unique index in DB).
      tags: [Game]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateGameRequest' }
      responses:
        '201':
          description: Game created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/CreateGameResponse' }
        '400':
          description: Insufficient balance, invalid input, or active game already exists
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /api/games/active:
    get:
      summary: Get active game for player
      description: Useful for restoring game state after a page reload.
      tags: [Game]
      responses:
        '200':
          description: Active game
          content:
            application/json:
              schema: { $ref: '#/components/schemas/GameStateResponse' }
        '404':
          description: No active game
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /api/games/{gameId}:
    get:
      summary: Get game state by ID
      tags: [Game]
      parameters:
        - in: path
          name: gameId
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: Game state
          content:
            application/json:
              schema: { $ref: '#/components/schemas/GameStateResponse' }
        '404':
          description: Game not found
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /api/games/{gameId}/reveal:
    post:
      summary: Reveal a cell
      description: Returns gem (multiplier increases) or mine (game over).
      tags: [Game]
      parameters:
        - in: path
          name: gameId
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/RevealRequest' }
      responses:
        '200':
          description: Cell revealed
          content:
            application/json:
              schema:
                oneOf:
                  - $ref: '#/components/schemas/RevealGemResponse'
                  - $ref: '#/components/schemas/RevealMineResponse'
        '400':
          description: Cell already revealed, game not active, or invalid coordinates
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
        '404':
          description: Game not found
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /api/games/{gameId}/cashout:
    post:
      summary: Cash out winnings
      description: |
        Credits `betAmount × currentMultiplier` to balance and reveals
        the full board. Requires at least one gem revealed.
      tags: [Game]
      parameters:
        - in: path
          name: gameId
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: Winnings credited
          content:
            application/json:
              schema: { $ref: '#/components/schemas/CashoutResponse' }
        '400':
          description: Game not active or no gems revealed yet
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
        '404':
          description: Game not found
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
```

- [ ] **Step 2: Validate the YAML parses cleanly**

Run:
```bash
node --import tsx -e "import('yaml').then(({parse}) => { const fs = require('node:fs'); const text = fs.readFileSync('openapi.yaml', 'utf8'); const obj = parse(text); console.log('paths:', Object.keys(obj.paths).length, 'schemas:', Object.keys(obj.components.schemas).length); });"
```

Expected output:
```
paths: 8
schemas: 15
```

If parse fails or counts diverge, the YAML is malformed — review syntax (indentation, missing colons) before continuing.

---

## Task 3: Create `src/routes/docs.ts`

**Files:**
- Create: `/Users/stas/Desktop/mines-backend/src/routes/docs.ts`

- [ ] **Step 1: Create `src/routes/docs.ts` with EXACT content**

```ts
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import swaggerUi from 'swagger-ui-express';

const yamlPath = join(process.cwd(), 'openapi.yaml');
const yamlText = readFileSync(yamlPath, 'utf8');
const spec = parseYaml(yamlText);

export const docsRouter = Router();

docsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').send(yamlText);
});

docsRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
```

Notes for the implementer:
- `readFileSync` at module top-level runs once per cold start — fine for serverless.
- `process.cwd()` resolves to the function bundle root (`/var/task` on Vercel, the repo root locally). `openapi.yaml` is included in the deployment because it's a referenced file (Vercel file tracing picks it up via the `readFileSync` reference).
- `swaggerUi.serve` is an array of middlewares (static asset serving from `swagger-ui-dist`); `swaggerUi.setup(spec)` returns the HTML render handler. Both must be on the same `/docs` mount.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

## Task 4: Wire docs router into `src/app.ts`

**Files:**
- Modify: `/Users/stas/Desktop/mines-backend/src/app.ts`

- [ ] **Step 1: Replace the contents of `src/app.ts` with this updated version**

The change: import `docsRouter` and mount it BEFORE `playerIdMiddleware` (so docs are public).

```ts
import express from 'express';
import cors from 'cors';
import { playerIdMiddleware } from './middleware/playerId.js';
import { errorHandler } from './middleware/errors.js';
import { balanceRouter } from './routes/balance.js';
import { historyRouter } from './routes/history.js';
import { gamesRouter } from './routes/games.js';
import { docsRouter } from './routes/docs.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // Health check — no X-Player-Id required
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Public docs — no X-Player-Id required, must be before playerIdMiddleware
  app.use('/api', docsRouter);

  // All other /api/* routes require X-Player-Id (auto-creates player)
  app.use('/api', playerIdMiddleware);
  app.use('/api', balanceRouter);
  app.use('/api', historyRouter);
  app.use('/api', gamesRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

## Task 5: Local smoke test

**Files:** none.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: `Mines API listening on http://localhost:3000`

- [ ] **Step 2: Curl the raw spec — public, no header**

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/openapi.yaml | head -3
```

Expected (first 3 lines + status):
```
openapi: 3.0.3
info:
  title: Mines Backend API
HTTP 200
```

- [ ] **Step 3: Curl Swagger UI HTML**

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/docs/ | head -5
```

Expected: HTML output starting with `<!DOCTYPE html>` (or similar) and `HTTP 200`. The exact body shape is whatever swagger-ui-express renders — confirm 200 and that some HTML returns.

- [ ] **Step 4: Verify auth-protected endpoints still require header**

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/balance
```

Expected: `{"error":"X-Player-Id header is required"}` and `HTTP 400`. (Confirms our public docsRouter didn't accidentally make everything public.)

- [ ] **Step 5: Open the UI in a browser (optional manual check)**

Open `http://localhost:3000/api/docs/` in a browser. The Swagger UI should load with all 8 endpoint paths grouped under tags `System`, `Player`, `Game`. Click any endpoint → "Try it out" → fill the `X-Player-Id` field at the top of the page → execute. If it works locally, it'll work on Vercel.

- [ ] **Step 6: Stop dev server** (Ctrl+C).

---

## Task 6: Commit + deploy + production smoke test

**Files:** none (uses git).

- [ ] **Step 1: Stage and commit**

```bash
git add openapi.yaml package.json package-lock.json src/app.ts src/routes/docs.ts
git commit -m "feat(docs): serve OpenAPI spec and Swagger UI at /api/docs

Hand-written openapi.yaml served via swagger-ui-express. Public
endpoints — no X-Player-Id required for /api/docs and
/api/openapi.yaml.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: Push**

```bash
git push
```

Vercel auto-redeploys on push to main.

- [ ] **Step 3: Wait for deploy to reach Ready**

Run (in foreground, polls until done):
```bash
until npx vercel ls --yes 2>/dev/null | awk '/Production/ {print $5; exit}' | grep -q Ready; do sleep 8; done
npx vercel ls --yes | head -8
```

Expected: latest deploy shows `● Ready`.

- [ ] **Step 4: Production smoke test**

```bash
URL=https://mines-be.vercel.app

echo "=== /api/openapi.yaml ==="
curl -s -w "\nHTTP %{http_code}\n" "$URL/api/openapi.yaml" | head -3

echo "=== /api/docs/ ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$URL/api/docs/"

echo "=== /api/balance (auth still required) ==="
curl -s -w "\nHTTP %{http_code}\n" "$URL/api/balance"
```

Expected:
- `/api/openapi.yaml` → first 3 lines of YAML + HTTP 200
- `/api/docs/` → HTTP 200 (HTML body suppressed)
- `/api/balance` → `{"error":"X-Player-Id header is required"}` + HTTP 400 (proves the public docs router didn't break the auth chain)

- [ ] **Step 5: Open Swagger UI in a browser**

Visit `https://mines-be.vercel.app/api/docs/` — interactive UI with all endpoints documented. Done.

---

## Self-review

**Spec coverage:**
- §3 file changes — covered by Tasks 1 (deps), 2 (yaml), 3 (route), 4 (app wiring).
- §4 dependencies — Task 1.
- §5 routing order (docsRouter BEFORE playerIdMiddleware) — Task 4 with comment in code.
- §6 router behavior (read+parse YAML once at module load, expose `/openapi.yaml` and `/docs`) — Task 3.
- §7 YAML structure (security, schemas, paths, security: [] override on /health) — Task 2.

**Placeholder scan:** Code blocks contain full content. No "TBD"/"TODO"/"similar to". Each task lists exact paths and exact commands.

**Type and naming consistency:**
- `docsRouter` (export name) used identically in `src/routes/docs.ts` (Task 3) and `src/app.ts` (Task 4).
- YAML schemas referenced by `$ref: '#/components/schemas/X'` — every X is defined in the same file (Error, GameStatus, CellType, RevealedCell, FullBoard, CreateGameRequest, RevealRequest, CreateGameResponse, RevealGemResponse, RevealMineResponse, CashoutResponse, GameStateResponse, BalanceResponse, HistoryGame, HistoryResponse — that's 15; spec count check uses 13 — let me recount: Error, GameStatus, CellType, RevealedCell, FullBoard, CreateGameRequest, RevealRequest, CreateGameResponse, RevealGemResponse, RevealMineResponse, CashoutResponse, GameStateResponse, BalanceResponse, HistoryGame, HistoryResponse = 15). Updating Task 2 sanity check: `schemas: 15`.

**Sanity check fix applied:** Task 2 Step 2 expects `schemas: 15` (not 13).
