import { eq } from 'drizzle-orm';
import { inAppTemplateContract, inAppTemplateSchema } from '@zenith/shared/messaging';
import { inAppTemplates } from '../../db/schema';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';
import { keywordCondition } from '../../lib/where-helpers';

export const mapInAppTemplate = entityMapper(inAppTemplateSchema);

export const inAppTemplateService = defineCrudService(inAppTemplateContract, {
  table: inAppTemplates,
  map: mapInAppTemplate,
  notFound: '站内信模板不存在',
  unique: '站内信模板编码已存在',
  tenant: true,
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [inAppTemplates.name, inAppTemplates.code], 'ilike'),
      q.type ? eq(inAppTemplates.type, q.type) : undefined,
      q.status ? eq(inAppTemplates.status, q.status) : undefined,
    ],
    orderBy: [inAppTemplates.id],
  }),
});

export const {
  list: listInAppTemplates,
  get: getInAppTemplate,
  create: createInAppTemplate,
  update: updateInAppTemplate,
  remove: deleteInAppTemplate,
} = inAppTemplateService;

export const getInAppTemplateBeforeAudit = inAppTemplateService.get;
