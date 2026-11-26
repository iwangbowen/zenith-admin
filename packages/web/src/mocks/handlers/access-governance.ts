import { accessGovernanceContract, accessPolicyBaseline, type PermissionPolicy } from '@zenith/shared/identity';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { mock } from '../utils/contract';
import { matchesFilter } from '../utils/filter';
import { badRequest, notFound } from '../utils/handlers';
import { mockDateTime } from '../utils/date';
import { evaluateMockAccess, mockAccessActor, mockAccessGrants, mockAccessInstances, mockAccessOptions, mockAccessPolicies, mockAccessPolicy, mockAccessResult, mockAccessScope } from '../utils/access-workflow';

function policies(): PermissionPolicy[] {
  return Object.entries(ALL_PERMISSIONS).map(([code, meta], index) => ({ ...mockAccessPolicy(code), id: index + 1,
    permissionLabel: meta.label, inherited: !mockAccessPolicies.has(code), minimumRiskLevel: accessPolicyBaseline(code, meta).riskLevel,
    selfRequestable: accessPolicyBaseline(code, meta).enabled, createdAt: null, updatedAt: null }));
}
export const accessGovernanceHandlers = [
  mock(accessGovernanceContract.workflowOptions, ({ ok }) => ok(mockAccessOptions())),
  mock(accessGovernanceContract.assignmentOptions, ({ ok }) => ok(mockAccessScope(true))),
  mock(accessGovernanceContract.workflowPreview, ({ body, request, ok }) => ok(evaluateMockAccess(body, mockAccessActor(request)))),
  mock(accessGovernanceContract.workflowResult, ({ params, ok }) => {
    const instance = mockAccessInstances().find(item => item.id === params.id);
    return instance ? ok(mockAccessResult(instance)) : notFound('权限申请不存在');
  }),
  mock(accessGovernanceContract.requestWorkflow, ({ params, ok }) => {
    const instance = mockAccessInstances().find(item => item.id === params.id);
    return instance ? ok(instance) : notFound('权限申请不存在');
  }),
  mock(accessGovernanceContract.requestList, ({ query, ok, paginate }) => {
    const rows = mockAccessInstances().map(item => mockAccessResult(item).request).filter(item => item.status === 'approved'
      && matchesFilter(item.provisionStatus, query.provisionStatus) && matchesFilter(item.riskLevel, query.riskLevel)
      && (!query.keyword || (item.reason + item.workflowTitle + item.workflowSerialNo).includes(query.keyword)));
    return ok(paginate(rows));
  }),
  mock(accessGovernanceContract.requestDetail, ({ params, ok }) => {
    const instance = mockAccessInstances().find(item => item.id === params.id);
    return instance ? ok(mockAccessResult(instance).request) : notFound('申请不存在');
  }),
  mock(accessGovernanceContract.grantList, ({ query, ok, paginate }) => {
    mockAccessInstances().forEach(mockAccessResult);
    return ok(paginate([...mockAccessGrants.values()].filter(grant => matchesFilter(grant.status, query.status) && matchesFilter(grant.userId, query.userId))));
  }),
  mock(accessGovernanceContract.grantDetail, ({ params, ok }) => {
    const grant = mockAccessGrants.get(params.id);
    return grant ? ok(grant) : notFound('授权不存在');
  }),
  mock(accessGovernanceContract.grantRevoke, ({ params, body, ok }) => {
    const grant = mockAccessGrants.get(params.id);
    if (!grant) return notFound('授权不存在');
    grant.status = 'revoked'; grant.items.forEach(item => { item.status = 'revoked'; item.revokeReason = body.reason; item.revokedAt = mockDateTime(); });
    return ok(grant);
  }),
  mock(accessGovernanceContract.grantItemRevoke, ({ params, body, ok }) => {
    const grant = [...mockAccessGrants.values()].find(item => item.items.some(entry => entry.id === params.id));
    if (!grant) return notFound('授权项不存在');
    const item = grant.items.find(entry => entry.id === params.id)!;
    item.status = 'revoked'; item.revokeReason = body.reason; item.revokedAt = mockDateTime();
    if (grant.items.every(entry => entry.status === 'revoked')) grant.status = 'revoked';
    return ok(grant);
  }),
  mock(accessGovernanceContract.requestRetry, () => badRequest('演示发放已完成，无需重试')),
  mock(accessGovernanceContract.policyList, ({ query, ok, paginate }) => ok(paginate(policies().filter(item => (!query.keyword || (item.permissionCode + item.permissionLabel).includes(query.keyword)) && matchesFilter(item.riskLevel, query.riskLevel) && matchesFilter(item.approvalPolicy, query.approvalPolicy))))),
  mock(accessGovernanceContract.policyUpdate, ({ params, body, ok }) => {
    const previous = policies().find(item => item.permissionCode === params.permissionCode);
    if (!previous) return notFound('策略不存在');
    const policy = { ...previous, ...body, inherited: false, version: previous.version + 1 };
    mockAccessPolicies.set(params.permissionCode, policy); return ok(policy);
  }),
  mock(accessGovernanceContract.reviewCampaignList, ({ ok, paginate }) => ok(paginate([]))),
  mock(accessGovernanceContract.reviewItemList, ({ ok, paginate }) => ok(paginate([]))),
  mock(accessGovernanceContract.userOverview, ({ params, ok }) => ok({ userId: params.id, grants: [...mockAccessGrants.values()].filter(item => item.userId === params.id), reviews: [] })),
];
