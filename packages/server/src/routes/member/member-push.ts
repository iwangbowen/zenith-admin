/**
 * 会员端推送设备绑定（/api/member/push/devices，memberAuthMiddleware 鉴权）。
 * 与管理端 routes/ops/push-devices.ts 共用设备中心服务，主体固定为 member。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { memberPushContract } from '@zenith/shared/member';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { currentMemberId } from '../../lib/member-context';
import { bindPushDevice, unbindPushDevice } from '../../services/ops/client-devices.service';

const memberPush = new OpenAPIHono({ defaultHook: validationHook });

const member = [memberAuthMiddleware] as const;

const bindRoute = defineContractRoute(memberPushContract.bind, {
  middleware: member,
  handler: async (c) => {
    const device = await bindPushDevice('member', currentMemberId(), c.req.valid('json'));
    return c.json(okBody(device, '绑定成功'), 200);
  },
});

const unbindRoute = defineContractRoute(memberPushContract.unbind, {
  middleware: member,
  handler: async (c) => {
    await unbindPushDevice('member', currentMemberId(), c.req.valid('param').deviceId);
    return c.json(okBody(null, '解绑成功'), 200);
  },
});

memberPush.openapiRoutes([bindRoute, unbindRoute] as const);

export default memberPush;
