import { eq } from 'drizzle-orm';
import { ACCESS_REQUEST_BIZ_TYPE } from '@zenith/shared/identity';
import { db } from '../../db';
import { identityAccessGrants, identityAccessRequests } from '../../db/schema';
import { currentUser, hasPermission } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { requireAccessWorkflowViewer } from '../workflow/public/access-approval';
import { formatAccessGrant, formatAccessRequest } from './access-formatters';

export async function getAccessWorkflowResult(instanceId: number) {
  const user = currentUser();
  const request = requireRow(await db.query.identityAccessRequests.findFirst({
    where: buildWhere(eq(identityAccessRequests.workflowInstanceId, instanceId), tenantCondition(identityAccessRequests, user)),
    with: { applicant: true, target: true, items: true },
  }), '权限申请不存在');
  if (!(await hasPermission('system:access-governance:view'))) {
    await requireAccessWorkflowViewer(instanceId, ACCESS_REQUEST_BIZ_TYPE, String(request.id));
  }
  const grant = await db.query.identityAccessGrants.findFirst({
    where: buildWhere(eq(identityAccessGrants.requestId, request.id), tenantCondition(identityAccessGrants, user)),
    with: { user: true, approver: true, revoker: true, items: true },
  });
  return { request: formatAccessRequest(request), grant: grant ? formatAccessGrant(grant) : null };
}
