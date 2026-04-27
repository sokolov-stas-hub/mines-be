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

// GET /api/games/active — current active game for player (extension beyond doc)
// MUST be registered before GET /api/games/:gameId
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
