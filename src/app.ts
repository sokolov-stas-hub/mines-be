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
