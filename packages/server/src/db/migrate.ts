import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import logger from '../lib/logger';

async function main() {
  const client = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(client);
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('Migrations complete.');
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Migration failed:', err);
  process.exit(1);
});
