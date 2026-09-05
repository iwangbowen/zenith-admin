/**
 * 设备推送绑定（管理端 App 调用，登录态即可，无需权限点）。
 *
 * 管理端 App：`pushDeviceContract`（authMiddleware，绑定到 user 主体）
 * 会员端 App：`memberPushContract`（memberAuthMiddleware，绑定到 member 主体，见 member 域挂载）
 * 两端共用设备中心服务，只是主体解析不同。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { pushDeviceContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { currentUser } from '../../lib/context';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { bindPushDevice, unbindPushDevice } from '../../services/ops/client-devices.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const bindRoute = defineContractRoute(pushDeviceContract.bind, {
  middleware: [authMiddleware],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '应用不存在' } },
  handler: async (c) => {
    const device = await bindPushDevice('user', currentUser().userId, c.req.valid('json'));
    return c.json(okBody(device, '绑定成功'), 200);
  },
});

const unbindRoute = defineContractRoute(pushDeviceContract.unbind, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { deviceId } = c.req.valid('param');
    await unbindPushDevice('user', currentUser().userId, deviceId);
    return c.json(okBody(null, '解绑成功'), 200);
  },
});

router.openapiRoutes([bindRoute, unbindRoute] as const);

export const adminPushDevicesRouter = router;
