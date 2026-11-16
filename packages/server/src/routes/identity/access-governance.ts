import { OpenAPIHono } from '@hono/zod-openapi';
import { accessGovernanceContract } from '@zenith/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { idempotencyGuard } from '../../middleware/idempotency';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getAccessWorkflowResult } from '../../services/identity/access-workflow-query.service';
import {
  getAccessWorkflowOptions,
  evaluateAccessWorkflow,
  getAccessReviewOptions,
  retryAccessRequestProvision,
  revokeAccessGrantItem,
  retryAccessReviewCampaign,
  assignAccessReviewCampaign,
  createAccessReviewCampaign,
  decideReviewItem,
  getAccessGrant,
  getAccessRequest,
  getUserAccessOverview,
  listAccessGrants,
  listAccessRequests,
  listPermissionPolicies,
  listReviewCampaigns,
  listReviewItems,
  revokeAccessGrant,
  updatePermissionPolicy,
} from '../../services/identity/access-governance.service';

const accessGovernanceRouter = new OpenAPIHono({ defaultHook: validationHook });

const workflowResultRoute = defineContractRoute(accessGovernanceContract.workflowResult, {
  handler: async (c) => c.json(okBody(await getAccessWorkflowResult(c.req.valid('param').id)), 200),
});

const workflowOptionsRoute = defineContractRoute(accessGovernanceContract.workflowOptions, {
  handler: async (c) => c.json(okBody(await getAccessWorkflowOptions()), 200),
});
const workflowPreviewRoute = defineContractRoute(accessGovernanceContract.workflowPreview, {
  handler: async (c) => c.json(okBody(await evaluateAccessWorkflow(c.req.valid('json'))), 200),
});
const reviewOptionsRoute = defineContractRoute(accessGovernanceContract.reviewOptions, {
  handler: async (c) => c.json(okBody(await getAccessReviewOptions()), 200),
});
const myRequestListRoute = defineContractRoute(accessGovernanceContract.myRequests, {
  handler: async (c) => c.json(okBody(await listAccessRequests(c.req.valid('query'), true)), 200),
});
const myGrantListRoute = defineContractRoute(accessGovernanceContract.myGrants, {
  handler: async (c) => c.json(okBody(await listAccessGrants(c.req.valid('query'), true)), 200),
});
const requestRetryRoute = defineContractRoute(accessGovernanceContract.requestRetry, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await retryAccessRequestProvision(c.req.valid('param').id)), 200),
});
const grantItemRevokeRoute = defineContractRoute(accessGovernanceContract.grantItemRevoke, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await revokeAccessGrantItem(c.req.valid('param').id, c.req.valid('json'))), 200),
});
const reviewCampaignRetryRoute = defineContractRoute(accessGovernanceContract.reviewCampaignRetry, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await retryAccessReviewCampaign(c.req.valid('param').id)), 200),
});
const reviewCampaignAssignRoute = defineContractRoute(accessGovernanceContract.reviewCampaignAssign, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await assignAccessReviewCampaign(c.req.valid('param').id, c.req.valid('json'))), 200),
});
const requestListRoute = defineContractRoute(accessGovernanceContract.requestList, {
  handler: async (c) => c.json(okBody(await listAccessRequests(c.req.valid('query'))), 200),
});
const requestDetailRoute = defineContractRoute(accessGovernanceContract.requestDetail, {
  handler: async (c) => c.json(okBody(await getAccessRequest(c.req.valid('param').id)), 200),
});
const grantListRoute = defineContractRoute(accessGovernanceContract.grantList, {
  handler: async (c) => c.json(okBody(await listAccessGrants(c.req.valid('query'))), 200),
});
const grantDetailRoute = defineContractRoute(accessGovernanceContract.grantDetail, {
  handler: async (c) => c.json(okBody(await getAccessGrant(c.req.valid('param').id)), 200),
});
const grantRevokeRoute = defineContractRoute(accessGovernanceContract.grantRevoke, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await revokeAccessGrant(c.req.valid('param').id, c.req.valid('json'))), 200),
});
const reviewCampaignListRoute = defineContractRoute(accessGovernanceContract.reviewCampaignList, {
  handler: async (c) => c.json(okBody(await listReviewCampaigns(c.req.valid('query'))), 200),
});
const reviewCampaignCreateRoute = defineContractRoute(accessGovernanceContract.reviewCampaignCreate, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await createAccessReviewCampaign(c.req.valid('json'))), 200),
});
const reviewItemListRoute = defineContractRoute(accessGovernanceContract.reviewItemList, {
  handler: async (c) => c.json(okBody(await listReviewItems(c.req.valid('query'))), 200),
});
const reviewItemDecideRoute = defineContractRoute(accessGovernanceContract.reviewItemDecide, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await decideReviewItem(c.req.valid('param').id, c.req.valid('json'))), 200),
});
const policyListRoute = defineContractRoute(accessGovernanceContract.policyList, {
  handler: async (c) => c.json(okBody(await listPermissionPolicies(c.req.valid('query'))), 200),
});
const policyUpdateRoute = defineContractRoute(accessGovernanceContract.policyUpdate, {
  middleware: [idempotencyGuard()],
  handler: async (c) => c.json(okBody(await updatePermissionPolicy(c.req.valid('param').permissionCode, c.req.valid('json'))), 200),
});
const userOverviewRoute = defineContractRoute(accessGovernanceContract.userOverview, {
  handler: async (c) => c.json(okBody(await getUserAccessOverview(c.req.valid('param').id)), 200),
});

accessGovernanceRouter.openapiRoutes([
  workflowResultRoute,
  workflowOptionsRoute,
  workflowPreviewRoute,
  reviewOptionsRoute,
  myRequestListRoute,
  myGrantListRoute,
  requestRetryRoute,
  grantItemRevokeRoute,
  reviewCampaignRetryRoute,
  reviewCampaignAssignRoute,
  requestListRoute,
  requestDetailRoute,
  grantListRoute,
  grantDetailRoute,
  grantRevokeRoute,
  reviewCampaignListRoute,
  reviewCampaignCreateRoute,
  reviewItemListRoute,
  reviewItemDecideRoute,
  policyListRoute,
  policyUpdateRoute,
  userOverviewRoute,
] as const);

export default accessGovernanceRouter;
