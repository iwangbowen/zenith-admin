import * as z from 'zod';
import { menuSchema } from './menus';
import { permissionCatalogItemSchema } from './api-catalog';
import { accessPolicySnapshotSchema } from '../access-governance-validation';

export const accessScopeOptionsSchema = z.object({
  pages: z.array(menuSchema),
  selectablePageIds: z.array(z.int()),
  permissions: z.array(permissionCatalogItemSchema.extend({
    selectable: z.boolean(),
    policy: accessPolicySnapshotSchema.optional(),
  })),
}).meta({ id: 'IdentityAccessScopeOptions' });

export type AccessScopeOptions = z.infer<typeof accessScopeOptionsSchema>;
