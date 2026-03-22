import { db } from './index';
import { users } from './schema';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('Seeding database...');

  const existing = await db.select().from(users).where(eq(users.username, 'admin'));
  const hashedPassword = await bcrypt.hash('123456', 10);
  if (existing.length === 0) {
    await db.insert(users).values({
      username: 'admin',
      nickname: '管理员',
      email: 'admin@zenith.dev',
      password: hashedPassword,
      role: 'admin',
      status: 'active',
    });
    console.log('Admin user created: admin / 123456');
  } else {
    // 密码变更时同步更新
    await db.update(users).set({ password: hashedPassword }).where(eq(users.username, 'admin'));
    console.log('Admin password reset to: admin / 123456');
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
