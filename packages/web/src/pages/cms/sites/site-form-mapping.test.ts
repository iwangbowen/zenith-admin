import { describe, expect, it } from 'vitest';
import { CMS_SITE_OPS_DEFAULTS } from '@zenith/shared/cms';
import type { CmsSite } from '@zenith/shared/cms';
import {
  EMPTY_TEMPLATE_DEFAULTS,
  buildSiteFormInitValues,
  buildSiteSavePayload,
  cleanThemeConfig,
  langLinksToText,
  parseLangLinks,
  resolveSiteOpsFormValues,
  templateDefaultsFromSettings,
  templateDefaultsToSettings,
} from './site-form-mapping';
import { collectFlatSiteDescendantIds, siteIndentOptions } from './site-tree-utils';

function makeSite(overrides: Partial<CmsSite> = {}): CmsSite {
  return {
    id: 1,
    name: '主站',
    code: 'main',
    domain: 'www.example.com',
    aliasDomains: ['example.com'],
    isDefault: true,
    theme: 'default',
    staticMode: 'hybrid',
    status: 'enabled',
    title: 'SEO 标题',
    keywords: 'a,b',
    description: '描述',
    icp: '京ICP备1号',
    copyright: '© example',
    robots: '',
    remark: '',
    settings: {},
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  } as CmsSite;
}

describe('langLinks 序列化', () => {
  it('round-trips text ⇄ settings.langLinks', () => {
    const text = 'en-US=en-site\nja-JP=jp-site';
    const parsed = parseLangLinks(text);
    expect(parsed).toEqual([
      { language: 'en-US', siteCode: 'en-site' },
      { language: 'ja-JP', siteCode: 'jp-site' },
    ]);
    expect(langLinksToText(parsed)).toBe(text);
  });

  it('ignores malformed lines and non-arrays', () => {
    expect(parseLangLinks('no-equals\n=missing-lang\nzh-CN=  ')).toEqual([]);
    expect(langLinksToText('not-an-array')).toBe('');
  });
});

describe('templateDefaults 序列化', () => {
  it('round-trips and drops empty values', () => {
    const state = { list: 'list-a', detail: null, detailByModel: { article: 'detail-x', product: null } };
    const settings = templateDefaultsToSettings(state);
    expect(settings).toEqual({ list: 'list-a', detailByModel: { article: 'detail-x' } });
    expect(templateDefaultsFromSettings({ defaultTemplates: settings })).toEqual({
      list: 'list-a',
      detail: null,
      detailByModel: { article: 'detail-x' },
    });
  });

  it('serializes the empty state to an empty object', () => {
    expect(templateDefaultsToSettings(EMPTY_TEMPLATE_DEFAULTS)).toEqual({});
  });
});

describe('resolveSiteOpsFormValues', () => {
  it('falls back to CMS_SITE_OPS_DEFAULTS for missing keys', () => {
    expect(resolveSiteOpsFormValues(null)).toEqual({
      publishedContentEditable: CMS_SITE_OPS_DEFAULTS.publishedContentEditable,
      recycleKeepDays: CMS_SITE_OPS_DEFAULTS.recycleKeepDays,
      maxPageOnContentPublish: CMS_SITE_OPS_DEFAULTS.maxPageOnContentPublish,
      autoReplaceSensitiveWords: CMS_SITE_OPS_DEFAULTS.autoReplaceSensitiveWords,
      autoReplaceErrorProneWords: CMS_SITE_OPS_DEFAULTS.autoReplaceErrorProneWords,
      autoCoverFromBody: CMS_SITE_OPS_DEFAULTS.autoCoverFromBody,
      openApiPublishEnabled: CMS_SITE_OPS_DEFAULTS.openApiPublishEnabled,
    });
  });

  it('respects explicit values and coerces numerics', () => {
    const out = resolveSiteOpsFormValues({ publishedContentEditable: false, recycleKeepDays: '45' });
    expect(out.publishedContentEditable).toBe(false);
    expect(out.recycleKeepDays).toBe(45);
  });
});

describe('cleanThemeConfig', () => {
  it('drops empty string/null/undefined but keeps false and 0', () => {
    expect(cleanThemeConfig({ a: '', b: null, c: undefined, d: false, e: 0, f: 'x' }))
      .toEqual({ d: false, e: 0, f: 'x' });
  });
});

