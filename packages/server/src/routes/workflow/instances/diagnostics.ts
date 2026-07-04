// ─── 运行时诊断/轨迹/令牌视图/诊断包（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { ErrorResponse, jsonContent, commonErrorResponses, ok, IdParam, okBody } from '../../../lib/openapi-schemas';
import { WorkflowRuntimeDiagnosticsDTO, WorkflowInstanceTraceDTO, WorkflowExecutionTokenViewDTO, WorkflowDiagnosticBundleDTO } from '../../../lib/openapi-dtos';
import { getInstanceRuntimeDiagnostics, getInstanceTrace, getInstanceExecutionTokens, exportInstanceDiagnosticBundle } from '../../../services/workflow/workflow-instances.service';

export const diagnosticsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/diagnostics', tags: ['WorkflowInstances'], summary: '实例运行时技术诊断',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowRuntimeDiagnosticsDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在或无权查看' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceRuntimeDiagnostics(c.req.valid('param').id)), 200),
});

export const traceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/trace', tags: ['WorkflowInstances'], summary: '实例运行轨迹与引擎解释',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceTraceDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在或无权查看' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceTrace(c.req.valid('param').id)), 200),
});

export const tokensRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/tokens', tags: ['WorkflowInstances'], summary: '实例显式执行 Token（执行树/活动路径）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowExecutionTokenViewDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在或无权查看' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceExecutionTokens(c.req.valid('param').id)), 200),
});

export const diagnosticBundleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/diagnostic-bundle', tags: ['WorkflowInstances'], summary: '导出实例诊断包',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowDiagnosticBundleDTO, 'ok'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await exportInstanceDiagnosticBundle(c.req.valid('param').id)), 200),
});
