/**
 * IoT 物模型（TSL）：属性 / 服务 / 事件定义的 CRUD 与导入导出。
 *
 * 运行时（遥测校验、指令参数校验、影子 rw 判定、告警规则联想）通过
 * `loadThingModel()` 读取，内置 30s 进程内缓存，模型写操作即失效。
 */
import { HTTPException } from 'hono/http-exception';
import { asc, eq, and } from 'drizzle-orm';
import type {
  CreateIotEventInput, CreateIotPropertyInput, CreateIotServiceInput, ImportIotTslInput,
  UpdateIotEventInput, UpdateIotPropertyInput, UpdateIotServiceInput,
} from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotProductEvents, iotProductProperties, iotProducts, iotProductServices,
  type IotProductEventRow, type IotProductPropertyRow, type IotProductRow, type IotProductServiceRow,
} from '../../db/schema';
import { formatTimestamps } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { TtlCache } from '../../lib/ttl-cache';
import { invalidateAnomalyBaselines } from './iot-anomaly.service';

/** 轻量存在性校验（无租户条件；管理端路由的访问边界由 devices 服务的 ensureIotProductExists 把守） */
async function ensureProductRow(productId: number): Promise<void> {
  const [row] = await db.select({ id: iotProducts.id }).from(iotProducts)
    .where(eq(iotProducts.id, productId)).limit(1);
  requireRow(row, '产品不存在');
}

// ─── 映射 ─────────────────────────────────────────────────────────────────────
export function mapIotProperty(row: IotProductPropertyRow) {
  return {
    id: row.id,
    productId: row.productId,
    identifier: row.identifier,
    name: row.name,
    dataType: row.dataType,
    accessMode: row.accessMode,
    unit: row.unit ?? null,
    minValue: row.minValue ?? null,
    maxValue: row.maxValue ?? null,
    enumOptions: row.enumOptions ?? null,
    featured: row.featured,
    anomalyEnabled: row.anomalyEnabled,
    sort: row.sort,
    description: row.description ?? null,
    ...formatTimestamps(row),
  };
}

export function mapIotService(row: IotProductServiceRow) {
  return {
    id: row.id,
    productId: row.productId,
    identifier: row.identifier,
    name: row.name,
    params: row.params ?? [],
    danger: row.danger,
    sort: row.sort,
    description: row.description ?? null,
    ...formatTimestamps(row),
  };
}

export function mapIotEvent(row: IotProductEventRow) {
  return {
    id: row.id,
    productId: row.productId,
    identifier: row.identifier,
    name: row.name,
    level: row.level,
    params: row.params ?? [],
    sort: row.sort,
    description: row.description ?? null,
    ...formatTimestamps(row),
  };
}

// ─── 运行时模型缓存 ───────────────────────────────────────────────────────────
export interface ThingModelRuntime {
  properties: IotProductPropertyRow[];
  services: IotProductServiceRow[];
  events: IotProductEventRow[];
  /** 产品遥测校验模式（随模型一并缓存，接入热路径不再单独查产品表） */
  validationMode: IotProductRow['validationMode'];
}

const MODEL_CACHE_TTL_MS = 30_000;

/** 单飞 + 过期用旧值后台刷新：接入热路径上几百帧同时过期不会形成查库风暴 */
const modelCache = new TtlCache<number, ThingModelRuntime>(MODEL_CACHE_TTL_MS);

export function invalidateThingModelCache(productId: number): void {
  modelCache.delete(productId);
  invalidateAnomalyBaselines(productId);
}

/** 设备接入热路径使用：属性/服务/事件全量（带进程内 TTL 缓存） */
export function loadThingModel(productId: number): Promise<ThingModelRuntime> {
  return modelCache.get(productId, async () => {
    const [properties, services, events, product] = await Promise.all([
      db.select().from(iotProductProperties).where(eq(iotProductProperties.productId, productId))
        .orderBy(asc(iotProductProperties.sort), asc(iotProductProperties.id)),
      db.select().from(iotProductServices).where(eq(iotProductServices.productId, productId))
        .orderBy(asc(iotProductServices.sort), asc(iotProductServices.id)),
      db.select().from(iotProductEvents).where(eq(iotProductEvents.productId, productId))
        .orderBy(asc(iotProductEvents.sort), asc(iotProductEvents.id)),
      db.select({ validationMode: iotProducts.validationMode }).from(iotProducts)
        .where(eq(iotProducts.id, productId)).limit(1).then((rows) => rows[0]),
    ]);
    return { properties, services, events, validationMode: product?.validationMode ?? 'loose' };
  });
}

