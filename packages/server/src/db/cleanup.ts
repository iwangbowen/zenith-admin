import postgres from 'postgres';

const sql = postgres('postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1 });

async function cleanup() {
  await sql`DROP TABLE IF EXISTS users CASCADE`;
  await sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations CASCADE`;
  await sql`DROP TYPE IF EXISTS role CASCADE`;
  await sql`DROP TYPE IF EXISTS status CASCADE`;
  await sql`DROP TYPE IF EXISTS user_role CASCADE`;
  await sql`DROP TYPE IF EXISTS user_status CASCADE`;
  await sql`DROP TYPE IF EXISTS menu_type CASCADE`;
  console.log('Done: dropped tables and types');
  await sql.end();
}

cleanup();