describe('buildSiteSavePayload', () => {
  const baseFormValues = () => ({
    name: '主站',
    code: 'main',
    domain: '',
    status: 'enabled',
    theme: 'modern',
    baiduPushToken: 'token-1',
    clearBaiduPushToken: false,
    indexNowKey: '',
    clearIndexNowKey: false,
    webhookSecret: 'secret-1',
    clearWebhookSecret: false,
    cdnPurgeToken: '',
    clearCdnPurgeToken: false,
    langLinksText: 'en-US=en-site',
    publishedContentEditable: true,
  });

  it('新建：theme 写入 payload，settings 键齐全', () => {
    const { payload, themeConfigChanged } = buildSiteSavePayload({
      values: baseFormValues(),
      editingRecord: null,
      templateDefaults: { list: 'list-a', detail: null, detailByModel: {} },
      themeConfig: { primary: '#123456', empty: '' },
    });
    expect(payload.theme).toBe('modern');
    expect(payload.domain).toBeNull();
    const settings = payload.settings as Record<string, unknown>;
    expect(settings.baiduPushToken).toBe('token-1');
    expect(settings.langLinks).toEqual([{ language: 'en-US', siteCode: 'en-site' }]);
    expect(settings.defaultTemplates).toEqual({ list: 'list-a' });
    expect(settings.themeConfig).toEqual({ primary: '#123456' });
    // 表单平铺字段不应泄漏到 payload 顶层
    expect(payload).not.toHaveProperty('baiduPushToken');
    expect(payload).not.toHaveProperty('langLinksText');
    expect(themeConfigChanged).toBe(false);
  });

  it('编辑：theme 写入 payload 并报告 themeChanged；保留既有 settings 键并剔除 legacy h5 键', () => {
    const record = makeSite({
      settings: { h5Enabled: true, h5Domain: 'm.example.com', analyticsSiteKey: 'ak-1', themeConfig: { primary: '#111' } },
    });
    const { payload, themeConfigChanged, themeChanged } = buildSiteSavePayload({
      values: baseFormValues(),
      editingRecord: record,
      templateDefaults: EMPTY_TEMPLATE_DEFAULTS,
      themeConfig: { primary: '#222' },
    });
    expect(payload.theme).toBe('modern');
    expect(themeChanged).toBe(true); // record 默认 theme=default，表单切到 modern
    const settings = payload.settings as Record<string, unknown>;
    expect(settings.analyticsSiteKey).toBe('ak-1'); // 未被表单管理的键原样保留
    expect(settings).not.toHaveProperty('h5Enabled');
    expect(settings).not.toHaveProperty('h5Domain');
    expect(themeConfigChanged).toBe(true);
  });

  it('编辑：theme 未变时 themeChanged 为 false；表单缺失 theme 回退原值', () => {
    const record = makeSite({ theme: 'modern' });
    const { payload, themeChanged } = buildSiteSavePayload({
      values: baseFormValues(),
      editingRecord: record,
      templateDefaults: EMPTY_TEMPLATE_DEFAULTS,
      themeConfig: {},
    });
    expect(payload.theme).toBe('modern');
    expect(themeChanged).toBe(false);
    const { payload: p2, themeChanged: c2 } = buildSiteSavePayload({
      values: { ...baseFormValues(), theme: undefined },
      editingRecord: record,
      templateDefaults: EMPTY_TEMPLATE_DEFAULTS,
      themeConfig: {},
    });
    expect(p2.theme).toBe('modern');
    expect(c2).toBe(false);
  });

  it('clear 勾选把凭证写为 null；未勾选写 trim 后的值', () => {
    const { payload } = buildSiteSavePayload({
      values: { ...baseFormValues(), clearWebhookSecret: true, cdnPurgeToken: '  padded  ' },
      editingRecord: null,
      templateDefaults: EMPTY_TEMPLATE_DEFAULTS,
      themeConfig: {},
    });
    const settings = payload.settings as Record<string, unknown>;
    expect(settings.webhookSecret).toBeNull();
    expect(settings.cdnPurgeToken).toBe('padded');
  });

  it('themeConfig 语义相等（键序/空值差异）不触发变更提示', () => {
    const record = makeSite({ settings: { themeConfig: { a: '1', b: '2' } } });
    const { themeConfigChanged } = buildSiteSavePayload({
      values: baseFormValues(),
      editingRecord: record,
      templateDefaults: EMPTY_TEMPLATE_DEFAULTS,
      themeConfig: { a: '1', b: '2', c: '' },
    });
    expect(themeConfigChanged).toBe(false);
  });
});

