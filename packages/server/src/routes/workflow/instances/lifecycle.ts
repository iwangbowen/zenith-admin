import { redactWorkflowSignatureImages } from '../../../services/workflow/instances/signature-audit';
// ─── 实例生命周期：创建/撤回/取消/删除/草稿/重新提交 ───
import { workflowInstanceContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { createInstance, withdrawInstance, cancelInstance, deleteInstance, getInstanceForAdminAudit, getWorkflowInstanceBeforeAudit, updateInstanceDraft, submitDraftInstance, resubmitInstance } from '../../../services/workflow/workflow-instances.service';
import { getDraftEditor, listOwnDrafts, deleteOwnDraft } from '../../../services/workflow/workflow-instances.service';

export const ownDraftsRoute = defineContractRoute(workflowInstanceContract.ownDrafts, { handler: async c => c.json(okBody(await listOwnDrafts(c.req.valid('query'))), 200) });
export const draftEditorRoute = defineContractRoute(workflowInstanceContract.draftEditor, {
  // Hono 4.13.19 的 JSONParsed 会对递归的 WorkflowFormField 做循环截断（columns.fields → JSONValue），
  // 与契约响应类型不再结构一致；运行时无影响，这里按契约响应类型收口。
  handler: async c => c.json(okBody(await getDraftEditor(c.req.valid('param').id)), 200) as never,
});
export const deleteOwnDraftRoute = defineContractRoute(workflowInstanceContract.removeDraft, { handler: async c => { await deleteOwnDraft(c.req.valid('param').id); return c.json(okBody(null, '草稿已删除'), 200); } });

export const createInstanceRoute = defineContractRoute(workflowInstanceContract.create, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const body = c.req.valid('json');
    const r = await createInstance(body);
    setAuditAfterData(c, redactWorkflowSignatureImages(r));
    return c.json(okBody(r, body.asDraft ? '草稿已保存' : '申请已提交'), 200);
  },
});

export const withdrawRoute = defineContractRoute(workflowInstanceContract.withdraw, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await withdrawInstance(id);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已撤回'), 200);
  },
});

export const cancelInstanceRoute = defineContractRoute(workflowInstanceContract.cancel, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await cancelInstance(id);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已取消'), 200);
  },
});

export const deleteInstanceRoute = defineContractRoute(workflowInstanceContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteInstance(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

export const updateDraftRoute = defineContractRoute(workflowInstanceContract.updateDraft, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await updateInstanceDraft(id, c.req.valid('json'));
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '草稿已保存'), 200);
  },
});

export const submitDraftRoute = defineContractRoute(workflowInstanceContract.submitDraft, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await submitDraftInstance(id, body);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '申请已提交'), 200);
  },
});

export const resubmitRoute = defineContractRoute(workflowInstanceContract.resubmit, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await resubmitInstance(id);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已生成草稿'), 200);
  },
});
