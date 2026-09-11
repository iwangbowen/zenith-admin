import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { iotDevices } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { loadThingModel } from './iot-model.service';

export interface IotRuleReferences {
  /** 规则引用的物模型成员：数值型属性（阈值 / 属性触发）、事件，或不引用（如设备离线类） */
  refKind: 'property' | 'event' | null;
  propertyIdentifier?: string | null;
  eventIdentifier?: string | null;
  /** 限定设备；给出时必须属于该产品 */
  deviceId?: number | null;
}

/**
 * 告警规则 / 联动规则共用的引用校验：限定设备需属于该产品；引用的属性 / 事件需在产品物模型中声明，
 * 属性类引用只允许数值型（`numericOnlyMessage` 由各规则给出自己的文案）。
 */
export async function ensureIotRuleReferencesValid(
  productId: number,
  refs: IotRuleReferences,
  messages: { numericOnly: string },
): Promise<void> {
  if (refs.deviceId) {
    const [maybeDevice] = await db.select({ id: iotDevices.id, productId: iotDevices.productId })
      .from(iotDevices).where(eq(iotDevices.id, refs.deviceId)).limit(1);
    const device = requireRow(maybeDevice, '指定的设备不存在', 400);
    if (device.productId !== productId) throw new HTTPException(400, { message: '设备不属于该产品' });
  }
  const model = await loadThingModel(productId);
  if (refs.refKind === 'property') {
    const maybeProp = model.properties.find((p) => p.identifier === refs.propertyIdentifier);
    const prop = requireRow(maybeProp, `属性 "${refs.propertyIdentifier}" 未在物模型中声明`, 400);
    if (prop.dataType !== 'number') throw new HTTPException(400, { message: messages.numericOnly });
  }
  if (refs.refKind === 'event' && !model.events.some((e) => e.identifier === refs.eventIdentifier)) {
    throw new HTTPException(400, { message: `事件 "${refs.eventIdentifier}" 未在物模型中声明` });
  }
}
