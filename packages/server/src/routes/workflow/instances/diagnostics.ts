// ─── 运行时诊断/轨迹/令牌视图/诊断包 ───
import { workflowInstanceOpsContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { getInstanceRuntimeDiagnostics, getInstanceTrace, getInstanceExecutionTokens, exportInstanceDiagnosticBundle } from '../../../services/workflow/workflow-instances.service';

const monitor = [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const;

export const diagnosticsRoute = defineContractRoute(workflowInstanceOpsContract.diagnostics, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getInstanceRuntimeDiagnostics(c.req.valid('param').id)), 200),
});

export const traceRoute = defineContractRoute(workflowInstanceOpsContract.trace, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getInstanceTrace(c.req.valid('param').id)), 200),
});

export const tokensRoute = defineContractRoute(workflowInstanceOpsContract.tokens, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getInstanceExecutionTokens(c.req.valid('param').id)), 200),
});

export const diagnosticBundleRoute = defineContractRoute(workflowInstanceOpsContract.diagnosticBundle, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await exportInstanceDiagnosticBundle(c.req.valid('param').id)), 200),
});
