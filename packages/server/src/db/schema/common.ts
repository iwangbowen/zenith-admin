import { pgEnum } from 'drizzle-orm/pg-core';

export const statusEnum = pgEnum('status', ['enabled', 'disabled']);
