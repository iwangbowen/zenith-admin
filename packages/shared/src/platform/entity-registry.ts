import * as z from 'zod';
import { entityKeySchema } from '../core/entity-ref';
import { ENTITY_TYPES, type CanonicalEntityRef } from './entity-catalog';

export * from './entity-catalog';

export const canonicalEntityTypeSchema = z.enum(ENTITY_TYPES).meta({
  id: 'CanonicalEntityType',
  description: '已注册的跨对象实体类型',
});

/** Validated API references are kept separate from metadata used by the app shell. */
export const canonicalEntityRefSchema = z.object({
  type: canonicalEntityTypeSchema,
  key: entityKeySchema,
}).meta({ id: 'CanonicalEntityRef' });

export function isCanonicalEntityRef(value: unknown): value is CanonicalEntityRef {
  return canonicalEntityRefSchema.safeParse(value).success;
}
