# Swagger Documentation — Design Spec

**Дата:** 2026-04-27
**Автор:** Stas
**Статус:** Approved (brainstorming)

## 1. Контекст і мета

Студенти, що споживають Mines API, отримують HTML-документацію від менторів. Для зручності — інтерактивна Swagger UI, яку можна відкрити в браузері, прочитати схеми, спробувати запити «Try it out». Spec у форматі OpenAPI 3.0 також придатний для імпорту в Postman/Insomnia/інші інструменти.

## 2. Архітектурні рішення (підсумок)

| Рішення | Значення | Обґрунтування |
|---|---|---|
| Джерело істини | Рукописний `openapi.yaml` | 7 endpoint-ів, ~150 рядків — простіше за zod-to-openapi пайплайн; нуль ризику зламати робочий код |
| UI бібліотека | `swagger-ui-express` | Стандарт індустрії, нативно працює на Vercel serverless |
| YAML парсер | `yaml` (npm) | Невелика залежність для парсингу при старті процесу |
| Шляхи | `/api/docs` (UI), `/api/openapi.yaml` (raw spec) | Під існуючим `/api/(.*)` rewrite у `vercel.json` — без додаткових змін |
| Auth | UI та raw YAML — без `X-Player-Id` | Документація має бути доступна без онбординг-фрикшенів |
| Sync zod ↔ YAML | Ручний | YAML живе поруч із кодом, при змінах API — оновлюємо обидва |

## 3. Файлові зміни

```
mines-backend/
├── openapi.yaml             # NEW — OpenAPI 3.0 spec (~150 рядків)
├── src/
│   ├── routes/
│   │   └── docs.ts          # NEW — Swagger UI router + raw YAML endpoint
│   └── app.ts               # реєструємо docsRouter ПЕРЕД playerIdMiddleware
└── package.json             # нові deps
```

## 4. Залежності

| Runtime | Dev |
|---|---|
| `swagger-ui-express` | `@types/swagger-ui-express` |
| `yaml` | — |

## 5. Routing у `src/app.ts`

Порядок реєстрації критичний — публічні endpoint-и реєструються до `playerIdMiddleware`:

```
1. cors, express.json
2. /api/health         (без auth — вже є)
3. /api/docs           (NEW, без auth — Swagger UI)
4. /api/openapi.yaml   (NEW, без auth — raw YAML)
5. playerIdMiddleware  (auth-gate для решти)
6. balance, history, games routers
7. errorHandler
```

## 6. `src/routes/docs.ts` — поведінка

- При старті процесу: `fs.readFileSync('openapi.yaml', 'utf8')` → парсимо в JS-об'єкт через `yaml.parse()`. Кешуємо в module-scope variable (читаємо один раз на cold start).
- `GET /api/openapi.yaml` → віддає сирий YAML з заголовком `Content-Type: text/yaml`.
- `GET /api/docs` → Swagger UI з кастомним HTML-шаблоном, що вказує на cached JS-об'єкт через `swaggerUi.setup(spec)`.
- Шлях до YAML: `path.join(process.cwd(), 'openapi.yaml')` — на Vercel `process.cwd()` = `/var/task`, де файл присутній завдяки file tracing.

## 7. Структура `openapi.yaml`

```yaml
openapi: 3.0.3
info:
  title: Mines Backend API
  version: 0.1.0
  description: Multi-tenant Mines game backend
servers:
  - url: https://mines-be.vercel.app

components:
  securitySchemes:
    PlayerId:
      type: apiKey
      in: header
      name: X-Player-Id
  schemas:
    Error: { ... }
    RevealedCell: { ... }
    FullBoard: { ... }   # CellType[][] = 5×5 матриця "gem"|"mine"
    GameStateResponse: { ... }
    # ... ще ~5 response/request DTO

security:
  - PlayerId: []   # global default; /health, /docs, /openapi.yaml — security: [] override

paths:
  /api/health:        { security: [], get: { ... } }
  /api/docs:          { security: [], get: { ... } }    # описує саму себе
  /api/openapi.yaml:  { security: [], get: { ... } }
  /api/balance:       { get: { ... } }
  /api/history:       { get: { ... } }
  /api/games:         { post: { ... } }
  /api/games/active:  { get: { ... } }
  /api/games/{gameId}: { get: { ... } }
  /api/games/{gameId}/reveal: { post: { ... } }
  /api/games/{gameId}/cashout: { post: { ... } }
```

Кожен endpoint має:
- `summary` (одне речення)
- `requestBody` зі схемою + `examples` (валідний приклад payload)
- `responses` для 200/201/400/404 з `examples`

## 8. Out of scope

- Жодної генерації OpenAPI з zod — ручний YAML.
- Жодної runtime-валідації запитів проти YAML — zod вже це робить, дублювати немає сенсу.
- Жодної кастомізації UI (логотипи, теми) — default Swagger UI достатньо.
- Жодної аутентифікації самої документації — вона публічна.
- Жодного автоматичного синку YAML ↔ zod — при змінах API оновлюємо обидва вручну.

## 9. Open questions

Немає.