/** 管理端完整物模型视图（详情/导出共用） */
export async function getThingModel(productId: number) {
  await ensureProductRow(productId);
  const model = await loadThingModel(productId);
  return {
    properties: model.properties.map(mapIotProperty),
    services: model.services.map(mapIotService),
    events: model.events.map(mapIotEvent),
  };
}

// ─── 属性 CRUD ────────────────────────────────────────────────────────────────
export async function createIotProperty(productId: number, data: CreateIotPropertyInput) {
  await ensureProductRow(productId);
  try {
    const [row] = await db.insert(iotProductProperties).values({
      productId,
      identifier: data.identifier,
      name: data.name,
      dataType: data.dataType,
      accessMode: data.accessMode,
      unit: data.unit ?? null,
      minValue: data.minValue ?? null,
      maxValue: data.maxValue ?? null,
      enumOptions: data.enumOptions ?? null,
      featured: data.featured,
      anomalyEnabled: data.anomalyEnabled,
      sort: data.sort,
      description: data.description ?? null,
    }).returning();
    invalidateThingModelCache(productId);
    return mapIotProperty(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `属性标识符 "${data.identifier}" 已存在`);
    throw err;
  }
}

export async function ensureIotPropertyExists(productId: number, propertyId: number): Promise<IotProductPropertyRow> {
  const [row] = await db.select().from(iotProductProperties)
    .where(and(eq(iotProductProperties.id, propertyId), eq(iotProductProperties.productId, productId)))
    .limit(1);
  return requireRow(row, '属性不存在');
}

export async function updateIotProperty(productId: number, propertyId: number, data: UpdateIotPropertyInput) {
  await ensureIotPropertyExists(productId, propertyId);
  const [row] = await db.update(iotProductProperties).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.dataType !== undefined ? { dataType: data.dataType } : {}),
    ...(data.accessMode !== undefined ? { accessMode: data.accessMode } : {}),
    ...(data.unit !== undefined ? { unit: data.unit } : {}),
    ...(data.minValue !== undefined ? { minValue: data.minValue } : {}),
    ...(data.maxValue !== undefined ? { maxValue: data.maxValue } : {}),
    ...(data.enumOptions !== undefined ? { enumOptions: data.enumOptions } : {}),
    ...(data.featured !== undefined ? { featured: data.featured } : {}),
    ...(data.anomalyEnabled !== undefined ? { anomalyEnabled: data.anomalyEnabled } : {}),
    ...(data.sort !== undefined ? { sort: data.sort } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
  }).where(eq(iotProductProperties.id, propertyId)).returning();
  invalidateThingModelCache(productId);
  return mapIotProperty(row);
}

export async function deleteIotProperty(productId: number, propertyId: number): Promise<void> {
  await ensureIotPropertyExists(productId, propertyId);
  await db.delete(iotProductProperties).where(eq(iotProductProperties.id, propertyId));
  invalidateThingModelCache(productId);
}

// ─── 服务 CRUD ────────────────────────────────────────────────────────────────
export async function createIotService(productId: number, data: CreateIotServiceInput) {
  await ensureProductRow(productId);
  try {
    const [row] = await db.insert(iotProductServices).values({
      productId,
      identifier: data.identifier,
      name: data.name,
      params: data.params,
      danger: data.danger,
      sort: data.sort,
      description: data.description ?? null,
    }).returning();
    invalidateThingModelCache(productId);
    return mapIotService(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `服务标识符 "${data.identifier}" 已存在`);
    throw err;
  }
}

export async function ensureIotServiceExists(productId: number, serviceId: number): Promise<IotProductServiceRow> {
  const [row] = await db.select().from(iotProductServices)
    .where(and(eq(iotProductServices.id, serviceId), eq(iotProductServices.productId, productId)))
    .limit(1);
  return requireRow(row, '服务不存在');
}

export async function updateIotService(productId: number, serviceId: number, data: UpdateIotServiceInput) {
  await ensureIotServiceExists(productId, serviceId);
  const [row] = await db.update(iotProductServices).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.params !== undefined ? { params: data.params } : {}),
    ...(data.danger !== undefined ? { danger: data.danger } : {}),
    ...(data.sort !== undefined ? { sort: data.sort } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
  }).where(eq(iotProductServices.id, serviceId)).returning();
  invalidateThingModelCache(productId);
  return mapIotService(row);
}

