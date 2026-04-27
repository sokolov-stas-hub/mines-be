# Mines Backend — Design Spec

**Дата:** 2026-04-26
**Автор:** Stas
**Статус:** Approved (brainstorming)

## 1. Контекст і мета

Бекенд для навчальної гри **Mines** (домашка Week 3). Уся ігрова логіка — на сервері; фронтенди студентів спілкуються виключно через REST API. Один інстанс бекенду обслуговує всіх студентів класу одночасно (multi-tenant).

Документація API для студентів — окремий HTML-файл, авторитетне джерело контракту. Ця спека описує **серверну реалізацію** того контракту, плюс розширення `GET /api/games/active`.

## 2. Архітектурні рішення (підсумок)

| Рішення | Значення | Обґрунтування |
|---|---|---|
| Stack | Node.js + Express + TypeScript | Узгоджено з фронтом студентів; типи DTO можна шарити |
| Хостинг | Vercel (serverless function) | Free tier, auto-deploy з GitHub, нуль maintenance |
| База | Neon Postgres через Vercel Marketplace | Авто-провіжинг env vars, serverless driver, транзакції |
| Auth / identity | `X-Player-Id` header (auto-create) | Достатньо для класу, без тертя для студента |
| Множник | Stake-style формула з house edge 1% | Збігається з прикладами в доці, ~10 рядків коду |
| Покинуті ігри | Без TTL, без cron — як у доці | Фронт відновлює через `GET /api/games/:id` або `/active` |
| Тести | Немає | Скорочення обсягу домашки |
| RNG | `crypto.randomInt` + Fisher-Yates | Чесно і дешево |

## 3. Архітектура

```
Frontend (React + RQ)  ──HTTPS──►  Vercel Function (Express)  ──SQL──►  Neon Postgres
       X-Player-Id                  validation, game logic              players, games
                       ◄── JSON ──  multiplier calc            ◄────
```

- Один файл `api/index.ts` експортує Express app — Vercel автоматично треатить як serverless function.
- `vercel.json`: rewrite `/api/*` → `/api/index`.
- Neon Serverless driver (`@neondatabase/serverless`) — через WebSocket, без cold-start пенальті, без проблем з connection limits.
- Жодного state у RAM — все в Postgres. Кожен виклик функції може бути cold-start.

## 4. Схема БД

```sql
CREATE TABLE players (
    id           TEXT PRIMARY KEY,            -- X-Player-Id
    balance      NUMERIC(12, 2) NOT NULL DEFAULT 10000.00,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE game_status AS ENUM ('active', 'won', 'lost');

CREATE TABLE games (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id             TEXT NOT NULL REFERENCES players(id),
    bet_amount            NUMERIC(12, 2) NOT NULL,
    mines_count           SMALLINT NOT NULL,
    status                game_status NOT NULL DEFAULT 'active',
    mine_positions        JSONB NOT NULL,          -- [[r,c],...] — приховано доки active
    revealed_cells        JSONB NOT NULL DEFAULT '[]',  -- [{row,col,type:"gem"}]
    gems_found            SMALLINT NOT NULL DEFAULT 0,
    cashed_out_multiplier NUMERIC(10, 4),
    win_amount            NUMERIC(12, 2),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at           TIMESTAMPTZ
);

-- Контракт "одна активна гра на гравця" на рівні БД
CREATE UNIQUE INDEX one_active_game_per_player
    ON games (player_id) WHERE status = 'active';

-- Для GET /api/history
CREATE INDEX games_player_created_idx
    ON games (player_id, created_at DESC);
```

**Інваріанти:**
- `mine_positions` — масив унікальних `[row, col]` довжини `mines_count`, рядки/колонки 0..4.
- `revealed_cells` ніколи не містить координати з `mine_positions`, поки `status = 'active'` (натрапив на міну → одразу `status = 'lost'`).
- `gems_found = length(revealed_cells)` — інваріант, підтримуємо в коді.
- `NUMERIC(12,2)` для всіх грошей — без float-помилок.
- Сервер **ніколи** не повертає `mine_positions` клієнту, поки гра активна; на cashout/lost мепимо в `fullBoard` 5×5.

## 5. API контракт

Ендпоінти (повна специфікація request/response — у HTML-доці для студентів):

