import { z } from 'zod';

export const createGameSchema = z.object({
  betAmount: z.number().positive().max(10_000),
  minesCount: z.union([
    z.literal(1),
    z.literal(3),
    z.literal(5),
    z.literal(10),
    z.literal(24),
  ]),
});

export const revealSchema = z.object({
  row: z.number().int().min(0).max(4),
  col: z.number().int().min(0).max(4),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;
export type RevealInput = z.infer<typeof revealSchema>;