describe('buildSiteFormInitValues', () => {
  it('平铺 settings 到表单字段并保留 clear* 初始 false', () => {
    const record = makeSite({
      settings: {
        baiduPushToken: '********',
        twitterCard: 'summary',
        watermarkEnabled: true,
        recycleKeepDays: 90,
        langLinks: [{ language: 'en-US', siteCode: 'en-site' }],
      },
    });
    const init = buildSiteFormInitValues(record);
    expect(init.baiduPushToken).toBe('********');
    expect(init.clearBaiduPushToken).toBe(false);
    expect(init.twitterCard).toBe('summary');
    expect(init.watermarkEnabled).toBe(true);
    expect(init.recycleKeepDays).toBe(90);
    expect(init.langLinksText).toBe('en-US=en-site');
    expect(init.domain).toBe('www.example.com');
  });

  it('init → save 往返：默认站点不丢 settings 键', () => {
    const record = makeSite({
      settings: {
        baiduPushToken: 'tok', twitterSite: '@x', themePrimary: '#123',
        watermarkText: 'wm', language: 'zh-CN',
        langLinks: [{ language: 'en-US', siteCode: 'en' }],
      },
    });
    const init = buildSiteFormInitValues(record);
    const { payload } = buildSiteSavePayload({
      values: init,
      editingRecord: record,
      templateDefaults: templateDefaultsFromSettings(record.settings as Record<string, unknown>),
      themeConfig: {},
    });
    const settings = payload.settings as Record<string, unknown>;
    expect(settings.baiduPushToken).toBe('tok');
    expect(settings.twitterSite).toBe('@x');
    expect(settings.themePrimary).toBe('#123');
    expect(settings.watermarkText).toBe('wm');
    expect(settings.language).toBe('zh-CN');
    expect(settings.langLinks).toEqual([{ language: 'en-US', siteCode: 'en' }]);
  });
});

describe('site-tree-utils', () => {
  const flat = [
    makeSite({ id: 1, parentId: undefined, depth: 1 }),
    makeSite({ id: 2, parentId: 1, depth: 2, name: '子站A' }),
    makeSite({ id: 3, parentId: 2, depth: 3, name: '孙站' }),
    makeSite({ id: 4, parentId: undefined, depth: 1, name: '独立站' }),
  ];

  it('collectFlatSiteDescendantIds 含自身与全部后代', () => {
    expect([...collectFlatSiteDescendantIds(flat, 1)].sort()).toEqual([1, 2, 3]);
    expect([...collectFlatSiteDescendantIds(flat, 4)]).toEqual([4]);
  });

  it('siteIndentOptions 按 depth 缩进', () => {
    expect(siteIndentOptions(flat.slice(0, 3)).map((o) => o.label)).toEqual(['主站', '—子站A', '——孙站']);
  });
});


describe('站点品牌图片映射', () => {
  it('restores logo and favicon and explicitly clears either image without discarding other settings', () => {
    const record = makeSite({ logo: 'cms-res://11', favicon: 'cms-res://12', settings: { retained: true } });
    const values = buildSiteFormInitValues(record);
    expect(values).toMatchObject({ logo: 'cms-res://11', favicon: 'cms-res://12' });
    const result = buildSiteSavePayload({ values: { ...values, logo: '', favicon: 'cms-res://13' }, editingRecord: record, templateDefaults: EMPTY_TEMPLATE_DEFAULTS, themeConfig: {} });
    expect(result.payload).toMatchObject({ logo: null, favicon: 'cms-res://13', settings: { retained: true } });
  });
  it('does not clear brand images when a partial form payload omits them', () => {
    const result = buildSiteSavePayload({ values: { name: '新名称' }, editingRecord: makeSite({ logo: '/logo.png', favicon: '/favicon.ico' }), templateDefaults: EMPTY_TEMPLATE_DEFAULTS, themeConfig: {} });
    expect(result.payload).not.toHaveProperty('logo');
    expect(result.payload).not.toHaveProperty('favicon');
  });
});
