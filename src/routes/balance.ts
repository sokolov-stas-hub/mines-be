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
