import { db } from './index';
import { users } from './schema';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('Seeding database...');

  const existing = await db.select().from(users).where(eq(users.username, 'admin'));
  if (existing.length === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await db.insert(users).values({
      username: 'admin',
      nickname: '管理员',
      email: 'admin@zenith.dev',
      password: hashedPassword,
      role: 'admin',
      status: 'active',
    });
    console.log('Admin user created: admin / admin123');
  } else {
    console.log('Admin user already exists, skipping.');
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
