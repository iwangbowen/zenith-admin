/**
 * IoT 开放 API。
 *
 * 面向第三方应用的设备查询与控制通道：对外以 SN 寻址，不暴露内部 id 与密钥。
 * 鉴权链（签名 → 计量 → 限流）由 open-gateway 挂载，本模块只做 scope 校验与业务编排。
 *   - iot:read  设备列表 / 详情（含影子）
 *   - iot:write 服务调用指令 / 期望属性下发
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { openIotContract } from '@zenith/shared/iot';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { requireOpenScope } from '../../middleware/open-gateway';
import {
  findOpenIotDeviceBySn, getOpenIotDeviceDetail, listOpenIotDevices,
} from '../../services/iot/iot-open.service';
import type { IotDeviceRow } from '../../db/schema';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 各端点所需 scope；同时供端点目录展示 */
const OPEN_IOT_SCOPES = {
  devices: 'iot:read',
  deviceDetail: 'iot:read',
  sendCommand: 'iot:write',
  setDesired: 'iot:write',
} as const satisfies Record<Exclude<keyof typeof openIotContract, 'basePath'>, string>;

const deviceNotFound = { 404: { content: jsonContent(ErrorResponse), description: '设备不存在' } } as const;

async function requireDevice(sn: string): Promise<IotDeviceRow> {
  const device = await findOpenIotDeviceBySn(sn);
  if (!device) throw new HTTPException(404, { message: `设备「${sn}」不存在` });
  return device;
}

// ─── 设备查询（iot:read）─────────────────────────────────────────────────────

const listDevicesRoute = defineContractRoute(openIotContract.devices, {
  middleware: [requireOpenScope(OPEN_IOT_SCOPES.devices)],
  handler: async (c) => c.json(okBody(await listOpenIotDevices(c.req.valid('query'))), 200),
});

const getDeviceRoute = defineContractRoute(openIotContract.deviceDetail, {
  middleware: [requireOpenScope(OPEN_IOT_SCOPES.deviceDetail)],
  responses: deviceNotFound,
  handler: async (c) => {
    const device = await requireDevice(c.req.valid('param').sn);
    return c.json(okBody(await getOpenIotDeviceDetail(device)), 200);
  },
});

// ─── 设备控制（iot:write）────────────────────────────────────────────────────

const sendCommandRoute = defineContractRoute(openIotContract.sendCommand, {
  middleware: [requireOpenScope(OPEN_IOT_SCOPES.sendCommand)],
  responses: deviceNotFound,
  handler: async (c) => {
    const device = await requireDevice(c.req.valid('param').sn);
    const { sendIotCommandToDevice } = await import('../../services/iot/iot-telemetry.service');
    const cmd = await sendIotCommandToDevice(device, c.req.valid('json'));
    return c.json(okBody({
      commandId: cmd.id, service: cmd.service, status: cmd.status, expireAt: cmd.expireAt,
    }, '指令已受理'), 200);
  },
});

const setDesiredRoute = defineContractRoute(openIotContract.setDesired, {
  middleware: [requireOpenScope(OPEN_IOT_SCOPES.setDesired)],
  responses: deviceNotFound,
  handler: async (c) => {
    const device = await requireDevice(c.req.valid('param').sn);
    const { setIotDesiredForDevice } = await import('../../services/iot/iot-shadow.service');
    const shadow = await setIotDesiredForDevice(device, c.req.valid('json'));
    return c.json(okBody({
      reported: shadow.reported, desired: shadow.desired, desiredVersion: shadow.desiredVersion,
      reportedAt: shadow.reportedAt, desiredAt: shadow.desiredAt,
    }, '期望属性已写入'), 200);
  },
});

router.openapiRoutes([
  listDevicesRoute,
  getDeviceRoute,
  sendCommandRoute,
  setDesiredRoute,
] as const);

export default router;

/** IoT 开放端点目录：由契约与 scope 表派生，供 API 调试台列出可调端点 */
export const OPEN_IOT_ENDPOINTS: Array<{ method: string; path: string; summary: string; scope: string | null }> =
  (Object.keys(OPEN_IOT_SCOPES) as Array<keyof typeof OPEN_IOT_SCOPES>).map((name) => {
    const operation = openIotContract[name];
    return { method: operation.method.toUpperCase(), path: operation.fullPath, summary: operation.summary, scope: OPEN_IOT_SCOPES[name] };
  });
