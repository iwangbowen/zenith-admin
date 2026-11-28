import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { accessPlatformOnly } from '@zenith/shared/core';
import { createIotDeviceSchema } from '@zenith/shared/iot';
import { channelContract, channelCsContract, channelDashboardContract, channelMessageContract } from '@zenith/shared/messaging';
import type { JwtPayload } from '../middleware/auth';

const connection = process.env.TENANT_ISOLATION_TEST_DATABASE_URL;

describe.runIf(Boolean(connection))('tenant isolation on PostgreSQL', () => {
  const label = `tenant-review-${randomUUID().slice(0, 8)}`;
  let database: typeof import('../db');
  let schema: typeof import('../db/schema');
  let asUser: typeof import('../lib/context').runWithCurrentUser;
  let tenantA: number;
  let tenantB: number;
  let admin: JwtPayload;
  let a: JwtPayload;
  let aPeer: JwtPayload;
  let b: JwtPayload;
  const paymentIds: number[] = [];
  const accountIds: number[] = [];
  const channelIds: number[] = [];
  const roleIds: number[] = [];

  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_tenant_review') {
      throw new Error('Requires a disposable local migrated zenith_tenant_review database');
    }
    vi.stubEnv('DATABASE_URL', connection!);
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    vi.stubEnv('PAYMENT_ENGINE_MODE', 'sandbox');
    database = await import('../db');
    schema = await import('../db/schema');
    asUser = (await import('../lib/context')).runWithCurrentUser;
    (await import('../bootstrap/workflow-business-adapters')).registerWorkflowIntegrations();
    const [first, second] = await database.db.insert(schema.tenants).values([
      { name: 'Tenant A', code: `${label}-a` }, { name: 'Tenant B', code: `${label}-b` },
    ]).returning();
    tenantA = first.id;
    tenantB = second.id;
    async function user(suffix: string, tenantId: number | null, roles: string[] = []): Promise<JwtPayload> {
      const username = `${label}-${suffix}`;
      const [row] = await database.db.insert(schema.users).values({ username, nickname: suffix, password: 'test-only', tenantId }).returning();
      return { userId: row.id, username, tenantId, roles };
    }
    [admin, a, aPeer, b] = await Promise.all([
      user('platform', null, ['super_admin']), user('alice', tenantA), user('anna', tenantA), user('bob', tenantB),
    ]);
    const [platformRole] = await database.db.insert(schema.roles).values({ code: 'super_admin', name: label }).returning();
    roleIds.push(platformRole.id);
    await database.db.insert(schema.userRoles).values({ userId: admin.userId, roleId: platformRole.id });
  }, 60_000);

  afterAll(async () => {
    if (!database || !schema) return;
    const { db } = database;
    const tenantIds = [tenantA, tenantB].filter(Boolean);
    try {
      if (paymentIds.length) await db.delete(schema.paymentChannelConfigs).where(inArray(schema.paymentChannelConfigs.id, paymentIds));
      if (accountIds.length) await db.delete(schema.paymentChannelAccounts).where(inArray(schema.paymentChannelAccounts.id, accountIds));
      if (channelIds.length) await db.delete(schema.channels).where(inArray(schema.channels.id, channelIds));
      if (tenantIds.length) {
        await db.delete(schema.workflowInstances).where(inArray(schema.workflowInstances.tenantId, tenantIds));
        await db.delete(schema.iotDevices).where(inArray(schema.iotDevices.tenantId, tenantIds));
        await db.delete(schema.tenants).where(inArray(schema.tenants.id, tenantIds));
      }
      if (admin) await db.delete(schema.users).where(eq(schema.users.id, admin.userId));
      if (roleIds.length) await db.delete(schema.roles).where(inArray(schema.roles.id, roleIds));
    } finally {
      await database.closeDb();
      vi.unstubAllEnvs();
    }
  });

  it('limits chat contacts, group invites, and ownership to the account tenant', async () => {
    const { getOrCreateDirectConversation } = await import('./chat/chat-conversations.service');
    const { listChatUsers } = await import('./chat/chat-directory.service');
    const { createGroupConversation, addGroupMember, removeGroupMember, transferGroupOwnership } = await import('./chat/chat-groups.service');
    const { getOrCreateInvite, getInviteInfo, joinByInvite } = await import('./chat/chat-invites.service');
    expect((await asUser(a, () => listChatUsers())).map(row => row.id)).toEqual([aPeer.userId]);
    await expect(asUser(a, () => getOrCreateDirectConversation(aPeer.userId))).resolves.toMatchObject({ targetUser: { id: aPeer.userId } });
    await expect(asUser(a, () => getOrCreateDirectConversation(b.userId))).rejects.toMatchObject({ status: 404 });
    const group = await asUser(a, () => createGroupConversation(label));
    const invite = await asUser(a, () => getOrCreateInvite(group.id));
    await expect(asUser(b, () => getInviteInfo(invite.token))).rejects.toMatchObject({ status: 404 });
    await expect(asUser(b, () => joinByInvite(invite.token))).rejects.toMatchObject({ status: 404 });
    await expect(asUser(a, () => addGroupMember(group.id, b.userId))).rejects.toMatchObject({ status: 404 });
    await expect(asUser(aPeer, () => joinByInvite(invite.token))).resolves.toEqual({ joined: true });
    await database.db.insert(schema.chatConversationMembers).values({ conversationId: group.id, userId: b.userId });
    await expect(asUser(a, () => transferGroupOwnership(group.id, b.userId))).rejects.toMatchObject({ status: 404 });
    await asUser(a, () => removeGroupMember(group.id, b.userId));
    await asUser(a, () => transferGroupOwnership(group.id, aPeer.userId));
    await expect(asUser(aPeer, () => getOrCreateInvite(group.id))).resolves.toMatchObject({ usedCount: 1 });
  });

  it('keeps roles, drive subjects, and starter departments inside the owning tenant', async () => {
    const { getUserRoles } = await import('./identity/auth.service');
    const { loadDriveSubjectsForUser } = await import('./drive/drive-access.service');
    const { buildStarterContext, resolveAssigneeIds } = await import('./workflow/workflow-assignee-resolver.service');
    const [ownRole, foreignRole] = await database.db.insert(schema.roles).values([
      { code: label, name: label, tenantId: tenantA }, { code: label, name: label, tenantId: tenantB },
    ]).returning();
    const [department] = await database.db.insert(schema.departments).values({ code: label, name: label, tenantId: tenantA, leaderId: aPeer.userId }).returning();
    await database.db.update(schema.users).set({ departmentId: department.id }).where(eq(schema.users.id, a.userId));
    await database.db.insert(schema.userRoles).values([
      { userId: a.userId, roleId: ownRole.id }, { userId: a.userId, roleId: foreignRole.id },
    ]);
    expect((await getUserRoles(a.userId, tenantA)).map(role => role.id)).toEqual([ownRole.id]);
    await expect(getUserRoles(a.userId, tenantB)).resolves.toEqual([]);
    await expect(loadDriveSubjectsForUser(a.userId, tenantA)).resolves.toMatchObject({ departmentId: department.id, role: new Set([ownRole.id]) });
    await expect(loadDriveSubjectsForUser(a.userId, tenantB)).resolves.toMatchObject({ userId: 0 });
    await expect(loadDriveSubjectsForUser(admin.userId, tenantA)).resolves.toMatchObject({ isAdmin: true });
    await expect(buildStarterContext(a.userId, tenantA)).resolves.toMatchObject({ deptIds: [department.id], roleIds: [ownRole.id] });
    await expect(buildStarterContext(a.userId, tenantB)).resolves.toMatchObject({ deptIds: [], roleIds: [] });
    const node = { key: 'lead', type: 'approve', label: 'Lead', assigneeType: 'initiatorLeader' } as const;
    await expect(resolveAssigneeIds(node, { initiatorId: a.userId, tenantId: tenantA })).resolves.toEqual([aPeer.userId]);
    await expect(resolveAssigneeIds(node, { initiatorId: a.userId, tenantId: tenantB })).resolves.toEqual([]);
  });

  it('authorizes platform channel administration and lets each tenant subscribe', async () => {
    const { signToken } = await import('../lib/jwt');
    const { default: channelRoutes } = await import('../routes/messaging/channels');
    const { exportChannelSubscribers } = await import('./messaging/channel.service');
    const app = new Hono();
    app.use('*', contextStorage());
    app.route(channelContract.basePath, channelRoutes);
    const [global, foreign] = await database.db.insert(schema.channels).values([
      { code: label, name: label, type: 'business' },
      { code: `${label}-foreign`, name: label, type: 'business', tenantId: tenantB },
    ]).returning();
    channelIds.push(global.id, foreign.id);
    const tenantAuth = { Authorization: `Bearer ${await signToken(a, '10m')}` };
    const secondTenantAuth = { Authorization: `Bearer ${await signToken(b, '10m')}` };
    const platformAuth = { Authorization: `Bearer ${await signToken(admin, '10m')}` };
    const adminUrl = '/api/channels/admin';
    expect((await app.request(adminUrl, { headers: tenantAuth })).status).toBe(403);
    expect((await app.request(adminUrl, { headers: platformAuth })).status).toBe(200);
    const subscribe = (id: number, headers = tenantAuth) => app.request(`/api/channels/${id}/subscribe`, { method: 'POST', headers });
    expect((await subscribe(global.id)).status).toBe(200);
    expect((await subscribe(global.id, secondTenantAuth)).status).toBe(200);
    expect((await subscribe(foreign.id)).status).toBe(404);
    const subscribers = await app.request(`/api/channels/admin/${global.id}/subscribers?keyword=${a.username}`, { headers: platformAuth });
    expect(subscribers.status).toBe(200);
    expect(await subscribers.json()).toMatchObject({ data: { total: 1, list: [{ userId: a.userId }] } });
    await expect(asUser(a, () => exportChannelSubscribers(global.id))).rejects.toMatchObject({ status: 403 });
    await expect(asUser(admin, () => exportChannelSubscribers(global.id, a.username))).resolves.toMatchObject([{ userId: a.userId }]);
    expect((await app.request('/api/channels/cs/channels', { headers: tenantAuth })).status).toBe(403);
    expect((await app.request('/api/channels/cs/channels', { headers: platformAuth })).status).toBe(200);
    for (const operation of [channelContract.addSubscribers, channelMessageContract.testSend, channelCsContract.assign, channelDashboardContract.dashboard]) {
      expect(accessPlatformOnly(operation.access)).toBe('multi-tenant');
    }
  });

  it('pins identity provider discovery, login state, and directory reads to the tenant', async () => {
    const { discoverEnterpriseIdentityProviders, generateEnterpriseAuthUrl, getUsableDirectoryProvider, handleEnterpriseOidcCallback } = await import('./identity/identity-providers.service');
    const { default: redis } = await import('../lib/redis');
    const [oidc, ldap] = await database.db.insert(schema.tenantIdentityProviders).values([
      { name: label, code: label, type: 'oidc', status: 'enabled', tenantId: tenantA, authorizationEndpoint: 'https://identity.test/authorize', clientId: label },
      { name: label, code: `${label}-ldap`, type: 'ldap', status: 'enabled', tenantId: tenantB, ldapUrl: 'ldaps://directory.test', ldapBaseDn: 'dc=test' },
    ]).returning();
    const client = { ip: '127.0.0.1', ua: 'test' };
    expect((await discoverEnterpriseIdentityProviders(`${label}-a`)).providers.map(provider => provider.id)).toEqual([oidc.id]);
    const started = await generateEnterpriseAuthUrl(oidc.id, { ...client, tenantCode: `${label}-a` });
    expect(new URL(started.authUrl).searchParams.get('state')).toBe(started.state);
    const stored = vi.mocked(redis.set).mock.calls.find(([key]) => String(key).endsWith(started.state));
    const payload = String(stored?.[1]);
    expect(JSON.parse(payload)).toMatchObject({ providerId: oidc.id, tenantId: tenantA });
    await expect(generateEnterpriseAuthUrl(oidc.id, { ...client, tenantCode: `${label}-b` })).rejects.toMatchObject({ status: 404 });
    await expect(generateEnterpriseAuthUrl(oidc.id, client)).rejects.toMatchObject({ status: 404 });
    await expect(getUsableDirectoryProvider(ldap.id, tenantA)).rejects.toMatchObject({ status: 404 });
    await expect(getUsableDirectoryProvider(ldap.id, tenantB)).resolves.toMatchObject({ id: ldap.id });
    await database.db.update(schema.tenantIdentityProviders).set({ tenantId: tenantB }).where(eq(schema.tenantIdentityProviders.id, oidc.id));
    vi.mocked(redis.get).mockResolvedValueOnce(payload);
    await expect(handleEnterpriseOidcCallback('unused', started.state)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps device group changes atomic and checks products in the current view', async () => {
    const { getThingModel } = await import('./iot/iot-model.service');
    const { createIotDevice, updateIotDevice } = await import('./iot/iot-devices.service');
    const { updateIotDeviceGroup } = await import('./iot/iot-groups.service');
    const [own, foreign] = await database.db.insert(schema.iotProducts).values([
      { name: label, tenantId: tenantA }, { name: label, tenantId: tenantB },
    ]).returning();
    const [groupA, groupB] = await database.db.insert(schema.iotDeviceGroups).values([
      { name: label, tenantId: tenantA }, { name: label, tenantId: tenantB },
    ]).returning();
    await expect(asUser(a, () => getThingModel(own.id))).resolves.toMatchObject({ properties: [] });
    await expect(asUser(a, () => getThingModel(foreign.id))).rejects.toMatchObject({ status: 404 });
    const input = createIotDeviceSchema.parse({ name: label, productId: own.id, groupIds: [groupA.id] });
    const device = await asUser(a, () => createIotDevice(input));
    await expect(asUser(admin, () => updateIotDevice(device.id, { name: 'rejected', groupIds: [groupB.id] }))).rejects.toMatchObject({ status: 400 });
    await expect(asUser(admin, () => updateIotDeviceGroup(groupB.id, { deviceIds: [device.id] }))).rejects.toMatchObject({ status: 400 });
    expect((await database.db.query.iotDevices.findFirst({ where: eq(schema.iotDevices.id, device.id) }))?.name).toBe(label);
    const groups = await database.db.select().from(schema.iotDeviceGroupMembers).where(eq(schema.iotDeviceGroupMembers.deviceId, device.id));
    expect(groups).toEqual([{ deviceId: device.id, groupId: groupA.id }]);
    await expect(asUser(a, () => updateIotDevice(device.id, { groupIds: [] }))).resolves.toMatchObject({ groupIds: [] });
  });

  it('binds fan tags and payment configurations to their business owner', async () => {
    const { updateMpFan } = await import('./mp/mp-fan.service');
    const { resolvePaymentChannelConfig } = await import('./payment/payment-channel-config-resolver');
    const [account] = await database.db.insert(schema.mpAccounts).values({ appId: label, name: label, tenantId: tenantA }).returning();
    const [fan] = await database.db.insert(schema.mpFans).values({ accountId: account.id, openid: label, tenantId: tenantA }).returning();
    const [valid, invalid] = await database.db.insert(schema.mpTags).values([
      { accountId: account.id, name: 'Valid', tenantId: tenantA }, { accountId: account.id, name: 'Invalid', tenantId: tenantB },
    ]).returning();
    await expect(asUser(a, () => updateMpFan(fan.id, { tagIds: [valid.id] }))).resolves.toMatchObject({ tagIds: [valid.id] });
    await expect(asUser(admin, () => updateMpFan(fan.id, { tagIds: [invalid.id] }))).rejects.toMatchObject({ status: 400 });

    const [paymentAccount] = await database.db.insert(schema.paymentChannelAccounts).values({
      name: label, merchantId: label, channel: 'alipay', environment: 'sandbox', tenantId: tenantA,
    }).returning();
    accountIds.push(paymentAccount.id);
    const [merchant] = await database.db.insert(schema.paymentChannelConfigs).values({
      channelAccountId: paymentAccount.id, name: label, channel: 'alipay', callbackToken: label,
      sandboxNotifySecretEncrypted: 'test-only', sandbox: true, isDefault: true, tenantId: tenantA,
    }).returning();
    paymentIds.push(merchant.id);
    await expect(resolvePaymentChannelConfig({ channel: 'alipay', tenantId: tenantA })).resolves.toMatchObject({ id: merchant.id });
    await expect(resolvePaymentChannelConfig({ channel: 'alipay', tenantId: tenantB, channelConfigId: merchant.id })).rejects.toMatchObject({ status: 404 });
    await expect(resolvePaymentChannelConfig({ channel: 'wechat', tenantId: tenantA, channelConfigId: merchant.id })).rejects.toMatchObject({ status: 404 });
  });

  it('keeps leave links, workflow versions, form snapshots, and comment references in scope', async () => {
    const { submitBizLeave } = await import('./biz-demo/biz-leave.service');
    const { resolveFormSnapshot } = await import('./workflow/workflow-forms.service');
    const { restoreVersion } = await import('./workflow/workflow-definitions.service');
    const { addInstanceComment } = await import('./workflow/workflow-comments.service');
    const [form] = await database.db.insert(schema.workflowForms).values({ name: label, tenantId: tenantA }).returning();
    const [definition] = await database.db.insert(schema.workflowDefinitions).values({ name: label, formId: form.id, tenantId: tenantA }).returning();
    const [ownVersion, foreignVersion] = await database.db.insert(schema.workflowDefinitionVersions).values([
      { definitionId: definition.id, name: label, version: 1, formId: form.id, tenantId: tenantA },
      { definitionId: definition.id, name: label, version: 2, tenantId: tenantB },
    ]).returning();
    await expect(resolveFormSnapshot(form.id, tenantA)).resolves.toMatchObject({ name: label });
    await expect(resolveFormSnapshot(form.id, tenantB)).resolves.toBeNull();
    await expect(asUser(admin, () => restoreVersion(definition.id, foreignVersion.id))).rejects.toMatchObject({ status: 404 });
    await expect(asUser(a, () => restoreVersion(definition.id, ownVersion.id))).resolves.toMatchObject({ formId: form.id });

    const [leave] = await asUser(a, () => database.db.insert(schema.bizLeaves).values({
      leaveType: 'annual', startDate: new Date(), endDate: new Date(), status: 'pending', tenantId: tenantA,
    }).returning());
    const [foreign] = await database.db.insert(schema.workflowInstances).values({
      title: label, definitionId: definition.id, definitionSnapshot: { id: definition.id, name: label, version: 1, flowData: { nodes: [], edges: [] } },
      initiatorId: b.userId, tenantId: tenantB, status: 'running', bizType: 'biz_leave', bizId: String(leave.id),
    }).returning();
    await expect(asUser(a, () => submitBizLeave(leave.id))).rejects.toMatchObject({ status: 400 });
    const [instance] = await database.db.insert(schema.workflowInstances).values({
      title: label, definitionId: definition.id, definitionSnapshot: foreign.definitionSnapshot, initiatorId: a.userId,
      tenantId: tenantA, status: 'running', bizType: 'biz_leave', bizId: String(leave.id),
    }).returning();
    await expect(asUser(a, () => submitBizLeave(leave.id))).resolves.toMatchObject({ workflowInstanceId: instance.id });
    await expect(asUser(b, () => submitBizLeave(leave.id))).rejects.toMatchObject({ status: 404 });
    const [foreignComment] = await database.db.insert(schema.workflowComments).values({
      instanceId: instance.id, userId: b.userId, content: 'Foreign', tenantId: tenantB,
    }).returning();
    await expect(asUser(a, () => addInstanceComment(instance.id, { content: 'Rejected', parentId: foreignComment.id }))).rejects.toMatchObject({ status: 400 });
    await expect(asUser(a, () => addInstanceComment(instance.id, { content: 'Rejected', mentions: [b.userId] }))).rejects.toMatchObject({ status: 400 });
    const parent = await asUser(a, () => addInstanceComment(instance.id, { content: 'Own comment' }));
    await expect(asUser(a, () => addInstanceComment(instance.id, { content: 'Own reply', parentId: parent.id }))).resolves.toMatchObject({ parentId: parent.id });
  });
});
