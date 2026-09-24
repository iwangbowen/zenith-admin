import { buildCmsSiteBlueprint, CMS_SITE_BLUEPRINTS, cmsSiteContract, cmsSiteSchema, cmsChannelSchema, cmsModelSchema, cmsModelFieldViewSchema, cmsPageSchema, cmsWidgetSchema, cmsWidgetRefSchema, cmsFormSchema, cmsResourceFolderSchema, remapCmsSiteComposition, createCmsFormSchema } from '@zenith/shared/cms';
import { mock } from '../utils/contract';
import { mockDateTime } from '../utils/date';
import * as data from '../data/cms';
import { nextIdFrom } from '../utils/handlers';
import { publishMockCmsModelVersion } from './cms-editorial';
import { stageMockCmsConfigurationDraft } from './cms-releases';

export const cmsBlueprintHandlers = [
  mock(cmsSiteContract.blueprints, ({ ok }) => ok(CMS_SITE_BLUEPRINTS.map((item) => ({ ...item })))),
  mock(cmsSiteContract.fromBlueprint, ({ body, ok }) => {
    const pkg = buildCmsSiteBlueprint(body); const siteId = data.getNextCmsSiteId();
    let code = body.code; let suffix = 1;
    while (data.mockCmsSites.some((site) => site.code === code)) code = `${body.code}-${++suffix}`;
    const times = { createdAt: mockDateTime(), updatedAt: mockDateTime() };
    const modelMap = new Map<number, number>(); const channelMap = new Map<number, number>(); const widgetMap = new Map<number, number>();
    for (const model of pkg.models) {
      const id = data.getNextCmsModelId(); modelMap.set(model.id, id);
      const fields = pkg.modelFields.filter((field) => field.modelId === model.id).map((field, index) => cmsModelFieldViewSchema.parse({ searchable: false, showInList: false, detailGroup: null, detailSort: index, placeholder: null, defaultValue: null, dictCode: null, sort: index, ...times, ...field, id: data.getNextCmsModelFieldId(), modelId: id }));
      data.mockCmsModels.push(cmsModelSchema.parse({ ...model, id, code: `${model.code}-${siteId}`, ownerSiteId: siteId, ownerSiteName: body.name, description: null, isSystem: false, status: 'enabled', sort: 0, fields, ...times }));
      publishMockCmsModelVersion(id);
    }
    for (const channel of pkg.channels) {
      const id = data.getNextCmsChannelId(); channelMap.set(channel.id, id);
      data.mockCmsChannels.push(cmsChannelSchema.parse({ ...structuredClone(data.mockCmsChannels[0]), ...channel, id, siteId, modelId: channel.modelId ? modelMap.get(channel.modelId) : null, parentId: 0, contentCount: 0, pageContent: null, settings: 'settings' in channel ? channel.settings : {}, ...times }));
    }
    const settings = remapCmsSiteComposition(pkg.site.settings, channelMap, modelMap);
    data.mockCmsSites.push(cmsSiteSchema.parse({ ...structuredClone(data.mockCmsSites[0]), ...pkg.site, id: siteId, code, parentId: null, isDefault: false, domain: null, aliasDomains: [], logo: null, favicon: null, description: null, keywords: null, settings, ...times }));
    for (const widget of pkg.widgets) {
      const id = data.getNextCmsWidgetId(); widgetMap.set(widget.id, id);
      const draftData = { items: widget.draftData.items.map((item) => ({ ...item, sourceId: channelMap.get(item.sourceId)! })) };
      data.mockCmsWidgets.push(cmsWidgetSchema.parse({ ...widget, id, siteId, type: 'manual-list', schemaVersion: 1, draftData, publishedData: draftData, publishedName: widget.name, draftRevision: 1, publishedRevision: 1, status: 'published', remark: null, referenceCount: 2, impactCount: 1, highFanout: false, hasUnpublishedChanges: false, createdBy: 1, updatedBy: 1, ...times }));
    }
    for (const slot of pkg.widgetSlots) data.mockCmsWidgetRefs.push(cmsWidgetRefSchema.parse({ ...slot, id: data.getNextCmsWidgetRefId(), siteId, widgetId: widgetMap.get(slot.widgetId), ownerType: 'theme_slot', ownerId: siteId, ownerName: body.name, styleProps: {}, ...times }));
    for (const page of pkg.pages) data.mockCmsPages.push(cmsPageSchema.parse({ ...page, id: data.getNextCmsPageId(), siteId, requiresDynamic: false, seoTitle: null, seoKeywords: null, seoDescription: null, remark: null, ...times,
      blocks: page.blocks.map((block) => ({ ...block, props: block.type === 'content-list' ? { ...block.props, channelId: channelMap.get(Number('channelId' in block.props ? block.props.channelId : 0)) } : block.props, canManage: true })) }));
    for (const form of pkg.forms) data.mockCmsForms.push({ ...cmsFormSchema.parse({ ...createCmsFormSchema.parse({ ...form, siteId }), id: data.getNextCmsFormId(), notifyEmail: null, turnstileSiteKey: null, turnstileSecret: null, ...times }), submissionCount: 0 });
    for (const folder of pkg.resourceFolders) data.mockCmsResourceFolders.push(cmsResourceFolderSchema.parse({ ...folder, id: nextIdFrom(data.mockCmsResourceFolders), siteId, sort: 0, resourceCount: 0, ...times }));
    stageMockCmsConfigurationDraft(siteId);
    return ok({ siteId, siteName: body.name, siteCode: code, counts: { channels: pkg.channels.length, tags: 0, contents: 0, friendLinks: 0, redirects: 0, linkWords: 0, adSlots: 0, ads: 0, forms: pkg.forms.length, interactions: 0, interactionQuestions: 0, resourceFolders: pkg.resourceFolders.length, resources: 0, models: pkg.models.length, modelFields: pkg.modelFields.length, friendLinkGroups: 0, widgets: pkg.widgets.length, pages: pkg.pages.length }, skipped: { widgetSlots: 0 }, warnings: [] });
  }),
];
