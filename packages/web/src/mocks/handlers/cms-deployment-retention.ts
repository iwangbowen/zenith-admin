import { CMS_DEFAULT_DEPLOYMENT_RETENTION, cmsDeploymentRetentionContract, cmsDeploymentRetentionDecisions, cmsTaskDeploymentReferences, isCmsPendingCandidate, type CmsDeploymentCapacityRow, type CmsDeploymentRetentionPolicy } from '@zenith/shared/cms';
import { mock, MockHttpError } from '../utils/contract';
import { requireItem } from '../utils/crud';
import { conflict } from '../utils/handlers';
import { mockDateTime } from '../utils/date';
import { mockCmsSites } from '../data/cms';
import { createProgressingMockTask, getMockActiveAsyncTasks, setMockTaskItems } from './async-tasks';
import { getMockCmsDeploymentRetentionContext, purgeMockCmsDeploymentStorage } from './cms-releases';

const policies = new Map<number, CmsDeploymentRetentionPolicy>();
const storage = new Map<number, Pick<CmsDeploymentCapacityRow, 'version' | 'pinned' | 'pinReason' | 'schemaBytes' | 'fileBytes' | 'fileCount' | 'measuredAt' | 'schemaPurgedAt' | 'filesPurgedAt' | 'purgedAt' | 'cleanupTaskId' | 'error'>>();
const emptyStorage = () => ({ version: 0, pinned: false, pinReason: null, schemaBytes: null, fileBytes: null, fileCount: null, measuredAt: null, schemaPurgedAt: null, filesPurgedAt: null, purgedAt: null, cleanupTaskId: null, error: null });
function policy(siteId: number) { requireItem(mockCmsSites, siteId, '站点不存在', { status: 404 }); return policies.get(siteId) ?? { siteId, version: 0, ...CMS_DEFAULT_DEPLOYMENT_RETENTION }; }
function rows(siteId: number): CmsDeploymentCapacityRow[] {
  const rules = policy(siteId); const context = getMockCmsDeploymentRetentionContext(siteId);
  const references = new Map<number, string[]>(); const protect = (id: number | null, reason: string) => { if (id) references.set(id, [...references.get(id) ?? [], reason]); };
  protect(context.activeId, '站点当前生效版本'); context.pendingBases.forEach(release => protect(release.base, `发布单 #${release.id} 的构建基础`));
  for (const task of getMockActiveAsyncTasks()) if (!['cms-deployment-cleanup', 'cms-deployment-measure'].includes(task.taskType)) for (const id of cmsTaskDeploymentReferences(task.payload)) protect(id, `执行中的任务 #${task.id} 引用`);
  const decisions = cmsDeploymentRetentionDecisions(context.records.map(({ deployment, release }) => ({ id: deployment.id, status: deployment.status, releaseStatus: release.status, storageState: deployment.storageState, pinned: storage.get(deployment.id)?.pinned ?? false, ageFrom: deployment.activatedAt ?? deployment.createdAt, protectedBy: references.get(deployment.id) ?? [], pendingCandidate: isCmsPendingCandidate(deployment.id, release, context.activeId) })), rules);
  return context.records.map(({ deployment, release }) => ({ id: deployment.id, siteId, releaseId: release.id, releaseName: release.name, releaseStatus: release.status, status: deployment.status, storageState: deployment.storageState,
    ...storage.get(deployment.id) ?? emptyStorage(), createdAt: deployment.createdAt, activatedAt: deployment.activatedAt, protectedReasons: decisions.get(deployment.id)!, eligible: decisions.get(deployment.id)!.length === 0,
  })).sort((a, b) => b.id - a.id);
}
async function preview(siteId: number) {
  const all = rows(siteId); const rules = policy(siteId); const candidates = all.filter(row => row.eligible).slice(0, 1000);
  const source = JSON.stringify({ rules, rows: all.map(row => ({ id: row.id, version: row.version, storageState: row.storageState, reasons: row.protectedReasons })) });
  const { sha256 } = await import('hash-wasm');
  return { fingerprint: await sha256(source), candidates, totalCandidates: all.filter(row => row.eligible).length,
    bytes: candidates.reduce((sum, row) => sum + (row.schemaBytes ?? 0) + (row.fileBytes ?? 0), 0), unmeasured: candidates.filter(row => !row.measuredAt).length, protectedCount: all.filter(row => !row.eligible && row.storageState !== 'purged').length };
}
export const cmsDeploymentRetentionHandlers = [
  mock(cmsDeploymentRetentionContract.list, ({ query, paginate, ok }) => ok(paginate(rows(query.siteId)))),
  mock(cmsDeploymentRetentionContract.summary, ({ params, ok }) => {
    const all = rows(params.id);
    return ok({ retained: all.filter(row => row.storageState !== 'purged').length, purged: all.filter(row => row.storageState === 'purged').length, protected: all.filter(row => !row.eligible && row.storageState !== 'purged').length, eligible: all.filter(row => row.eligible).length,
      schemaBytes: all.reduce((sum, row) => sum + (row.schemaBytes ?? 0), 0), fileBytes: all.reduce((sum, row) => sum + (row.fileBytes ?? 0), 0), unmeasured: all.filter(row => row.storageState !== 'purged' && !row.measuredAt).length, policy: policy(params.id) });
  }),
  mock(cmsDeploymentRetentionContract.savePolicy, ({ params, body, ok }) => {
    if (policy(params.id).version !== body.expectedVersion) return conflict('保留策略已变化', { status: 409 });
    const { expectedVersion, ...rules } = body; const next = { ...rules, siteId: params.id, version: expectedVersion + 1 }; policies.set(params.id, next); return ok(next);
  }),
  mock(cmsDeploymentRetentionContract.pin, ({ params, body, ok }) => {
    const source = mockCmsSites.flatMap(site => rows(site.id)).find(row => row.id === params.id);
    if (!source || source.storageState !== 'available') return conflict('部署不存在或正在回收', { status: 409 });
    if (source.version !== body.expectedVersion) return conflict('部署保留标记已变化', { status: 409 });
    storage.set(source.id, { ...storage.get(source.id) ?? emptyStorage(), version: body.expectedVersion + 1, pinned: body.pinned, pinReason: body.pinned ? body.reason : null });
    return ok(rows(source.siteId).find(row => row.id === source.id)!);
  }),
  mock(cmsDeploymentRetentionContract.preview, async ({ params, ok }) => ok(await preview(params.id))),
  mock(cmsDeploymentRetentionContract.measure, ({ params, ok }) => {
    const all = rows(params.id);
    return ok(createProgressingMockTask({ taskType: 'cms-deployment-measure', title: 'CMS 部署容量测量', payload: { siteId: params.id }, totalItems: all.length, onSuccess: task => {
      for (const row of rows(params.id)) if (row.storageState === 'available') storage.set(row.id, { ...storage.get(row.id) ?? emptyStorage(), schemaBytes: 4096 * (row.id + 10), fileBytes: 2048 * (row.id + 10), fileCount: row.id + 10, measuredAt: mockDateTime() });
      task.result = { processed: all.length, measurement: 'Demo 模拟占用，真实占用由服务端测量' };
    } }));
  }),
  mock(cmsDeploymentRetentionContract.cleanup, async ({ params, body, ok }) => {
    const current = await preview(params.id);
    if (current.fingerprint !== body.fingerprint || body.deploymentIds.some(id => !current.candidates.some(row => row.id === id))) return conflict('保护状态已变化或包含受保护部署，请重新预览', { status: 409 });
    return ok(createProgressingMockTask({ taskType: 'cms-deployment-cleanup', title: 'CMS 历史部署存储回收', payload: { siteId: params.id, deploymentIds: body.deploymentIds }, totalItems: body.deploymentIds.length, onSuccess: task => {
      const items = body.deploymentIds.map((id, index) => {
        const row = rows(params.id).find(value => value.id === id);
        if (!row) throw new MockHttpError(conflict('部署不存在', { status: 409 }));
        if (row.eligible) { purgeMockCmsDeploymentStorage(params.id, id); const at = mockDateTime(); storage.set(id, { ...storage.get(id) ?? emptyStorage(), version: row.version + 1, schemaPurgedAt: at, filesPurgedAt: at, purgedAt: at, cleanupTaskId: task.id, schemaBytes: 0, fileBytes: 0, fileCount: 0 }); }
        return { id: index + 1, taskId: task.id, itemKey: String(id), label: `部署 #${id}`, status: row.eligible ? 'success' as const : 'skipped' as const, message: row.eligible ? '模拟存储已回收，审计记录保留' : row.protectedReasons.join('；'), data: { siteId: params.id, deploymentId: id }, attempt: task.attempts, createdAt: mockDateTime(), updatedAt: mockDateTime() };
      });
      setMockTaskItems(task.id, items); task.result = { processed: items.length };
    } }));
  }),
];
export function resetMockCmsDeploymentRetention() { policies.clear(); storage.clear(); }
