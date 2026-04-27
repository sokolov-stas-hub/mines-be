import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Run `vercel env pull .env.local` first.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const dir = join(process.cwd(), 'migrations');
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8');
  console.log(`Running ${file}...`);
  await pool.query(sql);
}

console.log('Migrations done.');
await pool.end();
