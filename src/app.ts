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
