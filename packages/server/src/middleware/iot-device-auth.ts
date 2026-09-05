/**
 * IoT 设备侧接入鉴权。
 *
 * 一机一密 HMAC 签名基于原始请求体文本，因此在契约校验器解析 JSON 之前先读取并缓存原文：
 * Hono 按首次读取的形态缓存 body，后续校验器的 `c.req.json()` 从同一份文本派生，不会重复消费请求流。
 */
import type { MiddlewareHandler } from 'hono';
import { IOT_SIGN_HEADER, IOT_SN_HEADER, IOT_TIMESTAMP_HEADER } from '@zenith/shared/iot';
import type { IotDeviceRow } from '../db/schema';
import { authenticateDevice } from '../services/iot/iot-access.service';

declare module 'hono' {
  interface ContextVariableMap {
    /** 验签通过的设备行 */
    iotDevice: IotDeviceRow;
    /** 原始请求体文本（签名载荷） */
    iotRawBody: string;
  }
}

/** 读取并缓存原始请求体（签名载荷），供处理器内的验签复用 */
export const captureIotRawBody: MiddlewareHandler = async (c, next) => {
  c.set('iotRawBody', await c.req.text());
  await next();
};

/** 请求头签名鉴权（X-IoT-Sn / X-IoT-Timestamp / X-IoT-Sign）：缺头或验签失败 401，设备禁用 403 */
export const iotDeviceHeaderAuth: MiddlewareHandler = async (c, next) => {
  const rawBody = await c.req.text();
  c.set('iotRawBody', rawBody);
  c.set('iotDevice', await authenticateDevice(
    c.req.header(IOT_SN_HEADER),
    c.req.header(IOT_TIMESTAMP_HEADER),
    c.req.header(IOT_SIGN_HEADER),
    rawBody,
  ));
  await next();
};

/** 查询串签名鉴权（sn / ts / sign，对空串签名）：固件下载等 GET 场景 */
export const iotDeviceQueryAuth: MiddlewareHandler = async (c, next) => {
  c.set('iotDevice', await authenticateDevice(c.req.query('sn'), c.req.query('ts'), c.req.query('sign'), ''));
  await next();
};
