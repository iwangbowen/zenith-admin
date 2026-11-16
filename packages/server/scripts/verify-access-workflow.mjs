/** Opt-in local API/worker acceptance. Credentials and state stay outside the repository. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';

const origin = process.env.ZENITH_QA_URL ?? 'http://localhost:3300';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Acceptance fixtures are restricted to a local development server.');
const { default: dotenv } = await import('dotenv');
dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
if (process.env.NODE_ENV !== 'development') throw new Error('Run only with NODE_ENV=development.');
async function localDatabase() {
  const { default: postgres } = await import('postgres');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the development acceptance fixture.');
  return postgres(process.env.DATABASE_URL, { max: 1 });
}
const statePath = process.env.ZENITH_QA_STATE;
if (!statePath || !process.env.ZENITH_QA_ADMIN_PASSWORD) throw new Error('Set ZENITH_QA_STATE and ZENITH_QA_ADMIN_PASSWORD for this opt-in acceptance run.');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { prefix: 'qa_access_' + Date.now().toString(36), users: [], roles: [], departments: [], instances: [], report: [] };
function persist() { writeFileSync(statePath, JSON.stringify(state, null, 2)); }
function check(condition, name) { if (!condition) throw new Error(name); state.report.push({ name, passed: true }); persist(); console.log('PASS ' + name); }
async function call(token, method, path, body, accepted = [200]) {
  const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!accepted.includes(response.status) || (response.ok && result.code !== 0)) throw new Error(method + ' ' + path + ': ' + response.status + ' ' + result.message);
  return { status: response.status, data: result.data, message: result.message };
}
async function login(username, password) {
  const result = (await call(null, 'POST', '/api/auth/login', { username, password, deviceId: state.prefix + '_' + username })).data;
  if (!result?.token?.accessToken) throw new Error('Login did not issue a token for ' + username);
  return result.token.accessToken;
}
const admin = await login(process.env.ZENITH_QA_ADMIN_USER ?? 'admin', process.env.ZENITH_QA_ADMIN_PASSWORD);
const at = delta => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(Date.now() + delta));
function totp(secret) {
  let bits = 0, value = 0; const bytes = [];
  for (const character of secret) { value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(); const offset = hash.at(-1) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const policyInput = (approvalPolicy, riskLevel = 'low', mfaRequired = false) => ({ riskLevel, approvalPolicy, mfaRequired, maxDurationMinutes: 480, reviewIntervalDays: riskLevel === 'critical' ? 30 : riskLevel === 'high' ? 90 : 0, enabled: true, permanentAllowed: true, emergencyAllowed: true, maxEmergencyMinutes: 60 });
async function policy(code, approvalPolicy, riskLevel = 'low', mfaRequired = false) {
  state.originalPolicies ??= {};
  if (!state.originalPolicies[code]) { state.originalPolicies[code] = (await call(admin, 'GET', '/api/access-governance/policies?keyword=' + encodeURIComponent(code) + '&page=1&pageSize=100')).data.list.find(item => item.permissionCode === code); persist(); }
  return (await call(admin, 'PUT', '/api/access-governance/policies/' + encodeURIComponent(code), policyInput(approvalPolicy, riskLevel, mfaRequired))).data;
}
const command = process.argv[2] ?? 'setup';
if (command === 'setup') {
  if (state.cleaned) throw new Error('Use a new state file after fixture cleanup.');
  state.password ??= 'Qa!' + randomBytes(12).toString('hex'); persist();
  const menus = (await call(admin, 'GET', '/api/menus/flat')).data;
  const workflowMenus = menus.filter(item => item.path?.startsWith('/workflow') || ['workflow:instance:create', 'workflow:instance:list', 'workflow:task:handle'].includes(item.permission));
  const role = state.roles.length ? { id: state.roles[0] } : (await call(admin, 'POST', '/api/roles', { name: state.prefix + '审批成员', code: state.prefix.replace(/[0-9]/g, '') + '_member', dataScope: 'self' })).data;
  if (!state.roles.includes(role.id)) state.roles.push(role.id); persist();
  await call(admin, 'PUT', '/api/roles/' + role.id + '/menus', { menuIds: workflowMenus.map(item => item.id) });
  const department = state.departments.length ? { id: state.departments[0] } : (await call(admin, 'POST', '/api/departments', { name: state.prefix + '验收部门', code: state.prefix, parentId: 0 })).data;
  if (!state.departments.includes(department.id)) state.departments.push(department.id); persist();
  const sql = await localDatabase();
  let securityRole;
  try {
    // A dedicated security identity takes precedence over pre-existing platform administrators.
    const [existing] = await sql`select id from roles where code = 'security_admin' and tenant_id is null and status = 'enabled'`;
    if (existing) securityRole = existing;
    else {
      const [created] = await sql`insert into roles (name, code, permission_codes, data_scope) values (${state.prefix + '安全审批'}, 'security_admin', ${sql.json(['workflow:instance:create', 'workflow:instance:list', 'workflow:task:handle'])}, 'self') returning id`;
      securityRole = created; state.roles.push(created.id); persist();
      await sql`insert into identity_role_versions (role_id, version, permission_codes, data_scope, dept_scope_ids) select id, permission_version, permission_codes, data_scope, '[]'::jsonb from roles where id = ${created.id}`;
      for (const menu of workflowMenus) await sql`insert into role_menus (role_id, menu_id) values (${created.id}, ${menu.id}) on conflict do nothing`;
    }
  } finally { await sql.end(); }
  for (const [name, nickname, security] of [['manager', '验收部门负责人', false], ['applicant', '验收申请人', false], ['outsider', '验收无关人员', false], ['security_a', '验收安全甲', true], ['security_b', '验收安全乙', true]]) {
    if (state.users.some(item => item.name === name)) continue;
    const user = (await call(admin, 'POST', '/api/users', { username: state.prefix + '_' + name, nickname, password: state.password, organization: { departmentId: department.id, positionIds: [] }, roles: { roleIds: [security ? securityRole.id : role.id] } })).data;
    state.users.push({ id: user.id, username: user.username, name }); persist();
    const token = await login(user.username, state.password);
    if (security) { const setup = (await call(token, 'POST', '/api/auth/mfa/totp/setup')).data; await call(token, 'POST', '/api/auth/mfa/totp/verify', { factorId: setup.factorId, code: totp(setup.secret) }); state.users.at(-1).totpSecret = setup.secret; persist(); }
  }
  await call(admin, 'PUT', '/api/departments/' + department.id, { leaderId: state.users.find(user => user.name === 'manager').id });
  check(true, 'isolated applicant, manager, outsider and two security actors created');
  console.log(JSON.stringify({ prefix: state.prefix, statePath }));
} else if (command === 'run') {
  const sessions = {};
  for (const user of state.users) sessions[user.name] = { ...user, token: await login(user.username, state.password) };
  const applicant = sessions.applicant.token;
  const definition = (await call(applicant, 'GET', '/api/workflows/definitions/published')).data.find(item => item.customForm?.businessType === 'identity.access_request');
  if (!definition) throw new Error('Permission application missing from launchpad');
  async function create(label, codes, extra = {}) {
    const input = { requestType: 'temporary', roleSelections: [], permissionCodes: codes, reason: state.prefix + ' ' + label, startMode: 'immediate', validityMode: 'limited', expiresAt: at(3600000), ...extra };
    const preview = (await call(applicant, 'POST', '/api/access-governance/workflow-preview', input)).data;
    if (preview.status !== 'ready') throw new Error('Preview blocked: ' + preview.message);
    const instance = (await call(applicant, 'POST', '/api/workflows/instances', { definitionId: definition.id, title: state.prefix + ' ' + label, formData: { ...input, previewFingerprint: preview.fingerprint } })).data;
    state.instances.push(instance.id); persist(); return instance;
  }
  async function result(id, token = applicant) { return (await call(token, 'GET', '/api/access-governance/workflow/' + id + '/result')).data; }
  async function issued(id) {
    for (let i = 0; i < 25; i++) { const value = await result(id); if (value.request.provisionStatus === 'succeeded') return value; if (['failed', 'terminated'].includes(value.request.provisionStatus)) throw new Error('Issuance: ' + value.request.failureReason); await new Promise(resolve => setTimeout(resolve, 1000)); }
    throw new Error('Issuance worker timed out');
  }
  async function approveAll(id, mfa = false) {
    for (let round = 0; round < 5; round++) {
      const instance = (await call(applicant, 'GET', '/api/workflows/instances/' + id)).data;
      if (instance.status === 'approved') return;
      const task = instance.tasks.find(item => item.status === 'pending' && item.nodeType === 'approve');
      if (!task) { await new Promise(resolve => setTimeout(resolve, 600)); continue; }
      const actor = Object.values(sessions).find(item => item.id === task.assigneeId);
      if (!actor) throw new Error('Unexpected approver ' + task.assigneeId);
      const pending = (await call(actor.token, 'GET', '/api/workflows/instances/pending-mine?page=1&pageSize=50&keyword=' + encodeURIComponent(state.prefix))).data.list;
      check(pending.some(item => item.pendingTaskId === task.id), 'ordinary pending queue includes ' + task.nodeName);
      await call(actor.token, 'POST', '/api/workflows/tasks/' + task.id + '/approve', { comment: '验收确认', ...(mfa ? { businessInput: { mfaCode: totp(actor.totpSecret ?? state.users.find(user => user.id === actor.id)?.totpSecret) } } : {}) });
    }
    throw new Error('Approval did not reach a terminal state');
  }
  for (const id of state.instances) {
    const currentInstance = (await call(applicant, 'GET', '/api/workflows/instances/' + id)).data;
    if (currentInstance.status === 'running') await call(applicant, 'POST', '/api/workflows/instances/' + id + '/withdraw');
    const previous = await result(id);
    if (previous.grant && previous.grant.status !== 'revoked') await call(admin, 'POST', '/api/access-governance/grants/' + previous.grant.id + '/revoke', { reason: '验收重跑前回收' });
  }
  await policy('system:user:list', 'none'); await policy('system:department:list', 'none');
  const auto = await create('自动发放与逐项撤权', ['system:user:list', 'system:department:list']);
  const granted = await issued(auto.id);
  check(granted.grant.items.length === 2, 'automatic approval durably issues two permission items');
  const outsiders = await call(sessions.outside?.token ?? sessions.outsider.token, 'GET', '/api/access-governance/workflow/' + auto.id + '/result', undefined, [403]);
  check(outsiders.status === 403, 'unrelated workflow user cannot read authorization result');
  const search = (await call(applicant, 'GET', '/api/workflows/instances?page=1&pageSize=20&keyword=' + encodeURIComponent(auto.serialNo || auto.title))).data;
  check(search.list.some(item => item.id === auto.id), 'generic application search finds title or business number');
  await call(admin, 'POST', '/api/access-governance/grant-items/' + granted.grant.items[0].id + '/revoke', { reason: '验收单项撤销' });
  const revoked = await result(auto.id);
  check(revoked.grant.items.filter(item => item.status === 'revoked').length === 1 && revoked.grant.items.filter(item => item.status === 'active').length === 1, 'single-item revocation appears live without revoking another item');
  await call(admin, 'POST', '/api/access-governance/grants/' + granted.grant.id + '/revoke', { reason: '验收结束回收授权' });
  await policy('system:user:list', 'manager');
  const withdrawal = await create('撤回不发权', ['system:user:list']);
  await call(applicant, 'POST', '/api/workflows/instances/' + withdrawal.id + '/withdraw');
  check((await result(withdrawal.id)).grant === null, 'withdrawal does not issue permissions');
  const rejection = await create('驳回不发权', ['system:user:list']);
  const rejectDetail = (await call(applicant, 'GET', '/api/workflows/instances/' + rejection.id)).data;
  const rejectTask = rejectDetail.tasks.find(item => item.status === 'pending');
  await call(sessions.manager.token, 'POST', '/api/workflows/tasks/' + rejectTask.id + '/reject', { comment: '验收驳回' });
  check((await result(rejection.id)).grant === null, 'rejection does not issue permissions');
  const manual = await create('主管审批发放', ['system:user:list']); await approveAll(manual.id); const manualGrant = await issued(manual.id);
  check(manualGrant.grant.items.length === 1, 'manager approval issues live authorization');
  await call(admin, 'POST', '/api/access-governance/grants/' + manualGrant.grant.id + '/revoke', { reason: '验收回收' });
  await policy('system:user:list', 'manager_security', 'high');
  const high = await create('高风险独立安全审批', ['system:user:list']); await approveAll(high.id); const highGrant = await issued(high.id);
  check(highGrant.request.approvalEvidence.length === 2, 'high-risk request records independent manager/security evidence');
  await call(admin, 'POST', '/api/access-governance/grants/' + highGrant.grant.id + '/revoke', { reason: '验收回收' });
  await policy('system:user:list', 'two_person', 'critical', true);
  // The manager also needs their own MFA for every approval in a critical request.
  const setup = (await call(sessions.manager.token, 'POST', '/api/auth/mfa/totp/setup')).data;
  await call(sessions.manager.token, 'POST', '/api/auth/mfa/totp/verify', { factorId: setup.factorId, code: totp(setup.secret) });
  sessions.manager.totpSecret = setup.secret; state.users.find(user => user.name === 'manager').totpSecret = setup.secret; persist();
  const critical = await create('极高风险与当次MFA', ['system:user:list']);
  const pendingCritical = (await call(applicant, 'GET', '/api/workflows/instances/' + critical.id)).data.tasks.find(item => item.status === 'pending');
  await call(sessions.manager.token, 'POST', '/api/workflows/tasks/' + pendingCritical.id + '/approve', { comment: '缺少动态码应失败' }, [400]);
  check(true, 'MFA-required approval rejects missing business input');
  await approveAll(critical.id, true); const criticalGrant = await issued(critical.id);
  check(criticalGrant.request.approvalEvidence.length === 3 && criticalGrant.request.approvalEvidence.every(item => item.mfaVerifiedAt), 'critical approval verifies MFA for three independent actors');
  await call(admin, 'POST', '/api/access-governance/grants/' + criticalGrant.grant.id + '/revoke', { reason: '验收回收' });
  check(true, 'core API/worker permission request matrix complete');
} else if (command === 'extended') {
  const applicantRecord = state.users.find(user => user.name === 'applicant');
  const managerRecord = state.users.find(user => user.name === 'manager');
  const applicant = await login(applicantRecord.username, state.password);
  const manager = await login(managerRecord.username, state.password);
  const definition = (await call(applicant, 'GET', '/api/workflows/definitions/published')).data.find(item => item.customForm?.businessType === 'identity.access_request');
  await policy('system:user:list', 'none');
  async function create(label, extra = {}) {
    const input = { requestType: 'temporary', roleSelections: [], permissionCodes: ['system:user:list'], reason: state.prefix + ' ' + label, startMode: 'immediate', validityMode: 'limited', expiresAt: at(3600000), ...extra };
    const preview = (await call(applicant, 'POST', '/api/access-governance/workflow-preview', input)).data;
    if (preview.status !== 'ready') throw new Error(preview.message);
    const instance = (await call(applicant, 'POST', '/api/workflows/instances', { definitionId: definition.id, title: state.prefix + ' ' + label, formData: { ...input, previewFingerprint: preview.fingerprint } })).data;
    state.instances.push(instance.id); persist(); return instance;
  }
  async function live(id) { return (await call(applicant, 'GET', '/api/access-governance/workflow/' + id + '/result')).data; }
  async function issued(id) {
    for (let i=0;i<25;i++) { const row=await live(id); if(row.grant)return row; await new Promise(resolve=>setTimeout(resolve,1000)); }
    throw new Error('Worker issuance timeout');
  }
  async function revoke(grant) { await call(admin, 'POST', '/api/access-governance/grants/' + grant.id + '/revoke', { reason: '验收回收' }); }
  const scheduled = await create('预约生效', { startMode: 'scheduled', startsAt: at(600000), expiresAt: at(1200000) });
  const scheduledResult = await issued(scheduled.id); check(scheduledResult.grant.items.every(item=>item.status==='scheduled'), 'scheduled grant stays unavailable before startsAt'); await revoke(scheduledResult.grant);
  const permanent = await create('永久授权', { validityMode: 'permanent', expiresAt: null });
  const permanentResult = await issued(permanent.id); check(permanentResult.grant.items.every(item=>item.expiresAt===null), 'permanent authorization keeps null expiration'); await revoke(permanentResult.grant);
  const expiry = await create('短期到期验证', { expiresAt: at(20000) });
  const expiryResult = await issued(expiry.id);
  for(let i=0;i<25;i++){const row=await live(expiry.id);if(row.grant.items[0].status==='expired'){check(true,'live authorization expires by request-time clock');break;}await new Promise(resolve=>setTimeout(resolve,1000));if(i===24)throw new Error('Clock expiry did not take effect');}
  const reviewed = await create('权限复核与延期'); const reviewGrant = await issued(reviewed.id);
  const campaign = (await call(admin,'POST','/api/access-governance/review-campaigns',{name:state.prefix+'复核',scopeType:'user',scopeIds:[applicantRecord.id],reviewerId:1,dueAt:at(86400000)})).data;
  state.campaigns ??=[];state.campaigns.push(campaign.id);persist();let reviewItems=[];
  for(let i=0;i<25;i++){reviewItems=(await call(admin,'GET','/api/access-governance/review-items?campaignId='+campaign.id+'&page=1&pageSize=100')).data.list;if(reviewItems.some(item=>item.sourceType==='temporary_grant'&&item.sourceId===reviewGrant.grant.items[0].id))break;await new Promise(resolve=>setTimeout(resolve,1000));}
  const reviewItem=reviewItems.find(item=>item.sourceType==='temporary_grant'&&item.sourceId===reviewGrant.grant.items[0].id);if(!reviewItem)throw new Error('Review preparation missing grant source');
  await call(admin,'POST','/api/access-governance/review-items/'+reviewItem.id+'/decide',{decision:'extend',expiresAt:at(7200000),remark:'验收延长授权有效期'});
  check((await live(reviewed.id)).grant.items[0].expiresAt>reviewGrant.grant.items[0].expiresAt,'review extension updates live item expiration');await revoke(reviewGrant.grant);
  const flow={nodes:[
    {id:'start',type:'workflowNode',position:{x:0,y:0},data:{key:'start',type:'start',label:'发起'}},
    {id:'manager',type:'workflowNode',position:{x:180,y:0},data:{key:'approve_manager',type:'approve',label:'独立主管审批',assigneeType:'user',assigneeIds:[managerRecord.id],approvalType:'manual',approveMethod:'or',emptyStrategy:'reject',sameInitiatorStrategy:'toDirectManager'}},
    {id:'end',type:'workflowNode',position:{x:360,y:0},data:{key:'end',type:'end',label:'结束'}}
  ],edges:[{id:'s_m',source:'start',target:'manager'},{id:'m_e',source:'manager',target:'end'}],settings:{allowWithdraw:true,allowResubmit:true,notifyInitiator:true}};
  const ordinary=(await call(admin,'POST','/api/workflows/definitions',{name:state.prefix+'普通办公流程',description:'普通流程独立回归',formType:'designer',flowData:flow})).data;
  state.definitions??=[];state.definitions.push(ordinary.id);persist();await call(admin,'POST','/api/workflows/definitions/'+ordinary.id+'/publish');
  const normal=(await call(applicant,'POST','/api/workflows/instances',{definitionId:ordinary.id,title:state.prefix+'普通办公申请',formData:{remark:'不涉及权限的独立业务申请'}})).data;state.instances.push(normal.id);persist();
  const detail=(await call(applicant,'GET','/api/workflows/instances/'+normal.id)).data;const task=detail.tasks.find(item=>item.status==='pending');
  await call(manager,'POST','/api/workflows/tasks/'+task.id+'/approve',{comment:'普通流程审批通过'});
  check((await call(applicant,'GET','/api/workflows/instances/'+normal.id)).data.status==='approved','independent ordinary workflow reaches approved');
  check(!(await call(admin,'GET','/api/access-governance/requests?page=1&pageSize=100')).data.list.some(item=>item.workflowInstanceId===normal.id),'ordinary workflow never appears in permission issuance records');
  console.log('Extended live matrix complete.');
} else if (command === 'failure') {
  const applicantRecord = state.users.find(user => user.name === 'applicant');
  const managerRecord = state.users.find(user => user.name === 'manager');
  const applicant = await login(applicantRecord.username, state.password);
  const manager = await login(managerRecord.username, state.password);
  await policy('system:user:list', 'manager');
  const definition = (await call(applicant, 'GET', '/api/workflows/definitions/published')).data.find(item => item.customForm?.businessType === 'identity.access_request');
  const input = { requestType: 'temporary', roleSelections: [], permissionCodes: ['system:user:list'], reason: state.prefix + ' 发放故障恢复验收', startMode: 'immediate', validityMode: 'limited', expiresAt: at(7200000) };
  const preview = (await call(applicant, 'POST', '/api/access-governance/workflow-preview', input)).data;
  if (preview.status !== 'ready') throw new Error(preview.message);
  const instance = (await call(applicant, 'POST', '/api/workflows/instances', { definitionId: definition.id, title: state.prefix + ' 发放故障恢复验收', formData: { ...input, previewFingerprint: preview.fingerprint } })).data;
  state.instances.push(instance.id); persist();
  const result = (await call(applicant, 'GET', '/api/access-governance/workflow/' + instance.id + '/result')).data;
  const requestId = Number(result.request.id);
  const sql = await localDatabase();
  try {
    await sql.unsafe(`CREATE FUNCTION qa_access_failure_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id = ${requestId} THEN RAISE EXCEPTION 'QA scoped transient grant write failure'; END IF; RETURN NEW; END $$`);
    await sql.unsafe('CREATE TRIGGER qa_access_failure_grant BEFORE INSERT ON identity_access_grants FOR EACH ROW EXECUTE FUNCTION qa_access_failure_grant()');
    await sql.unsafe(`CREATE FUNCTION qa_access_failure_attempts() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_type = 'identity-access-grant-apply' AND NEW.payload->>'requestId' = '${requestId}' THEN NEW.max_attempts := 1; END IF; RETURN NEW; END $$`);
    await sql.unsafe('CREATE TRIGGER qa_access_failure_attempts BEFORE INSERT ON async_tasks FOR EACH ROW EXECUTE FUNCTION qa_access_failure_attempts()');
    const detail = (await call(applicant, 'GET', '/api/workflows/instances/' + instance.id)).data;
    const task = detail.tasks.find(item => item.status === 'pending');
    if (task.assigneeId !== managerRecord.id) throw new Error('Unexpected failure-fixture approver');
    await call(manager, 'POST', '/api/workflows/tasks/' + task.id + '/approve', { comment: '验收数据库瞬态故障恢复' });
    let failed;
    for (let i = 0; i < 35; i++) { failed = (await call(applicant, 'GET', '/api/access-governance/workflow/' + instance.id + '/result')).data; if (failed.request.provisionStatus === 'failed') break; await new Promise(resolve => setTimeout(resolve, 500)); }
    check(failed.request.provisionStatus === 'failed' && !failed.grant, 'real worker failure remains visible without an issued grant');
    check(!failed.request.failureReason.includes('Failed query:') && failed.request.failureReason.includes('任务 #'), 'applicant failure summary references the governed task without exposing database diagnostics');
    state.failure = { instanceId: instance.id, requestId }; persist();
    check((await call(applicant, 'POST', '/api/access-governance/requests/' + requestId + '/retry', {}, [403])).status === 403, 'applicant cannot retry governance issuance');
    console.log(JSON.stringify(state.failure));
  } finally {
    await sql.unsafe('DROP TRIGGER IF EXISTS qa_access_failure_grant ON identity_access_grants');
    await sql.unsafe('DROP TRIGGER IF EXISTS qa_access_failure_attempts ON async_tasks');
    await sql.unsafe('DROP FUNCTION IF EXISTS qa_access_failure_grant()');
    await sql.unsafe('DROP FUNCTION IF EXISTS qa_access_failure_attempts()');
    await sql.end();
  }
} else if (command === 'cleanup') {
  const applicantRecord = state.users.find(user => user.name === 'applicant');
  const applicant = await login(applicantRecord.username, state.password);
  for (const id of state.instances) {
    const instance = (await call(admin, 'GET', '/api/workflows/instances/' + id)).data;
    if (instance.status === 'running') await call(applicant, 'POST', '/api/workflows/instances/' + id + '/withdraw');
    if (instance.bizType !== 'identity.access_request') continue;
    const result = (await call(admin, 'GET', '/api/access-governance/workflow/' + id + '/result')).data;
    if (result.grant && ['active', 'scheduled'].includes(result.grant.status)) await call(admin, 'POST', '/api/access-governance/grants/' + result.grant.id + '/revoke', { reason: '验收结束回收全部测试权限' });
  }
  for (const [code, original] of Object.entries(state.originalPolicies ?? {})) await call(admin, 'PUT', '/api/access-governance/policies/' + encodeURIComponent(code), { riskLevel: original.riskLevel, approvalPolicy: original.approvalPolicy, mfaRequired: original.mfaRequired, maxDurationMinutes: original.maxDurationMinutes ?? null, reviewIntervalDays: original.reviewIntervalDays, enabled: original.enabled, permanentAllowed: original.permanentAllowed, emergencyAllowed: original.emergencyAllowed, maxEmergencyMinutes: original.maxEmergencyMinutes });
  // Retain immutable workflow/approval evidence; disable fixture identities instead of deleting it.
  await call(admin, 'PUT', '/api/users/batch-status', { ids: state.users.map(user => user.id), status: 'disabled' });
  for (const id of state.roles) await call(admin, 'PUT', '/api/roles/' + id, { status: 'disabled' });
  state.cleaned = true; persist(); console.log('Fixture accounts disabled, active grants revoked, and original effective policies restored. Audit records retained.');
} else throw new Error('Use setup, run, extended, failure, or cleanup');