export async function deleteIotService(productId: number, serviceId: number): Promise<void> {
  await ensureIotServiceExists(productId, serviceId);
  await db.delete(iotProductServices).where(eq(iotProductServices.id, serviceId));
  invalidateThingModelCache(productId);
}

// ─── 事件 CRUD ────────────────────────────────────────────────────────────────
export async function createIotEvent(productId: number, data: CreateIotEventInput) {
  await ensureProductRow(productId);
  try {
    const [row] = await db.insert(iotProductEvents).values({
      productId,
      identifier: data.identifier,
      name: data.name,
      level: data.level,
      params: data.params,
      sort: data.sort,
      description: data.description ?? null,
    }).returning();
    invalidateThingModelCache(productId);
    return mapIotEvent(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `事件标识符 "${data.identifier}" 已存在`);
    throw err;
  }
}

export async function ensureIotEventExists(productId: number, eventId: number): Promise<IotProductEventRow> {
  const [row] = await db.select().from(iotProductEvents)
    .where(and(eq(iotProductEvents.id, eventId), eq(iotProductEvents.productId, productId)))
    .limit(1);
  return requireRow(row, '事件不存在');
}

export async function updateIotEvent(productId: number, eventId: number, data: UpdateIotEventInput) {
  await ensureIotEventExists(productId, eventId);
  const [row] = await db.update(iotProductEvents).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.level !== undefined ? { level: data.level } : {}),
    ...(data.params !== undefined ? { params: data.params } : {}),
    ...(data.sort !== undefined ? { sort: data.sort } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
  }).where(eq(iotProductEvents.id, eventId)).returning();
  invalidateThingModelCache(productId);
  return mapIotEvent(row);
}

export async function deleteIotEvent(productId: number, eventId: number): Promise<void> {
  await ensureIotEventExists(productId, eventId);
  await db.delete(iotProductEvents).where(eq(iotProductEvents.id, eventId));
  invalidateThingModelCache(productId);
}

// ─── TSL 导入（全量替换）──────────────────────────────────────────────────────
export async function importIotTsl(productId: number, data: ImportIotTslInput) {
  await ensureProductRow(productId);
  ensureUniqueIdentifiers(data.properties.map((p) => p.identifier), '属性');
  ensureUniqueIdentifiers(data.services.map((s) => s.identifier), '服务');
  ensureUniqueIdentifiers(data.events.map((e) => e.identifier), '事件');
  await db.transaction(async (tx) => {
    await tx.delete(iotProductProperties).where(eq(iotProductProperties.productId, productId));
    await tx.delete(iotProductServices).where(eq(iotProductServices.productId, productId));
    await tx.delete(iotProductEvents).where(eq(iotProductEvents.productId, productId));
    if (data.properties.length > 0) {
      await tx.insert(iotProductProperties).values(data.properties.map((p) => ({
        productId,
        identifier: p.identifier,
        name: p.name,
        dataType: p.dataType,
        accessMode: p.accessMode,
        unit: p.unit ?? null,
        minValue: p.minValue ?? null,
        maxValue: p.maxValue ?? null,
        enumOptions: p.enumOptions ?? null,
        featured: p.featured,
        sort: p.sort,
        description: p.description ?? null,
      })));
    }
    if (data.services.length > 0) {
      await tx.insert(iotProductServices).values(data.services.map((s) => ({
        productId,
        identifier: s.identifier,
        name: s.name,
        params: s.params,
        danger: s.danger,
        sort: s.sort,
        description: s.description ?? null,
      })));
    }
    if (data.events.length > 0) {
      await tx.insert(iotProductEvents).values(data.events.map((e) => ({
        productId,
        identifier: e.identifier,
        name: e.name,
        level: e.level,
        params: e.params,
        sort: e.sort,
        description: e.description ?? null,
      })));
    }
  });
  invalidateThingModelCache(productId);
  return getThingModel(productId);
}

function ensureUniqueIdentifiers(identifiers: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of identifiers) {
    if (seen.has(id)) throw new HTTPException(400, { message: `${label}标识符 "${id}" 重复` });
    seen.add(id);
  }
}
