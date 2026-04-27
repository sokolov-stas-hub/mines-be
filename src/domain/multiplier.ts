const HOUSE_EDGE = 0.01;
const TOTAL_CELLS = 25;

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

export function multiplier(minesCount: number, gemsFound: number): number {
  if (gemsFound === 0) return 1.0;
  const safe = TOTAL_CELLS - minesCount;
  const raw = combinations(TOTAL_CELLS, gemsFound) / combinations(safe, gemsFound);
  const withEdge = (1 - HOUSE_EDGE) * raw;
  return Math.round(withEdge * 100) / 100;
}

export function nextMultiplier(
  minesCount: number,
  gemsFound: number,
): number | null {
  const safeRemaining = TOTAL_CELLS - minesCount - gemsFound;
  if (safeRemaining <= 0) return null;
  return multiplier(minesCount, gemsFound + 1);
}
