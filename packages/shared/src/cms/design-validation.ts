import * as z from 'zod';
import { dateTimeStringSchema, partialForUpdate } from '../core/validation';

export const cmsAssetRightsInputSchema = z.object({
  source: z.string().max(500).nullable().optional(), license: z.string().max(500).nullable().optional(),
  expiresAt: dateTimeStringSchema.nullable().optional(), revoked: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(50)).max(50).optional(), alt: z.string().max(1000).nullable().optional(),
});
export const updateCmsAssetRightsSchema = partialForUpdate(cmsAssetRightsInputSchema);
export const createCmsEditorialNoteSchema = z.object({
  revisionId: z.int().positive().nullable().optional(),
  fieldPath: z.string().max(200).nullable().optional(),
  message: z.string().min(1).max(5000),
  mentionedUserIds: z.array(z.int().positive()).max(20).optional(),
});
export const resolveCmsEditorialNoteSchema = z.object({ resolved: z.boolean() });
export const createCmsTranslationSchema = z.object({
  locale: z.string().min(2).max(35).regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  channelId: z.int().positive(), title: z.string().min(1).max(255),
});
