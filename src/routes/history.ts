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
