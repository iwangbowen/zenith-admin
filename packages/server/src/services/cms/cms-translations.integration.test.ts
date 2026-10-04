import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { afterAll, describe, expect, it } from 'vitest';
import { cmsModelFieldViewSchema } from '@zenith/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { runWithCurrentUser } from '../../lib/context';
import { createCmsContent, updateCmsContent } from './cms-contents-write.service';
import { createCmsTranslation, listCmsTranslations } from './cms-editorial.service';
import { freezeCmsContentRevision, loadCmsRevision, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { cmsSnapshotHash } from './cms-design-versions.service';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? createPgClient(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });

describe.skipIf(!connection)('CMS translation frozen source PostgreSQL lifecycle', () => {
  it('copies autosaved text from one frozen revision, preserves its model and ignores preview/operational changes', async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' });
    const rollback = new Error('rollback translation fixtures');
    try {
      await testDb.transaction(async (tx) => withDbExecutor(tx, async () => {
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx.insert(schema.users).values({ username: `qa-translation-${suffix}`, nickname: 'Translation QA', password: 'unused', userDataScope: 'all' }).returning();
        await runWithCurrentUser({ userId: user.id, username: user.username, roles: ['super_admin'], tenantId: null }, async () => {
          const [site] = await tx.insert(schema.cmsSites).values({ name: 'QA Translation', code: `qa-translation-${suffix}` }).returning();
          const [channel] = await tx.insert(schema.cmsChannels).values({ siteId: site.id, code: 'news', slug: 'news', path: 'news', name: 'News' }).returning();
          const [model] = await tx.insert(schema.cmsModels).values({ ownerSiteId: site.id, code: `qa-translation-${suffix}`, name: 'Translation model' }).returning();
          const field = cmsModelFieldViewSchema.parse({ id: 1, modelId: model.id, name: 'guide', label: '参观说明', fieldType: 'text', required: false,
            searchable: false, showInList: false, showInDetail: true, detailGroup: null, detailSort: 0, placeholder: null, defaultValue: null,
            optionSource: 'manual', dictCode: null, options: null, sort: 0, createdAt: '2026-09-30 10:00:00', updatedAt: '2026-09-30 10:00:00' });
          const [oldModel] = await tx.insert(schema.cmsModelVersions).values({ modelId: model.id, version: 1, fields: [field], contentHash: cmsSnapshotHash([field]) }).returning();
          await tx.update(schema.cmsModels).set({ publishedVersionId: oldModel.id }).where(eq(schema.cmsModels.id, model.id));
          const source = await createCmsContent({ siteId: site.id, channelId: channel.id, modelId: model.id, title: '中文来源', body: '<p>原文</p>', extend: { guide: '参观说明' } });
          await updateCmsContent(source.id, { expectedVersion: source.version, saveMode: 'autosave', body: '<p>尚未手动留档的最新正文</p>', summary: '自动保存摘要' });
          const sourceBefore = await requireCmsWorkingCopy(tx, source.id);

          // Model evolution must not reinterpret the source with an incompatible latest schema.
          const [newModel] = await tx.insert(schema.cmsModelVersions).values({ modelId: model.id, version: 2, fields: [], contentHash: cmsSnapshotHash([]) }).returning();
          await tx.update(schema.cmsModels).set({ publishedVersionId: newModel.id }).where(eq(schema.cmsModels.id, model.id));
          const translated = await createCmsTranslation(source.id, { locale: 'en-US', channelId: channel.id, title: 'English guide' });
          const translation = await requireCmsWorkingCopy(tx, translated.id);
          const baseline = await loadCmsRevision(tx, translation.snapshot.sourceRevisionId!);
          expect(baseline.contentId).toBe(source.id);
          expect(baseline.sourceVersion).toBe(sourceBefore.version);
          expect(baseline.snapshot.body).toBe('<p>尚未手动留档的最新正文</p>');
          expect(translation.snapshot.body).toBe(baseline.snapshot.body);
          expect(translation.snapshot.bodyDocument).toEqual(baseline.snapshot.bodyDocument);
          expect(translation.snapshot.extend).toEqual(baseline.snapshot.extend);
          expect(translation.snapshot.modelVersionId).toBe(oldModel.id);
          const changed = async () => (await listCmsTranslations(translated.id)).find((row) => row.id === translated.id)?.sourceChanged;
          expect(await changed()).toBe(false);

          const [identity] = await tx.select().from(schema.cmsContents).where(eq(schema.cmsContents.id, source.id));
          await freezeCmsContentRevision(tx, identity, await requireCmsWorkingCopy(tx, source.id), 'preview');
          await freezeCmsContentRevision(tx, identity, await requireCmsWorkingCopy(tx, source.id), 'checkpoint');
          const beforeOperations = await requireCmsWorkingCopy(tx, source.id);
          await updateCmsContent(source.id, { expectedVersion: beforeOperations.version, saveMode: 'autosave', ownerId: user.id, editor: '另一责任编辑', dueAt: '2026-10-10 10:00:00', isTop: true });
          expect(await changed()).toBe(false);
          const beforeText = await requireCmsWorkingCopy(tx, source.id);
          await updateCmsContent(source.id, { expectedVersion: beforeText.version, saveMode: 'autosave', body: '<p>新增开放时间，需要翻译</p>' });
          expect(await changed()).toBe(true);
          expect((await loadCmsRevision(tx, baseline.id)).snapshot.body).toBe('<p>尚未手动留档的最新正文</p>');
          await expect(createCmsTranslation(source.id, { locale: 'en-US', channelId: channel.id, title: 'Duplicate' })).rejects.toMatchObject({ status: 409 });
        });
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
