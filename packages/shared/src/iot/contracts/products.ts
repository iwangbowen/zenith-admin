import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, keywordQuery, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IOT_ACCESS_MODES, IOT_EVENT_LEVELS, IOT_PROPERTY_TYPES, IOT_VALIDATION_MODES } from '../constants';
import {
  createIotEventSchema, createIotProductSchema, createIotPropertySchema, createIotServiceSchema,
  importIotTslSchema, iotParamDefSchema, updateIotEventSchema, updateIotProductSchema,
  updateIotPropertySchema, updateIotServiceSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const iotProductSchema = z.object({
  id: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  validationMode: z.enum(IOT_VALIDATION_MODES),
  status: entityStatusSchema,
  registrationEnabled: z.boolean().meta({ description: '是否已开启动态注册（密钥明文不下发）' }),
  deviceCount: z.int(),
  propertyCount: z.int(),
  serviceCount: z.int(),
  eventCount: z.int(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotProduct' });

export type IotProduct = z.infer<typeof iotProductSchema>;

export const iotProductPropertySchema = z.object({
  id: z.int(),
  productId: z.int(),
  identifier: z.string().meta({ description: '属性标识符（遥测 / 影子的键名）' }),
  name: z.string(),
  dataType: z.enum(IOT_PROPERTY_TYPES),
  accessMode: z.enum(IOT_ACCESS_MODES).meta({ description: 'r 只读（设备上报）/ rw 读写（可下发期望值）' }),
  unit: z.string().nullable(),
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  enumOptions: z.record(z.string(), z.string()).nullable().meta({ description: 'enum 类型的取值映射：{ 值: 显示名 }' }),
  featured: z.boolean().meta({ description: '关键属性：设备列表快照列与遥测图表默认展示' }),
  anomalyEnabled: z.boolean().meta({ description: '遥测异常检测开关（数值型属性；3σ 基线判定）' }),
  sort: z.int(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotProductProperty' });

export type IotProductProperty = z.infer<typeof iotProductPropertySchema>;

export const iotProductServiceSchema = z.object({
  id: z.int(),
  productId: z.int(),
  identifier: z.string(),
  name: z.string(),
  params: z.array(iotParamDefSchema),
  danger: z.boolean().meta({ description: '高危服务：前端下发前二次确认' }),
  sort: z.int(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotProductService' });

export type IotProductService = z.infer<typeof iotProductServiceSchema>;

export const iotProductEventSchema = z.object({
  id: z.int(),
  productId: z.int(),
  identifier: z.string(),
  name: z.string(),
  level: z.enum(IOT_EVENT_LEVELS),
  params: z.array(iotParamDefSchema),
  sort: z.int(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotProductEvent' });

export type IotProductEvent = z.infer<typeof iotProductEventSchema>;

/** 物模型完整视图（TSL 导入导出与设备详情共用） */
export const iotThingModelSchema = z.object({
  properties: z.array(iotProductPropertySchema),
  services: z.array(iotProductServiceSchema),
  events: z.array(iotProductEventSchema),
}).meta({ id: 'IotThingModel' });

export type IotThingModel = z.infer<typeof iotThingModelSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotProductListQuery = paginationQuery.extend({
  keyword: keywordQuery('名称 / 描述'),
  status: entityStatusQuery,
});

export const iotPropertyParams = idParam.extend({
  propertyId: z.coerce.number().int().positive().meta({ description: '属性 ID', example: 1 }),
});

export const iotServiceParams = idParam.extend({
  serviceId: z.coerce.number().int().positive().meta({ description: '服务 ID', example: 1 }),
});

export const iotEventParams = idParam.extend({
  eventId: z.coerce.number().int().positive().meta({ description: '事件 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

const MODEL_TAGS = ['IoT 物模型'] as const;

export const iotProductContract = defineContract('/api/iot/products', {
  list: op.get('/', { access: { permission: 'iot:product:list' }, query: iotProductListQuery, response: paginated(iotProductSchema), summary: '产品列表（含设备数）' }),
  all: op.get('/all', { access: { permission: 'iot:product:list' }, response: z.array(iotProductSchema), summary: '全部启用产品（供下拉框）' }),
  model: op.get('/{id}/model', { access: { permission: 'iot:product:list' }, params: idParam, response: iotThingModelSchema, summary: '产品物模型（属性/服务/事件，导出 TSL 同源）', tags: MODEL_TAGS }),
  importModel: op.post('/{id}/model/import', {
    access: { permission: 'iot:product:update' }, audit: '导入 IoT 物模型',
    params: idParam,
    body: importIotTslSchema,
    response: iotThingModelSchema,
    summary: '导入 TSL（全量替换属性/服务/事件）',
    tags: MODEL_TAGS,
  }),
  createProperty: op.post('/{id}/properties', { access: { permission: 'iot:product:update' }, audit: '新增 IoT 物模型属性', params: idParam, body: createIotPropertySchema, response: iotProductPropertySchema, summary: '新增属性', tags: MODEL_TAGS }),
  updateProperty: op.put('/{id}/properties/{propertyId}', {
    access: { permission: 'iot:product:update' }, audit: '更新 IoT 物模型属性',
    params: iotPropertyParams,
    body: updateIotPropertySchema,
    response: iotProductPropertySchema,
    summary: '更新属性（标识符不可变更）',
    tags: MODEL_TAGS,
  }),
  removeProperty: op.delete('/{id}/properties/{propertyId}', { access: { permission: 'iot:product:update' }, audit: '删除 IoT 物模型属性', params: iotPropertyParams, summary: '删除属性', tags: MODEL_TAGS }),
  createService: op.post('/{id}/services', { access: { permission: 'iot:product:update' }, audit: '新增 IoT 物模型服务', params: idParam, body: createIotServiceSchema, response: iotProductServiceSchema, summary: '新增服务', tags: MODEL_TAGS }),
  updateService: op.put('/{id}/services/{serviceId}', {
    access: { permission: 'iot:product:update' }, audit: '更新 IoT 物模型服务',
    params: iotServiceParams,
    body: updateIotServiceSchema,
    response: iotProductServiceSchema,
    summary: '更新服务（标识符不可变更）',
    tags: MODEL_TAGS,
  }),
  removeService: op.delete('/{id}/services/{serviceId}', { access: { permission: 'iot:product:update' }, audit: '删除 IoT 物模型服务', params: iotServiceParams, summary: '删除服务', tags: MODEL_TAGS }),
  createEvent: op.post('/{id}/events', { access: { permission: 'iot:product:update' }, audit: '新增 IoT 物模型事件', params: idParam, body: createIotEventSchema, response: iotProductEventSchema, summary: '新增事件', tags: MODEL_TAGS }),
  updateEvent: op.put('/{id}/events/{eventId}', {
    access: { permission: 'iot:product:update' }, audit: '更新 IoT 物模型事件',
    params: iotEventParams,
    body: updateIotEventSchema,
    response: iotProductEventSchema,
    summary: '更新事件（标识符不可变更）',
    tags: MODEL_TAGS,
  }),
  removeEvent: op.delete('/{id}/events/{eventId}', { access: { permission: 'iot:product:update' }, audit: '删除 IoT 物模型事件', params: iotEventParams, summary: '删除事件', tags: MODEL_TAGS }),
  detail: op.get('/{id}', { access: { permission: 'iot:product:list' }, params: idParam, response: iotProductSchema, summary: '产品详情' }),
  create: op.post('/', { access: { permission: 'iot:product:create' }, audit: '创建 IoT 产品', body: createIotProductSchema, response: iotProductSchema, summary: '创建产品' }),
  update: op.put('/{id}', { access: { permission: 'iot:product:update' }, audit: '更新 IoT 产品', params: idParam, body: updateIotProductSchema, response: iotProductSchema, summary: '更新产品' }),
  remove: op.delete('/{id}', { access: { permission: 'iot:product:delete' }, audit: '删除 IoT 产品', params: idParam, summary: '删除产品（有设备时拒绝）' }),
}, { auditModule: 'IoT 产品', tags: ['IoT 产品'], feature: 'iot' });
