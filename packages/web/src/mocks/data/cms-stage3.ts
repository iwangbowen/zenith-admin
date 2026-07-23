import {
  SEED_CMS_PUBLISH_ARTIFACTS,
  SEED_CMS_PUBLISH_TASKS,
  SEED_CMS_TEMPLATES,
  SEED_CMS_TEMPLATE_VERSIONS,
  SEED_CMS_THEME_PACKAGES,
  type CmsPublishingTask,
  type CmsPublishArtifact,
  type CmsPublishTargetType,
  type CmsTemplate,
  type CmsTemplateVersion,
  type CmsThemePackage,
} from '@zenith/shared';

export const mockCmsTemplates: CmsTemplate[] = SEED_CMS_TEMPLATES.map((item) => ({ ...item }));
export const mockCmsTemplateVersions: CmsTemplateVersion[] = SEED_CMS_TEMPLATE_VERSIONS.map((item) => ({
  ...item,
  dsl: structuredClone(item.dsl),
}));
export const mockCmsThemePackages: CmsThemePackage[] = SEED_CMS_THEME_PACKAGES.map((item) => ({
  ...item,
  status: 'validated',
  validationReport: {
    ...item.validationReport,
    valid: true,
    manifest: structuredClone(item.manifest),
    issues: [],
  },
  manifest: structuredClone(item.manifest),
  activeSiteIds: [],
  exportAvailable: false,
}));
export const mockCmsPublishingTasks: CmsPublishingTask[] = SEED_CMS_PUBLISH_TASKS.map((item) => ({
  ...item,
  module: 'CMS内容管理',
  errorMessage: null,
  cancelRequested: false,
  nextRunAt: null,
  createdBy: 1,
  createdByName: '管理员',
  tenantId: null,
  siteId: Number(item.payload.siteId),
  siteName: 'Zenith 官方网站',
  siteIds: [Number(item.payload.siteId)],
  siteNames: ['Zenith 官方网站'],
  targetType: item.payload.targetType as CmsPublishTargetType,
  artifactCount: SEED_CMS_PUBLISH_ARTIFACTS.filter((artifact) => artifact.taskId === item.id).length,
  failedArtifactCount: 0,
}));
export const mockCmsPublishArtifacts: CmsPublishArtifact[] = SEED_CMS_PUBLISH_ARTIFACTS.map((item) => ({
  ...item,
  contentId: null,
  channelId: null,
  pageId: null,
  themeCode: 'default',
  themePackageId: null,
  templateId: null,
  templateVersion: null,
  error: null,
}));

let nextTemplateId = Math.max(...mockCmsTemplates.map((item) => item.id), 0) + 1;
let nextTemplateVersionId = Math.max(...mockCmsTemplateVersions.map((item) => item.id), 0) + 1;
let nextThemePackageId = Math.max(...mockCmsThemePackages.map((item) => item.id), 0) + 1;
let nextArtifactId = Math.max(...mockCmsPublishArtifacts.map((item) => item.id), 0) + 1;

export const getNextCmsTemplateId = () => nextTemplateId++;
export const getNextCmsTemplateVersionId = () => nextTemplateVersionId++;
export const getNextCmsThemePackageId = () => nextThemePackageId++;
export const getNextCmsPublishArtifactId = () => nextArtifactId++;
