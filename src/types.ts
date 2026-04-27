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
