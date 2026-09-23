import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assertSafeCmsResourceUrl, CMS_RESOURCE_OWNER_FIELDS, isSafeCmsResourceUrl,
} from './cms-resource-refs.service';
import { cmsResourceUri, extractCmsResourceRefFields } from '../../lib/cms-resource-uri';
import { isCmsResourceOrphan } from './cms-resources.service';

describe('CMS resource governance', () => {
  it('提取嵌套 mediaData/extend 结构中的素材句柄', () => {
    const refs = extractCmsResourceRefFields({
      mediaData: { images: [{ url: cmsResourceUri(7) }] },
      extend: { gallery: [{ file: cmsResourceUri(8) }] },
      body: '<p>无素材</p>',
    });
    expect(refs).toEqual([
      { field: 'mediaData', resourceId: 7 },
      { field: 'extend', resourceId: 8 },
    ]);
  });

  it('友链 logo 与 url 都纳入素材引用字段', () => {
    expect(CMS_RESOURCE_OWNER_FIELDS.friendLink).toEqual(['logo', 'url']);
    const refs = extractCmsResourceRefFields({ logo: cmsResourceUri(3), url: 'https://partner.example' });
    expect(refs).toEqual([{ field: 'logo', resourceId: 3 }]);
  });

  it.each([
    ['content', 'sourceUrl'],
    ['content', 'externalLink'],
    ['channel', 'linkUrl'],
    ['ad', 'linkUrl'],
  ] as const)('%s 的 %s 字段纳入引用登记（下载型链接同样受删除保护）', (ownerType, field) => {
    expect(CMS_RESOURCE_OWNER_FIELDS[ownerType]).toContain(field);
    const refs = extractCmsResourceRefFields({ [field]: cmsResourceUri(1) });
    expect(refs).toEqual([{ field, resourceId: 1 }]);
    expect(isCmsResourceOrphan(refs.map((r) => ({ kind: ownerType, id: 1, title: '引用对象', field: r.field })))).toBe(false);
  });

  it('引用扫描改走反向索引，不再对业务表做 LIKE 全表扫描', async () => {
    const source = await readFile(new URL('./cms-resources.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('listCmsResourceRefDetails');
    expect(source).not.toContain('::text like');
  });

  it('孤立判定由 cms_resource_refs 的 NOT EXISTS 查询给出', async () => {
    const source = await readFile(new URL('./cms-resource-refs.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('notExists');
    expect(source).toContain('cmsResourceRefs');
  });

  it('owner 写入与引用重建在同一事务内完成（索引不会漂移）', async () => {
    const source = await readFile(new URL('./cms-contents-ops.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('writeCmsSystemWorkingCopy(tx,');
    const revisions = await readFile(new URL('./cms-content-revisions.service.ts', import.meta.url), 'utf8');
    expect(revisions).toContain("syncCmsResourceRefs(tx, 'content', identity.id, identity.siteId, normalized)");
    expect(source).toContain('deleteCmsResourceRefsForOwner(tx,');
  });

  it('治理与索引重建任务复用任务中心的断点/取消/行级明细', async () => {
    const source = await readFile(new URL('./cms-resource-tasks.ts', import.meta.url), 'utf8');
    expect(source).toContain('registerTaskHandler');
    expect(source).toContain('ctx.reportItems');
    expect(source).toContain('checkpoint:');
    expect(source).toContain('cancelRequested');
    expect(source).toContain('CMS_RESOURCE_REF_REBUILD_TASK');
  });

  /**
   * 素材地址在读取时被直接拼进**已净化**的 HTML（句柄替换发生在 sanitizeCmsHtml 之后），
   * 因此地址本身必须无法承载属性逃逸或 javascript:。站点导入包是唯一的外来写入口。
   */
  describe('素材地址安全校验', () => {
    it.each([
      '/uploads/2026/a.jpg',
      '/api/files/11111111-2222-3333-4444-555555555555/content',
      'https://cdn.example.com/a.png?v=2',
      'http://cdn.example.com/a.png',
      null,
      '',
    ])('放行合法地址 %s', (url) => {
      expect(isSafeCmsResourceUrl(url)).toBe(true);
    });

    it.each([
      ['属性逃逸', 'x" onerror="alert(document.domain)'],
      ['javascript 伪协议', 'javascript:alert(1)'],
      ['data URI', 'data:text/html;base64,PHNjcmlwdD4='],
      ['单引号逃逸', "x' onerror='alert(1)"],
      ['尖括号', '/a.jpg"><script>alert(1)</script>'],
      ['协议相对', '//evil.example/a.jpg'],
      ['含空白', '/a.jpg onerror=alert(1)'],
      ['反斜杠', '\\\\evil.example\\a.jpg'],
    ])('拦截 %s', (_label, url) => {
      expect(isSafeCmsResourceUrl(url)).toBe(false);
      expect(() => assertSafeCmsResourceUrl(url)).toThrow();
    });

    it('站点导入对包内素材地址执行校验', async () => {
      const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
      expect(source).toContain('assertSafeCmsResourceUrl(str(res.url)');
      expect(source).toContain('assertSafeCmsResourceUrl(str(res.thumbUrl)');
    });
  });

  it('跨站分发把素材登记到目标站再改写句柄，避免来源站删除后断图', async () => {
    const source = await readFile(new URL('./cms-distributions-sync.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('adoptCmsResourcesIntoSite');
    const batch = await readFile(new URL('./cms-contents-ops.service.ts', import.meta.url), 'utf8');
    expect(batch).toContain('adoptCmsResourcesIntoSite');
  });

  /**
   * 归一化对「已是句柄」的值是 no-op，所以跨站复制必须显式登记 + 改写，
   * 且要覆盖内容的全部六个素材字段 —— 只处理 body/extend 会让每次同步把封面与图集
   * 回退成来源站句柄，来源站删除时目标站封面集体变空。
   */
  it('跨站复制覆盖内容的全部素材字段（不只是正文与扩展字段）', async () => {
    const dist = await readFile(new URL('./cms-distributions-sync.service.ts', import.meta.url), 'utf8');
    // 增量同步：整个 patch（含 coverImage/mediaData/externalLink/sourceUrl）先跨站登记
    expect(dist).toContain('adoptCmsResourcesIntoSite(tx, rule.targetSiteId, { ...updatePatch(source, body), attachments: source.attachments })');
    // 首次物化：六个字段都取自登记结果
    for (const field of ['coverImage: media.coverImage', 'mediaData: media.mediaData', 'body: media.body', 'extend: media.extend', 'externalLink: media.externalLink', 'sourceUrl: media.sourceUrl']) {
      expect(dist).toContain(field);
    }
    const contents = await readFile(new URL('./cms-contents-ops.service.ts', import.meta.url), 'utf8');
    expect(contents).toContain('adoptCmsResourcesIntoSite(db, targetSiteId, snapshot)');
    expect(contents).toContain('createCmsContent({ ...snapshot, ...adopted,');
  });

  it('跨站登记走 insert-on-conflict + 补查，避免并发撞唯一索引', async () => {
    const source = await readFile(new URL('./cms-resource-refs.service.ts', import.meta.url), 'utf8');
    const adopt = source.slice(source.indexOf('export async function adoptCmsResourcesIntoSite'));
    expect(adopt).toContain('onConflictDoNothing()');
    expect(adopt).toContain('missing');
  });

  it('引用登记型素材不持有物理文件，删除时不联动删除', async () => {
    const source = await readFile(new URL('./cms-resources.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (!row.ownsFile) return;');
    // 替换后新文件由本次上传产生，所有权要回到本素材，否则文件永远无法回收
    expect(source).toMatch(/fileId: uploaded\.fileId,[\s\S]{0,200}ownsFile: true,/);
    const refs = await readFile(new URL('./cms-resource-refs.service.ts', import.meta.url), 'utf8');
    expect(refs).toContain('ownsFile: false');
  });

  it('所有资源引用读取与写入都带站点边界', async () => {
    const refs = await readFile(new URL('./cms-resource-refs.service.ts', import.meta.url), 'utf8');
    expect(refs).toContain('eq(cmsResourceRefs.siteId, siteId)');
    expect(refs).toContain('eq(cmsResources.siteId, siteId)');
    expect(refs).toContain('素材句柄不属于当前站点');
    expect(refs).toContain('resourceCacheKey(siteId, id)');
  });
});
