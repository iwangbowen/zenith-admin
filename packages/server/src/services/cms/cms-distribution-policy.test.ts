import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assertCmsDistributionScope,
  cmsDistributionIdempotencyKey,
  decideCmsDistributionConflict,
} from './cms-distribution-policy';

describe('CMS governed distribution policy', () => {
  const valid = {
    sourceSiteId: 1,
    sourceChannelId: 10,
    targetSiteId: 2,
    targetChannelId: 20,
    mode: 'mapping' as const,
    scheduleCron: null,
    filters: {
      statuses: ['published'] as ['published'],
      contentTypes: [],
      keyword: null,
      publishedFrom: null,
      publishedTo: null,
    },
  };

  it('rejects same-site rules, draft leakage and malformed scheduling', () => {
    expect(() => assertCmsDistributionScope({ ...valid, targetSiteId: 1 })).toThrow(/不能相同/);
    expect(() => assertCmsDistributionScope({
      ...valid,
      filters: { ...valid.filters, statuses: [] },
    })).toThrow(/仅允许处理已发布内容/);
    expect(() => assertCmsDistributionScope({
      ...valid,
      mode: 'scheduled',
      scheduleCron: null,
    })).toThrow(/Cron/);
  });

  it('never overwrites locked targets and applies explicit conflict strategies', () => {
    expect(decideCmsDistributionConflict({
      tracked: true,
      conflict: true,
      locked: true,
      strategy: 'overwrite',
    })).toBe('locked');
    expect(decideCmsDistributionConflict({
      tracked: false,
      conflict: true,
      locked: false,
      strategy: 'skip',
    })).toBe('skip');
    expect(decideCmsDistributionConflict({
      tracked: false,
      conflict: true,
      locked: false,
      strategy: 'create-new',
    })).toBe('create-new');
  });

  it('uses a bounded deterministic idempotency key per revision, trigger and watermark', () => {
    const first = cmsDistributionIdempotencyKey({
      ruleId: 7,
      revision: 3,
      trigger: 'manual',
      watermark: '10-99-4',
    });
    expect(first).toBe(cmsDistributionIdempotencyKey({
      ruleId: 7,
      revision: 3,
      trigger: 'manual',
      watermark: '10-99-4',
    }));
    expect(first).not.toBe(cmsDistributionIdempotencyKey({
      ruleId: 7,
      revision: 4,
      trigger: 'manual',
      watermark: '10-99-4',
    }));
    expect(first.length).toBeLessThanOrEqual(128);
  });

  it('wires ACL, sanitizer, locks, revision fence, task items and publish outbox semantics', async () => {
    const source = await readFile(new URL('./cms-distributions.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('assertSiteAccess(rule.sourceSiteId)');
    expect(source).toContain('assertSiteAccess(rule.targetSiteId)');
    expect(source).toContain('assertChannelAccess(rule.targetChannelId)');
    expect(source).toContain("eq(cmsContents.status, 'published')");
    expect(source).toContain('sanitizeCmsHtml(resolved.body)');
    expect(source).toContain('assertCmsContentUnlocked(target)');
    expect(source).toContain('updateCmsContent(target.id, patch');
    expect(source).toContain('TaskCancelledError');
    expect(source).toContain('ctx.reportItems');
    expect(source).toContain('distributionSourceVersion');
    expect(source).toContain('cmsDistributionIdempotencyKey');
    expect(source).toContain('detachStaleMapping');
    expect(source).toContain('offlineCmsContent(target.id)');
    expect(source).toContain('不能删除规则并解除映射');
  });

  it('requires complete site and channel ACL before group publishing', async () => {
    const source = await readFile(new URL('./cms-publishing.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('assertSitesAccess(targetSiteIds)');
    expect(source).toContain('assertAllCmsSiteChannelsAccess(siteId)');
    expect(source).toContain('cmsSiteFencePayload(tx, site)');
    expect(source).toContain('enqueue: false');
  });

  it('registers scheduled dispatch in the system scheduler and execution in task center', async () => {
    const [registry, tasks, exports] = await Promise.all([
      readFile(new URL('../../lib/system-tasks.registry.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-tasks.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../lib/export-center/definitions/index.ts', import.meta.url), 'utf8'),
    ]);
    expect(registry).toContain("name: 'cms-distribution-schedule'");
    expect(registry).toContain('dispatchDueCmsDistributionRules');
    expect(tasks).toContain('registerCmsDistributionTaskHandler');
    expect(exports).toContain('cmsDistributionRunsExportDefinition');
  });
});
