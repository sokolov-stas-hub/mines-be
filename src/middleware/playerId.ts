import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db.js';
import { AppError } from './errors.js';

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
