import { OpenAPIHono } from '@hono/zod-openapi';
import { reportGovernanceContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  checkReportResourceAccess,
  grantReportResourceAcl,
  listReportResourceAcls,
  revokeReportResourceAcl,
  updateReportResourceAcl,
} from '../../services/report/report-resource-acl.service';
import {
  cancelReportPublishApproval,
  cancelReportResourceTransfer,
  createReportPublishApproval,
  createReportResourceTransfer,
  decideReportPublishApproval,
  decideReportResourceTransfer,
  listReportPublishApprovals,
  listReportResourceTransfers,
} from '../../services/report/report-governance.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listAclsRoute = defineContractRoute(reportGovernanceContract.acls, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:acl' })],
  handler: async (c) => {
    const query = c.req.valid('query');
    return c.json(okBody(await listReportResourceAcls(query.resourceType, query.resourceId, query.inheritFromFolder)), 200);
  },
});

const grantAclRoute = defineContractRoute(reportGovernanceContract.grantAcl, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:acl', audit: { module: '报表资源治理', description: '授予资源权限' } })],
  handler: async (c) => c.json(okBody(await grantReportResourceAcl(c.req.valid('json')), '授权成功'), 200),
});

const updateAclRoute = defineContractRoute(reportGovernanceContract.updateAcl, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:acl', audit: { module: '报表资源治理', description: '更新资源权限' } })],
  handler: async (c) => c.json(okBody(await updateReportResourceAcl(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const revokeAclRoute = defineContractRoute(reportGovernanceContract.revokeAcl, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:acl', audit: { module: '报表资源治理', description: '撤销资源权限' } })],
  handler: async (c) => {
    await revokeReportResourceAcl(c.req.valid('param').id);
    return c.json(okBody(null, '撤销成功'), 200);
  },
});

const checkAccessRoute = defineContractRoute(reportGovernanceContract.checkAccess, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:access' })],
  handler: async (c) => {
    const input = c.req.valid('json');
    return c.json(okBody(await checkReportResourceAccess(input.resourceType, input.resourceId, input.requiredRole)), 200);
  },
});

const listTransfersRoute = defineContractRoute(reportGovernanceContract.transfers, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:transfer' })],
  handler: async (c) => c.json(okBody(await listReportResourceTransfers(c.req.valid('query'))), 200),
});

const createTransferRoute = defineContractRoute(reportGovernanceContract.createTransfer, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:transfer', audit: { module: '报表资源治理', description: '申请资源转移' } })],
  handler: async (c) => c.json(okBody(await createReportResourceTransfer(c.req.valid('json')), '申请成功'), 200),
});

const decideTransferRoute = defineContractRoute(reportGovernanceContract.decideTransfer, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:transfer', audit: { module: '报表资源治理', description: '处理资源转移' } })],
  handler: async (c) => c.json(okBody(await decideReportResourceTransfer(c.req.valid('param').id, c.req.valid('json')), '处理成功'), 200),
});

const cancelTransferRoute = defineContractRoute(reportGovernanceContract.cancelTransfer, {
  middleware: [authMiddleware, guard({ permission: 'report:resource:transfer', audit: { module: '报表资源治理', description: '取消资源转移' } })],
  handler: async (c) => c.json(okBody(await cancelReportResourceTransfer(c.req.valid('param').id, c.req.valid('json').reason), '取消成功'), 200),
});

const listApprovalsRoute = defineContractRoute(reportGovernanceContract.approvals, {
  middleware: [authMiddleware, guard({ permission: 'report:approval:list' })],
  handler: async (c) => c.json(okBody(await listReportPublishApprovals(c.req.valid('query'))), 200),
});

const createApprovalRoute = defineContractRoute(reportGovernanceContract.createApproval, {
  middleware: [authMiddleware, guard({ permission: 'report:approval:request', audit: { module: '报表资源治理', description: '申请发布审批' } })],
  handler: async (c) => c.json(okBody(await createReportPublishApproval(c.req.valid('json')), '申请成功'), 200),
});

const decideApprovalRoute = defineContractRoute(reportGovernanceContract.decideApproval, {
  middleware: [authMiddleware, guard({ permission: 'report:approval:approve', audit: { module: '报表资源治理', description: '处理发布审批' } })],
  handler: async (c) => c.json(okBody(await decideReportPublishApproval(c.req.valid('param').id, c.req.valid('json')), '处理成功'), 200),
});

const cancelApprovalRoute = defineContractRoute(reportGovernanceContract.cancelApproval, {
  middleware: [authMiddleware, guard({ permission: 'report:approval:request', audit: { module: '报表资源治理', description: '取消发布审批' } })],
  handler: async (c) => c.json(okBody(await cancelReportPublishApproval(c.req.valid('param').id, c.req.valid('json').reason), '取消成功'), 200),
});

router.openapiRoutes([
  listAclsRoute, grantAclRoute, updateAclRoute, revokeAclRoute, checkAccessRoute,
  listTransfersRoute, createTransferRoute, decideTransferRoute, cancelTransferRoute,
  listApprovalsRoute, createApprovalRoute, decideApprovalRoute, cancelApprovalRoute,
] as const);

export default router;
