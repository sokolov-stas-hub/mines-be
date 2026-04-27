CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS players (
    id           TEXT PRIMARY KEY,
    balance      NUMERIC(12, 2) NOT NULL DEFAULT 10000.00,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    CREATE TYPE game_status AS ENUM ('active', 'won', 'lost');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS games (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id             TEXT NOT NULL REFERENCES players(id),
    bet_amount            NUMERIC(12, 2) NOT NULL,
    mines_count           SMALLINT NOT NULL,
    status                game_status NOT NULL DEFAULT 'active',
    mine_positions        JSONB NOT NULL,
    revealed_cells        JSONB NOT NULL DEFAULT '[]'::jsonb,
    gems_found            SMALLINT NOT NULL DEFAULT 0,
    cashed_out_multiplier NUMERIC(10, 4),
    win_amount            NUMERIC(12, 2),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_game_per_player
    ON games (player_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS games_player_created_idx
    ON games (player_id, created_at DESC);
