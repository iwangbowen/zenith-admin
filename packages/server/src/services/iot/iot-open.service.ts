import { openIotContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 开放 API 服务（开放平台网关侧）。
 *
 * 与管理端 service 的区别：调用主体是开放应用（无管理员用户上下文），
 * 因此不走 currentUser()/tenantCondition；对外以 SN 为设备寻址标识，
 * 不暴露内部 id、secret 与租户信息。
 */
import { count, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { iotDevices, iotDeviceState, iotProducts, type IotDeviceRow } from '../../db/schema';
import { formatNullableDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { getOnlineMap, isDeviceOnline } from './iot-access.service';

function mapOpenIotDevice(
  row: IotDeviceRow,
  extra: { productId: number; productName: string | null; online: boolean },
) {
  return {
    sn: row.sn,
    name: row.name,
    productId: extra.productId,
    productName: extra.productName,
    status: row.status,
    online: extra.online,
    firmwareVersion: row.firmwareVersion ?? null,
    activatedAt: formatNullableDateTime(row.activatedAt),
    lastSeenAt: formatNullableDateTime(row.lastSeenAt),
  };
}

export type ListOpenIotDevicesFilter = Omit<QueryOutputOf<typeof openIotContract.devices>, 'page' | 'pageSize'>;
export type ListOpenIotDevicesQuery = QueryOutputOf<typeof openIotContract.devices>;

export async function listOpenIotDevices(q: ListOpenIotDevicesQuery) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [iotDevices.sn, iotDevices.name], 'ilike'),
    q.productId ? eq(iotDevices.productId, q.productId) : undefined,
    q.status ? eq(iotDevices.status, q.status) : undefined,
  );
  const base = db.select({ device: iotDevices, productName: iotProducts.name })
    .from(iotDevices)
    .innerJoin(iotProducts, eq(iotDevices.productId, iotProducts.id));
  return buildListResult({
    page,
    pageSize,
    count: async () => {
      const [row] = await db.select({ value: count() }).from(iotDevices)
        .innerJoin(iotProducts, eq(iotDevices.productId, iotProducts.id))
        .where(where);
      return Number(row?.value ?? 0);
    },
    rows: async () => {
      const rows = await withPagination(base.where(where).orderBy(desc(iotDevices.id)).$dynamic(), page, pageSize);
      const onlineMap = await getOnlineMap(rows.map((r) => r.device.id));
      return rows.map((r) => mapOpenIotDevice(r.device, {
        productId: r.device.productId,
        productName: r.productName,
        online: onlineMap.get(r.device.id) ?? false,
      }));
    },
  });
}

/** 按 SN 查设备行（供指令/期望值下发做前置解析），不存在返回 null */
export async function findOpenIotDeviceBySn(sn: string): Promise<IotDeviceRow | null> {
  const [row] = await db.select().from(iotDevices).where(eq(iotDevices.sn, sn)).limit(1);
  return row ?? null;
}

/** 设备详情 + 影子（reported/desired） */
export async function getOpenIotDeviceDetail(device: IotDeviceRow) {
  const [[product], [state], online] = await Promise.all([
    db.select({ productName: iotProducts.name })
      .from(iotProducts).where(eq(iotProducts.id, device.productId)).limit(1),
    db.select().from(iotDeviceState).where(eq(iotDeviceState.deviceId, device.id)).limit(1),
    isDeviceOnline(device.id),
  ]);
  return {
    ...mapOpenIotDevice(device, {
      productId: device.productId,
      productName: product?.productName ?? null,
      online,
    }),
    shadow: {
      reported: state?.reported ?? {},
      desired: state?.desired ?? {},
      desiredVersion: state?.desiredVersion ?? 0,
      reportedAt: formatNullableDateTime(state?.reportedAt ?? null),
      desiredAt: formatNullableDateTime(state?.desiredAt ?? null),
    },
  };
}