| Метод | Шлях | Транзакція | Опис |
|---|---|---|---|
| POST | `/api/games` | Так | Створити гру (debit + insert) |
| POST | `/api/games/:id/reveal` | Так | Відкрити клітинку |
| POST | `/api/games/:id/cashout` | Так | Забрати виграш |
| GET | `/api/games/:id` | Ні | Стан гри |
| GET | `/api/games/active` | Ні | **Розширення:** активна гра поточного гравця |
| GET | `/api/balance` | Ні | Баланс гравця |
| GET | `/api/history` | Ні | Останні 20 ігор |

### Middleware (порядок)

1. `cors({ origin: '*' })` — фронт студентів з `localhost:5173`.
2. `express.json()`.
3. `requirePlayerId` — 400 якщо немає `X-Player-Id`.
4. `ensurePlayer` — `INSERT INTO players ... ON CONFLICT DO NOTHING`.
5. Route handlers.
6. `errorHandler` — мапить помилки в `{ error: "..." }` + статус.

### Validation (zod)

- `betAmount`: `number`, `> 0`, `≤ player.balance`, `≤ 10_000` (max bet константа).
- `minesCount`: `1 | 3 | 5 | 10 | 24` (як у доці).
- `row`, `col`: `int`, `0..4`.

### Мапа кодів помилок

| Сценарій | Статус | `error` тіло |
|---|---|---|
| Немає `X-Player-Id` | 400 | `"X-Player-Id header is required"` |
| zod validation fail | 400 | `<перший issue>` |
| Insufficient balance | 400 | `"Insufficient balance"` |
| Активна гра вже є | 400 | `"Active game already exists"` |
| Гра не активна | 400 | `"Game not active"` |
| Cashout до першого gem | 400 | `"No gems revealed yet"` |
| Клітинка вже відкрита | 400 | `"Cell already revealed"` |
| Гра не знайдена / не твоя | 404 | `"Game not found"` |
| Інше | 500 | `"Internal server error"` (без stack) |

## 6. Транзакції

Усі три ігрові ендпоінти обгорнуті в `withTransaction(client => ...)`. Ізоляція — `READ COMMITTED` (default), `SELECT ... FOR UPDATE` блокує конкурентні reveal/cashout по тій же грі.

### A. POST /api/games

```
BEGIN
  SELECT balance FROM players WHERE id = $playerId FOR UPDATE
  IF balance < betAmount → ROLLBACK, 400 "Insufficient balance"
  UPDATE players SET balance = balance - $betAmount WHERE id = $playerId
  INSERT INTO games (player_id, bet_amount, mines_count, mine_positions)
                   VALUES ($playerId, $bet, $mines, $minePositions)
    -- partial unique index → unique_violation якщо вже є active
  ON CONFLICT → ROLLBACK, 400 "Active game already exists"
COMMIT
```

`minePositions` генерується в коді: Fisher-Yates shuffle 25 індексів через `crypto.randomInt`, беремо перші `minesCount`, мепимо в `[row, col]`.

Response: як у доці (`gameId`, `currentMultiplier: 1.0`, `revealedCells: []`, `balance`).

### B. POST /api/games/:id/reveal

```
BEGIN
  SELECT * FROM games WHERE id = $gameId AND player_id = $playerId FOR UPDATE
  IF NOT FOUND → 404
  IF status != 'active' → 400 "Game not active"
  IF (row,col) ∈ revealed_cells → 400 "Cell already revealed"
  IF (row,col) ∈ mine_positions:
      UPDATE games SET status='lost', finished_at=now()
      RETURN { result:"mine", status:"lost", revealedCell, fullBoard, balance }
  ELSE:
      newRevealed = revealed_cells ++ [{row, col, type:"gem"}]
      gems = gems_found + 1
      mult = multiplier(mines_count, gems)
      UPDATE games SET revealed_cells = newRevealed, gems_found = gems
      RETURN {
        result: "gem",
        currentMultiplier: mult,
        revealedCells: newRevealed,
        status: "active",
        gemsFound: gems,
        nextMultiplier: nextMultiplier(mines_count, gems)
      }
COMMIT
```

`fullBoard`: 5×5 матриця, `"mine"` для координат у `mine_positions`, `"gem"` для решти.

### C. POST /api/games/:id/cashout

```
BEGIN
  SELECT * FROM games WHERE id = $gameId AND player_id = $playerId FOR UPDATE
  IF status != 'active' → 400 "Game not active"
  IF gems_found = 0 → 400 "No gems revealed yet"
  mult = multiplier(mines_count, gems_found)
  winAmount = bet_amount * mult
  UPDATE games SET status='won', cashed_out_multiplier=mult,
                   win_amount=winAmount, finished_at=now()
  UPDATE players SET balance = balance + winAmount WHERE id = $playerId
  RETURN newBalance
COMMIT

Response: { status:"won", cashedOutMultiplier, winAmount, profit, fullBoard, balance }
```

