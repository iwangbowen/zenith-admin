import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { firewallContract } from '@zenith/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import {
  addFirewallRule,
  deleteFirewallRule,
  getFirewallStatus,
  listFirewallRules,
  setFirewallEnabled,
} from '../../services/ops/firewall.service';
import { assertRemoteHostAccess } from '../../lib/host-access';

const firewallRouter = new OpenAPIHono({ defaultHook: validationHook });

function assertLocalFirewallWrite(hostId?: number): void {
  if (hostId != null) {
    throw new HTTPException(400, { message: '远端防火墙仅支持只读查看，禁止远程变更' });
  }
}

const view = [authMiddleware, guard({ permission: 'system:firewall:view' })] as const;

const statusRoute = defineContractRoute(firewallContract.status, {
  middleware: view,
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await getFirewallStatus(hostId)), 200);
  },
});

const listRulesRoute = defineContractRoute(firewallContract.rules, {
  middleware: view,
  handler: async (c) => {
    const { hostId } = c.req.valid('query');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await listFirewallRules(hostId)), 200);
  },
});

const addRuleRoute = defineContractRoute(firewallContract.addRule, {
  middleware: [authMiddleware, guard({ permission: 'system:firewall:manage', audit: { module: '系统运维', description: '添加防火墙规则' } })],
  handler: async (c) => {
    assertLocalFirewallWrite(c.req.valid('query').hostId);
    setAuditBeforeData(c, await listFirewallRules());
    await addFirewallRule(c.req.valid('json'));
    setAuditAfterData(c, await listFirewallRules());
    return c.json(okBody(null, '规则已添加'), 200);
  },
});

const deleteRuleRoute = defineContractRoute(firewallContract.removeRule, {
  middleware: [authMiddleware, guard({ permission: 'system:firewall:manage', audit: { module: '系统运维', description: '删除防火墙规则' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    assertLocalFirewallWrite(c.req.valid('query').hostId);
    setAuditBeforeData(c, await listFirewallRules());
    await deleteFirewallRule(id);
    setAuditAfterData(c, await listFirewallRules());
    return c.json(okBody(null, '规则已删除'), 200);
  },
});

const enableRoute = defineContractRoute(firewallContract.enable, {
  middleware: [authMiddleware, guard({ permission: 'system:firewall:manage', audit: { module: '系统运维', description: '启用防火墙' } })],
  handler: async (c) => {
    assertLocalFirewallWrite(c.req.valid('query').hostId);
    setAuditBeforeData(c, await getFirewallStatus());
    await setFirewallEnabled(true);
    setAuditAfterData(c, await getFirewallStatus());
    return c.json(okBody(null, '防火墙已启用'), 200);
  },
});

const disableRoute = defineContractRoute(firewallContract.disable, {
  middleware: [authMiddleware, guard({ permission: 'system:firewall:manage', audit: { module: '系统运维', description: '禁用防火墙' } })],
  handler: async (c) => {
    assertLocalFirewallWrite(c.req.valid('query').hostId);
    setAuditBeforeData(c, await getFirewallStatus());
    await setFirewallEnabled(false);
    setAuditAfterData(c, await getFirewallStatus());
    return c.json(okBody(null, '防火墙已关闭'), 200);
  },
});

firewallRouter.openapiRoutes([
  statusRoute,
  listRulesRoute,
  addRuleRoute,
  deleteRuleRoute,
  enableRoute,
  disableRoute,
] as const);

export default firewallRouter;
