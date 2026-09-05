import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentMethodContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listMethodConfigs, listEnabledMethodConfigs, getMethodConfig, updateMethodConfig } from '../../services/payment/payment-method.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(paymentMethodContract.list, {
  middleware: [authMiddleware, guard({ permission: 'payment:method:list' })],
  handler: async (c) => c.json(okBody(await listMethodConfigs()), 200),
});

const enabledRoute = defineContractRoute(paymentMethodContract.enabled, {
  middleware: [authMiddleware, guard({ permission: 'payment:order:create' })],
  handler: async (c) => c.json(okBody(await listEnabledMethodConfigs()), 200),
});

const detailRoute = defineContractRoute(paymentMethodContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'payment:method:list' })],
  handler: async (c) => c.json(okBody(await getMethodConfig(c.req.valid('param').id)), 200),
});

const updateRoute = defineContractRoute(paymentMethodContract.update, {
  middleware: [authMiddleware, guard({ permission: 'payment:method:update', audit: { description: '编辑支付方式配置', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMethodConfig(id));
    return c.json(okBody(await updateMethodConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

router.openapiRoutes([listRoute, enabledRoute, detailRoute, updateRoute] as const);

export default router;
