import { randomInt } from 'node:crypto';

export type Coord = [row: number, col: number];
export type CellType = 'gem' | 'mine';

export const TOTAL_CELLS = 25;
export const GRID_SIZE = 5;

export function placeMines(minesCount: number): Coord[] {
  const indices = Array.from({ length: TOTAL_CELLS }, (_, i) => i);
  for (let i = TOTAL_CELLS - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, minesCount).map(idx => [
    Math.floor(idx / GRID_SIZE),
    idx % GRID_SIZE,
  ]);
}

export function isMine(positions: Coord[], row: number, col: number): boolean {
  return positions.some(([r, c]) => r === row && c === col);
}

export function isCellRevealed(
  revealed: Array<{ row: number; col: number }>,
  row: number,
  col: number,
): boolean {
  return revealed.some(cell => cell.row === row && cell.col === col);
}

export function toFullBoard(positions: Coord[]): CellType[][] {
  const board: CellType[][] = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 'gem' as CellType),
  );
  for (const [r, c] of positions) board[r][c] = 'mine';
  return board;
}
