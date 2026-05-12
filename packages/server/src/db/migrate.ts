import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import logger from '../lib/logger';

const client = postgres(config.databaseUrl, { max: 1 });
const db = drizzle(client);
logger.info('Running migrations...');
await migrate(db, { migrationsFolder: './drizzle' });
logger.info('Migrations complete.');
await client.end();
process.exit(0);