## 7. Формула множника

Stake-style з house edge 1%:

```
multiplier(mines, gems) = (1 - 0.01) × C(25, gems) / C(25 - mines, gems)
```

```ts
const HOUSE_EDGE = 0.01;
const TOTAL_CELLS = 25;

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}

export function multiplier(minesCount: number, gemsFound: number): number {
  if (gemsFound === 0) return 1.0;
  const safe = TOTAL_CELLS - minesCount;
  const raw = combinations(TOTAL_CELLS, gemsFound) / combinations(safe, gemsFound);
  const withEdge = (1 - HOUSE_EDGE) * raw;
  return Math.round(withEdge * 100) / 100;
}

export function nextMultiplier(minesCount: number, gemsFound: number): number | null {
  const safeRemaining = (TOTAL_CELLS - minesCount) - gemsFound;
  if (safeRemaining <= 0) return null;
  return multiplier(minesCount, gemsFound + 1);
}
```

Контрольні значення (точні, з округленням до 0.01):
- `multiplier(1, 1)` = 1.03
- `multiplier(5, 1)` = 1.24
- `multiplier(5, 3)` = 2.00
- `multiplier(24, 1)` = 24.75

## 8. Структура проекту

```
mines-backend/
├── api/
│   └── index.ts                  # Vercel entry — exports Express app
├── src/
│   ├── app.ts                    # createApp() — будує Express, реєструє routes
│   ├── db.ts                     # Neon pool, withTransaction(fn) helper
│   ├── middleware/
│   │   ├── playerId.ts           # X-Player-Id + auto-create
│   │   └── errors.ts             # AppError class + errorHandler
│   ├── routes/
│   │   ├── games.ts              # POST/GET games, reveal, cashout, active
│   │   ├── balance.ts            # GET /api/balance
│   │   └── history.ts            # GET /api/history
│   ├── domain/
│   │   ├── multiplier.ts         # формула + nextMultiplier
│   │   ├── board.ts              # placeMines, isMine, toFullBoard
│   │   └── schemas.ts            # zod schemas для request bodies
│   └── types.ts                  # API DTOs (можна копіювати у фронт)
├── migrations/
│   └── 001_init.sql              # CREATE TABLE/INDEX/TYPE
├── scripts/
│   └── migrate.ts                # читає migrations/, бʼє в DATABASE_URL
├── package.json
├── tsconfig.json
├── vercel.json
└── README.md
```

**Принципи розбиття:**
- `routes/*` — тонкі: парсять запит, кличуть domain, форматують response. Ноль бізнес-логіки.
- `domain/*` — pure functions без знання про Express/Postgres.
- `db.ts` тримає Neon pool на module level (Vercel переюзає warm function instance).

### Залежності

| Runtime | Dev |
|---|---|
| `express` | `typescript` |
| `@neondatabase/serverless` | `@types/express`, `@types/node` |
| `zod` | `tsx` |
| `cors` | `vercel` |

### `vercel.json`

```json
{
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }]
}
```

### Скрипти

```
"dev":     "tsx watch api/index.ts"
"build":   "tsc"
"migrate": "tsx scripts/migrate.ts"
```

## 9. Deployment

1. `git init` + push на GitHub.
2. Vercel → Import Repository.
3. Vercel Marketplace → Neon → Connect to Project (auto-provisioning `DATABASE_URL` у Production + Preview + Development).
4. `vercel env pull .env.local` локально.
5. `npm run migrate` (один раз).
6. Будь-який `git push origin main` → auto-deploy.

CORS: `origin: '*'` — публічний API без секретів, кожен студент ходить зі свого `localhost:5173`.

## 10. Out of scope (явні non-goals)

- Жодних тестів.
- Жодного rate-limiting / abuse protection.
- Жодного TTL / cron на abandoned games.
- Жодного reset-балансу.
- Жодного логіну / реєстрації — `X-Player-Id` достатньо.
- Жодного WebSocket / realtime.
- Жодної admin panel / dashboard.
- Жодної інтернаціоналізації error messages.

## 11. Open questions

Немає. Всі рішення прийнято на етапі brainstorming.
