/**
 * IoT 设备批量导入 Definition。
 * SN 留空自动生成、密钥自动分配、产品按名称解析（重名拒绝）、分组按名称关联。
 */
import { eq } from 'drizzle-orm';
import { db } from '../../../db/index';
import { iotDeviceGroupMembers, iotDeviceGroups, iotDevices, iotDeviceState, iotProducts } from '../../../db/schema';
import { buildWhere } from '../../../lib/where-helpers';
import { tenantCondition, getCreateTenantId } from '../../../lib/tenant';
import { currentUser } from '../../../lib/context';
import { generateDeviceSn, generateDeviceSecret } from '../iot-access.service';
import { registerImport } from '../../../lib/import-center/registry';

interface DeviceRow {
  name: string;
  productId: number;
  sn: string;
  firmwareVersion: string | null;
  groupIds: number[];
  status: 'enabled' | 'disabled';
  remark: string | null;
}

interface Prepared {
  productByName: Map<string, number[]>;
  groupByName: Map<string, number>;
  snSet: Set<string>;
  tenantId: number | null;
}

export function registerIotDevicesImport(): void {
  registerImport<DeviceRow, Prepared>({
    entity: 'iot.devices',
    title: 'IoT 设备',
    module: 'IoT 设备',
    permission: 'iot:device:import',
    description: '批量注册设备：SN 留空自动生成，接入密钥自动分配，产品按名称解析、分组按名称关联',
    columns: [
      { key: 'name', header: '设备名称', required: true, example: '机房 C-01 温湿度' },
      { key: 'productName', header: '产品名称', required: true, example: '温湿度传感器 TH-100' },
      { key: 'sn', header: 'SN', example: '', note: '留空自动生成；4-64 位字母、数字或连字符' },
      { key: 'firmwareVersion', header: '固件版本', example: '1.0.0' },
      { key: 'groupNames', header: '分组名称', note: '多个用逗号分隔' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'], example: 'enabled' },
      { key: 'remark', header: '备注' },
    ],
    async prepare() {
      const user = currentUser();
      const [products, groups, existingSns] = await Promise.all([
        db.select({ id: iotProducts.id, name: iotProducts.name }).from(iotProducts)
          .where(buildWhere(eq(iotProducts.status, 'enabled'), tenantCondition(iotProducts, user))),
        db.select({ id: iotDeviceGroups.id, name: iotDeviceGroups.name }).from(iotDeviceGroups)
          .where(tenantCondition(iotDeviceGroups, user)),
        db.select({ sn: iotDevices.sn }).from(iotDevices),
      ]);
      const productByName = new Map<string, number[]>();
      for (const p of products) {
        productByName.set(p.name, [...(productByName.get(p.name) ?? []), p.id]);
      }
      return {
        productByName,
        groupByName: new Map(groups.map((g) => [g.name, g.id])),
        snSet: new Set(existingSns.map((r) => r.sn)),
        tenantId: getCreateTenantId(user),
      };
    },
    parseRow(cells, prepared) {
      if (!cells.name || !cells.productName) throw new Error('设备名称、产品名称为必填项');
      const productIds = prepared.productByName.get(cells.productName) ?? [];
      if (productIds.length === 0) throw new Error(`产品不存在或已禁用: ${cells.productName}`);
      if (productIds.length > 1) throw new Error(`产品名称不唯一: ${cells.productName}，请先规范产品命名`);
      if (cells.sn && !/^[0-9A-Za-z-]{4,64}$/.test(cells.sn)) throw new Error('SN 需为 4-64 位字母、数字或连字符');
      if (cells.sn && prepared.snSet.has(cells.sn)) throw new Error(`SN 已存在: ${cells.sn}`);
      let status: 'enabled' | 'disabled' = 'enabled';
      if (cells.status) {
        const normalized = cells.status.toLowerCase();
        if (normalized !== 'enabled' && normalized !== 'disabled') {
          throw new Error(`状态值无效: ${cells.status}（仅支持 enabled/disabled 或留空）`);
        }
        status = normalized;
      }
      const groupNames = cells.groupNames ? cells.groupNames.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
      const missingGroups = groupNames.filter((g) => !prepared.groupByName.has(g));
      if (missingGroups.length > 0) throw new Error(`分组不存在: ${missingGroups.join('、')}`);
      return {
        name: cells.name,
        productId: productIds[0],
        sn: cells.sn || generateDeviceSn(),
        firmwareVersion: cells.firmwareVersion || null,
        groupIds: groupNames.map((g) => prepared.groupByName.get(g)!),
        status,
        remark: cells.remark || null,
      };
    },
    async insertRow(row, prepared) {
      await db.transaction(async (tx) => {
        const [created] = await tx.insert(iotDevices).values({
          sn: row.sn,
          secret: generateDeviceSecret(),
          productId: row.productId,
          name: row.name,
          status: row.status,
          firmwareVersion: row.firmwareVersion,
          remark: row.remark,
          tenantId: prepared.tenantId,
        }).returning();
        await tx.insert(iotDeviceState).values({ deviceId: created.id });
        if (row.groupIds.length > 0) {
          await tx.insert(iotDeviceGroupMembers).values(row.groupIds.map((groupId) => ({ groupId, deviceId: created.id })));
        }
      });
      prepared.snSet.add(row.sn);
    },
    rowLabel: (row) => `${row.name}（${row.sn}）`,
  });
}
