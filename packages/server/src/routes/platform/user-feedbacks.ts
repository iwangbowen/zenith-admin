import { OpenAPIHono } from '@hono/zod-openapi';
import { userFeedbackContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  batchDeleteUserFeedbacks,
  createUserFeedback,
  deleteUserFeedback,
  ensureUserFeedbackExists,
  handleUserFeedback,
  listUserFeedbacks,
  mapUserFeedback,
} from '../../services/platform/user-feedbacks.service';

const userFeedbacksRouter = new OpenAPIHono({ defaultHook: validationHook });

const notFoundResponse = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// 提交反馈：所有登录用户可用，无需权限码
const submitRoute = defineContractRoute(userFeedbackContract.submit, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10, message: '反馈提交中，请勿重复提交' })],
  handler: async (c) => {
    const data = c.req.valid('json');
    const row = await createUserFeedback(data);
    return c.json(okBody(row, '感谢您的反馈'), 200);
  },
});

const listRoute = defineContractRoute(userFeedbackContract.list, {
  middleware: [authMiddleware, guard({ permission: 'system:feedback:list' })],
  handler: async (c) => c.json(okBody(await listUserFeedbacks(c.req.valid('query'))), 200),
});

const handleRoute = defineContractRoute(userFeedbackContract.handle, {
  middleware: [authMiddleware, guard({ permission: 'system:feedback:handle', audit: { description: '处理意见反馈', module: '意见反馈' } })],
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await ensureUserFeedbackExists(id);
    setAuditBeforeData(c, mapUserFeedback(before));
    const row = await handleUserFeedback(id, data);
    return c.json(okBody(row, '处理成功'), 200);
  },
});

// `DELETE /batch` 必须注册在 `DELETE /{id}` 之前
const batchDeleteRoute = defineContractRoute(userFeedbackContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'system:feedback:delete', audit: { description: '批量删除意见反馈', module: '意见反馈' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!ids || ids.length === 0) {
      return c.json(errBody('请选择要删除的记录'), 400);
    }
    const deleted = await batchDeleteUserFeedbacks(ids);
    return c.json(okBody(null, `已删除 ${deleted} 条记录`), 200);
  },
});

const deleteRoute = defineContractRoute(userFeedbackContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:feedback:delete', audit: { description: '删除意见反馈', module: '意见反馈' } })],
  responses: notFoundResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureUserFeedbackExists(id);
    setAuditBeforeData(c, mapUserFeedback(before));
    await deleteUserFeedback(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

userFeedbacksRouter.openapiRoutes([submitRoute, listRoute, handleRoute, batchDeleteRoute, deleteRoute] as const);

export default userFeedbacksRouter;
