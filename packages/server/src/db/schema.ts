import { pgTable, serial, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'user']);
export const statusEnum = pgEnum('status', ['active', 'disabled']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  nickname: varchar('nickname', { length: 32 }).notNull(),
  email: varchar('email', { length: 128 }).notNull().unique(),
  password: varchar('password', { length: 128 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  role: roleEnum('role').notNull().default('user'),
  status: statusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
