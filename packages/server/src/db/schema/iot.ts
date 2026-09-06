/**
 * IoT 设备管理（iot 域）。
 *
 * 二期（物模型驱动）：
 * - iot_products                产品（设备类型），物模型三元组挂在产品下
 * - iot_product_properties     物模型·属性（遥测校验 / 图表单位 / 影子键的唯一定义源）
 * - iot_product_services       物模型·服务（指令模板：参数 schema 驱动表单化下发）
 * - iot_product_events          物模型·事件（设备事件的级别与参数声明）
 * - iot_devices                 设备：SN 全局唯一 + 一机一密；实时在线态在 Redis TTL 键
 * - iot_device_state            设备影子：reported（最新上报快照）/ desired（期望值待确认）
 * - iot_device_events           统一事件流：生命周期（上下线/激活/重置密钥）+ 物模型事件
 * - iot_telemetry               遥测明细（jsonb 指标袋；按 reported_at 原生日分区，保留策略整分区 DROP）
 * - iot_commands                指令下发记录（pending→delivered→acked/failed，惰性超时）
 * - iot_alarm_rules / iot_alarms 告警规则（阈值/离线/事件）与告警记录（firing→resolved）
 * - iot_device_groups (+members) 设备静态分组（批量操作圈选目标）
 *
 * 三期（可视化与规模化运维）：
 * - iot_telemetry_hourly        遥测小时聚合（长窗口图表与仪表盘数据源，明细保留期可独立缩短）
 * - iot_online_snapshots        在线率采样（离线扫描任务顺带落点，仪表盘在线趋势）
 * - iot_firmwares               固件包（产品维度版本 + 托管文件 + sha256）
 * - iot_ota_tasks (+devices)    OTA 升级任务与单设备状态机（notified→downloading→installing→succeeded/failed）
 *
 * 五期（规模接入与智能运维）：
 * - iot_devices.node_type/gateway_id  设备形态：直连 / 网关 / 子设备（网关代理接入）
 * - iot_forward_rules / iot_forward_logs  数据流转：遥测/事件/告警/生命周期 → HTTP 推送 + 投递留痕
 * - iot_device_logs             设备日志通道（设备上报运行日志，保留期裁剪）
 * - iot_product_properties.anomaly_enabled  遥测异常检测开关（3σ 基线判定）
 *
 * 六期（运维闭环与智能升级）：
 * - iot_alarms 认领/处理备注 + 规则升级策略 + iot_maintenance_windows 维护静默窗口
 * - iot_schedules (+runs)       设备计划任务（时间驱动的指令/期望属性下发）
 * - iot_ota_tasks 灰度分批（batch_size/failure_threshold/paused）+ 设备批次号
 * - iot_products.registration_secret + iot_device_whitelist  一型一密动态注册
 */
import { pgTable, pgEnum, varchar, timestamp, integer, text, jsonb, boolean, doublePrecision, bigint, uuid, index, uniqueIndex, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants } from './core';
import { managedFiles } from './files';

// ─── 枚举 ─────────────────────────────────────────────────────────────────────
export const iotCommandStatusEnum = pgEnum('iot_command_status', ['pending', 'delivered', 'acked', 'failed', 'expired']);

export const iotPropertyTypeEnum = pgEnum('iot_property_type', ['number', 'string', 'boolean', 'enum']);

export const iotAccessModeEnum = pgEnum('iot_access_mode', ['r', 'rw']);

export const iotEventLevelEnum = pgEnum('iot_event_level', ['info', 'warn', 'fault']);

export const iotValidationModeEnum = pgEnum('iot_validation_mode', ['loose', 'strict']);

export const iotDeviceEventKindEnum = pgEnum('iot_device_event_kind', ['lifecycle', 'model', 'anomaly']);

export const iotAlarmRuleTypeEnum = pgEnum('iot_alarm_rule_type', ['threshold', 'offline', 'event']);

export const iotCompareOpEnum = pgEnum('iot_compare_op', ['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);

export const iotAlarmLevelEnum = pgEnum('iot_alarm_level', ['warning', 'critical']);

export const iotAlarmStatusEnum = pgEnum('iot_alarm_status', ['firing', 'acknowledged', 'resolved']);

export const iotNodeTypeEnum = pgEnum('iot_node_type', ['direct', 'gateway', 'sub']);

export const iotForwardSourceEnum = pgEnum('iot_forward_source', ['telemetry', 'event', 'alarm', 'lifecycle']);

export const iotForwardStatusEnum = pgEnum('iot_forward_status', ['succeeded', 'failed']);

export const iotLogLevelEnum = pgEnum('iot_log_level', ['debug', 'info', 'warn', 'error']);

export const iotScheduleTypeEnum = pgEnum('iot_schedule_type', ['cron', 'once']);

export const iotScheduleActionEnum = pgEnum('iot_schedule_action', ['command', 'desired']);

// ─── 产品与物模型 ─────────────────────────────────────────────────────────────
export const iotProducts = pgTable('iot_products', {
  id:             integer().primaryKey().generatedAlwaysAsIdentity(),
  name:           varchar({ length: 128 }).notNull(),
  description:    text(),
  /** 遥测校验模式：loose = 已声明属性校验类型/量程（不符丢弃该键）、未声明键放行；strict = 仅接受已声明属性 */
  validationMode: iotValidationModeEnum().notNull().default('loose'),
  status:         statusEnum().notNull().default('enabled'),
  /** 一型一密动态注册密钥（null = 关闭动态注册；设备用它签名换取设备密钥自动建档） */
  registrationSecret: varchar({ length: 64 }),
  tenantId:       integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_products_tenant').on(t.tenantId),
]);

export type IotProductRow = typeof iotProducts.$inferSelect;

export type NewIotProduct = typeof iotProducts.$inferInsert;

/** 服务/事件的参数定义（jsonb 内嵌，随宿主整体编辑，无独立查询诉求） */
export interface IotParamDef {
  identifier: string;
  name: string;
  dataType: 'number' | 'string' | 'boolean' | 'enum';
  required?: boolean;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  /** enum 类型的取值映射：{ 值: 显示名 } */
  enumOptions?: Record<string, string> | null;
}

export const iotProductProperties = pgTable('iot_product_properties', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  productId:   integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  /** 属性标识符（遥测/影子的键名） */
  identifier:  varchar({ length: 64 }).notNull(),
  name:        varchar({ length: 64 }).notNull(),
  dataType:    iotPropertyTypeEnum().notNull(),
  /** r = 只读（设备上报），rw = 可写（管理端可下发期望值） */
  accessMode:  iotAccessModeEnum().notNull().default('r'),
  unit:        varchar({ length: 16 }),
  minValue:    doublePrecision(),
  maxValue:    doublePrecision(),
  /** enum 类型的取值映射：{ 值: 显示名 } */
  enumOptions: jsonb().$type<Record<string, string>>(),
  /** 关键属性：设备列表快照列与遥测图表默认展示 */
  featured:    boolean().notNull().default(false),
  /** 遥测异常检测：按近 7 天小时聚合基线做 3σ 偏离判定（仅数值型属性生效） */
  anomalyEnabled: boolean().notNull().default(false),
  sort:        integer().notNull().default(0),
  description: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('uq_iot_product_properties_ident').on(t.productId, t.identifier),
]);

export type IotProductPropertyRow = typeof iotProductProperties.$inferSelect;

export type NewIotProductProperty = typeof iotProductProperties.$inferInsert;

export const iotProductServices = pgTable('iot_product_services', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  productId:   integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  identifier:  varchar({ length: 64 }).notNull(),
  name:        varchar({ length: 64 }).notNull(),
  /** 参数定义列表（下发时按此校验并渲染表单） */
  params:      jsonb().$type<IotParamDef[]>().notNull().default([]),
  /** 高危服务：前端下发前二次确认 */
  danger:      boolean().notNull().default(false),
  sort:        integer().notNull().default(0),
  description: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('uq_iot_product_services_ident').on(t.productId, t.identifier),
]);

export type IotProductServiceRow = typeof iotProductServices.$inferSelect;

export type NewIotProductService = typeof iotProductServices.$inferInsert;

export const iotProductEvents = pgTable('iot_product_events', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  productId:   integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  identifier:  varchar({ length: 64 }).notNull(),
  name:        varchar({ length: 64 }).notNull(),
  level:       iotEventLevelEnum().notNull().default('info'),
  /** 事件携带参数定义 */
  params:      jsonb().$type<IotParamDef[]>().notNull().default([]),
  sort:        integer().notNull().default(0),
  description: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('uq_iot_product_events_ident').on(t.productId, t.identifier),
]);

export type IotProductEventRow = typeof iotProductEvents.$inferSelect;

export type NewIotProductEvent = typeof iotProductEvents.$inferInsert;

// ─── 设备 ─────────────────────────────────────────────────────────────────────
export const iotDevices = pgTable('iot_devices', {
  id:              integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 设备序列号，全局唯一（接入寻址标识） */
  sn:              varchar({ length: 64 }).notNull().unique(),
  /** 一机一密：HMAC 签名密钥（管理端可见可重置） */
  secret:          varchar({ length: 64 }).notNull(),
  productId:       integer().notNull().references(() => iotProducts.id, { onDelete: 'restrict' }),
  name:            varchar({ length: 128 }).notNull(),
  status:          statusEnum().notNull().default('enabled'),
  /** 设备形态：direct 直连；gateway 网关（可代理子设备）；sub 子设备（经网关接入，免密） */
  nodeType:        iotNodeTypeEnum().notNull().default('direct'),
  /** 子设备所属网关（仅 node_type = sub 时有值） */
  gatewayId:       integer().references((): AnyPgColumn => iotDevices.id, { onDelete: 'restrict' }),
  /** 地理位置（设备地图；手填或导入） */
  latitude:        doublePrecision(),
  longitude:       doublePrecision(),
  address:         varchar({ length: 256 }),
  firmwareVersion: varchar({ length: 32 }),
  /** 首次上线时间（激活标记） */
  activatedAt:     timestamp(),
  /** 最近心跳/上报落库时间（节流更新，实时在线态在 Redis） */
  lastSeenAt:      timestamp(),
  remark:          varchar({ length: 256 }),
  tenantId:        integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_devices_product').on(t.productId),
  index('idx_iot_devices_tenant').on(t.tenantId),
  index('idx_iot_devices_gateway').on(t.gatewayId),
]);

export type IotDeviceRow = typeof iotDevices.$inferSelect;

export type NewIotDevice = typeof iotDevices.$inferInsert;

export type IotMetricValue = number | string | boolean;

/**
 * 设备影子：每设备一行。
 * reported = 遥测合并出的最新属性快照（设备列表/详情 O(1) 读，替代扫遥测表）；
 * desired  = 期望值增量（管理端下发、设备回报一致后按键清除）；
 * online   = 持久化在线标记（仅在上下线转变时更新，供事件打点与离线告警判定；实时态仍以 Redis 为准）。
 */
export const iotDeviceState = pgTable('iot_device_state', {
  deviceId:       integer().primaryKey().references(() => iotDevices.id, { onDelete: 'cascade' }),
  reported:       jsonb().$type<Record<string, IotMetricValue>>().notNull().default({}),
  reportedAt:     timestamp(),
  desired:        jsonb().$type<Record<string, IotMetricValue>>().notNull().default({}),
  /** desired 每次变更 +1，随 WS 帧/心跳响应下发，设备侧幂等 */
  desiredVersion: integer().notNull().default(0),
  desiredAt:      timestamp(),
  online:         boolean().notNull().default(false),
  updatedAt:      timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type IotDeviceStateRow = typeof iotDeviceState.$inferSelect;

export type NewIotDeviceState = typeof iotDeviceState.$inferInsert;

/** 统一事件流：追加型日志（生命周期 + 物模型事件），不加审计列 */
export const iotDeviceEvents = pgTable('iot_device_events', {
  id:         bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  deviceId:   integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  /** lifecycle = 系统生命周期事件；model = 设备按物模型上报的事件 */
  kind:       iotDeviceEventKindEnum().notNull(),
  /** lifecycle: online/offline/activated/secret_reset；model: 物模型事件 identifier */
  identifier: varchar({ length: 64 }).notNull(),
  /** 展示名（写入时冗余，避免模型改名后历史错位） */
  name:       varchar({ length: 64 }).notNull(),
  level:      iotEventLevelEnum().notNull().default('info'),
  payload:    jsonb().$type<Record<string, unknown>>(),
  reportedAt: timestamp().defaultNow().notNull(),
  createdAt:  timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_iot_device_events_device_time').on(t.deviceId, t.reportedAt),
]);

export type IotDeviceEventRow = typeof iotDeviceEvents.$inferSelect;

export type NewIotDeviceEvent = typeof iotDeviceEvents.$inferInsert;

// ─── 遥测与指令 ───────────────────────────────────────────────────────────────
/**
 * 遥测明细：PostgreSQL 原生 RANGE 日分区表（按 reported_at，UTC 日边界）。
 *
 * - 分区 DDL 超出 Drizzle 表达范围，`PARTITION BY` 与初始分区在迁移中手写，本处只描述列 / 索引 / 外键
 *   （父表上的索引与外键自动继承到每个分区）；重建迁移基线时必须一并保留
 * - 无代理主键：明细只按 (device_id, reported_at) 范围读取，主键索引纯属写放大；
 *   分区键必须进主键的约束也让 bigint id 失去意义
 * - 分区由 iot-partitions.service 预建 / 按需补建，保留策略按分区整表 DROP（零膨胀、无 vacuum 压力）
 * - BRIN 覆盖只按时间过滤的扫描（小时聚合任务）；追加型时序数据物理顺序与时间高度相关，索引体积可忽略
 */
export const iotTelemetry = pgTable('iot_telemetry', {
  deviceId:   integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  /** 属性值袋：{ temperature: 23.5, humidity: 61, door: 'open' }（按产品物模型校验） */
  metrics:    jsonb().$type<Record<string, IotMetricValue>>().notNull(),
  /** 业务发生时间（设备侧可传，缺省取服务器时间；同时是分区键） */
  reportedAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_iot_telemetry_device_time').on(t.deviceId, t.reportedAt),
  index('idx_iot_telemetry_time_brin').using('brin', t.reportedAt),
]);

export type IotTelemetryRow = typeof iotTelemetry.$inferSelect;

export type NewIotTelemetry = typeof iotTelemetry.$inferInsert;

export const iotCommands = pgTable('iot_commands', {
  id:        integer().primaryKey().generatedAlwaysAsIdentity(),
  deviceId:  integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  /** 服务标识符（物模型 services.identifier） */
  service:   varchar({ length: 64 }).notNull(),
  params:    jsonb().$type<Record<string, unknown>>(),
  status:    iotCommandStatusEnum().notNull().default('pending'),
  /** 超时期限：pending/delivered 越过此时刻按 expired 处理（查询时惰性刷新） */
  expireAt:  timestamp().notNull(),
  sentAt:    timestamp(),
  ackedAt:   timestamp(),
  response:  jsonb().$type<Record<string, unknown>>(),
  errorMsg:  varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_commands_device_time').on(t.deviceId, t.createdAt),
  index('idx_iot_commands_status').on(t.status),
]);

export type IotCommandRow = typeof iotCommands.$inferSelect;

export type NewIotCommand = typeof iotCommands.$inferInsert;

// ─── 告警 ─────────────────────────────────────────────────────────────────────
export const iotAlarmRules = pgTable('iot_alarm_rules', {
  id:                 integer().primaryKey().generatedAlwaysAsIdentity(),
  name:               varchar({ length: 128 }).notNull(),
  productId:          integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  /** 空 = 产品下全部设备；指定则仅对该设备生效 */
  deviceId:           integer().references(() => iotDevices.id, { onDelete: 'cascade' }),
  ruleType:           iotAlarmRuleTypeEnum().notNull(),
  /** threshold：监控的属性 identifier */
  propertyIdentifier: varchar({ length: 64 }),
  operator:           iotCompareOpEnum(),
  threshold:          doublePrecision(),
  /** threshold：连续 N 个点满足才触发（抖动抑制） */
  consecutiveCount:   integer().notNull().default(1),
  /** offline：离线超过 N 分钟触发 */
  offlineMinutes:     integer(),
  /** event：匹配的物模型事件 identifier */
  eventIdentifier:    varchar({ length: 64 }),
  level:              iotAlarmLevelEnum().notNull().default('warning'),
  /** 告警通知接收人（管理端用户 id） */
  notifyUserIds:      jsonb().$type<number[]>().notNull().default([]),
  /** 升级策略：触发后 N 分钟内未认领/未恢复 → 升级通知（null = 不升级） */
  escalateAfterMinutes: integer(),
  /** 升级通知接收人（如值班主管） */
  escalateUserIds:    jsonb().$type<number[]>().notNull().default([]),
  status:             statusEnum().notNull().default('enabled'),
  tenantId:           integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_alarm_rules_product').on(t.productId),
]);

export type IotAlarmRuleRow = typeof iotAlarmRules.$inferSelect;

export type NewIotAlarmRule = typeof iotAlarmRules.$inferInsert;

export const iotAlarms = pgTable('iot_alarms', {
  id:         integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 规则删除后记录保留（ruleName 冗余展示） */
  ruleId:     integer().references(() => iotAlarmRules.id, { onDelete: 'set null' }),
  ruleName:   varchar({ length: 128 }).notNull(),
  deviceId:   integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  ruleType:   iotAlarmRuleTypeEnum().notNull(),
  level:      iotAlarmLevelEnum().notNull(),
  status:     iotAlarmStatusEnum().notNull().default('firing'),
  message:    varchar({ length: 512 }).notNull(),
  /** 触发上下文：{ value, threshold, offlineMinutes, eventPayload… } */
  context:    jsonb().$type<Record<string, unknown>>(),
  firedAt:    timestamp().defaultNow().notNull(),
  /** 认领（acknowledged）：处理人接手，升级计时停止 */
  acknowledgedAt: timestamp(),
  acknowledgedBy: integer(),
  /** 升级通知已发出（每条告警至多升级一次） */
  escalatedAt: timestamp(),
  resolvedAt: timestamp(),
  /** resolved 来源：auto = 恢复判定，manual = 管理员处理 */
  resolvedBy: integer(),
  /** 处理备注（手动 resolve 时填写） */
  resolveNote: varchar({ length: 512 }),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_alarms_device_time').on(t.deviceId, t.firedAt),
  index('idx_iot_alarms_status').on(t.status),
  /** 同规则同设备仅一条未解决告警（firing/acknowledged 都算活跃，去重防风暴） */
  uniqueIndex('uq_iot_alarms_active').on(t.ruleId, t.deviceId).where(sql`status <> 'resolved'`),
]);

export type IotAlarmRow = typeof iotAlarms.$inferSelect;

export type NewIotAlarm = typeof iotAlarms.$inferInsert;

// ─── 设备分组 ─────────────────────────────────────────────────────────────────
export const iotDeviceGroups = pgTable('iot_device_groups', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  name:        varchar({ length: 64 }).notNull(),
  description: varchar({ length: 256 }),
  tenantId:    integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_device_groups_tenant').on(t.tenantId),
]);

export type IotDeviceGroupRow = typeof iotDeviceGroups.$inferSelect;

export type NewIotDeviceGroup = typeof iotDeviceGroups.$inferInsert;

export const iotDeviceGroupMembers = pgTable('iot_device_group_members', {
  groupId:  integer().notNull().references(() => iotDeviceGroups.id, { onDelete: 'cascade' }),
  deviceId: integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.groupId, t.deviceId] })]);

export type IotDeviceGroupMemberRow = typeof iotDeviceGroupMembers.$inferSelect;

// ─── 三期：遥测聚合与在线快照 ─────────────────────────────────────────────────
/** 遥测小时聚合：数值属性按 (设备, 属性, 小时桶) 物化 min/max/avg/last，长窗口图表与仪表盘数据源 */
export const iotTelemetryHourly = pgTable('iot_telemetry_hourly', {
  id:        bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  deviceId:  integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  property:  varchar({ length: 64 }).notNull(),
  /** 小时桶起点（date_trunc('hour', reported_at)） */
  bucket:    timestamp().notNull(),
  minValue:  doublePrecision().notNull(),
  maxValue:  doublePrecision().notNull(),
  avgValue:  doublePrecision().notNull(),
  lastValue: doublePrecision().notNull(),
  count:     integer().notNull(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  uniqueIndex('uq_iot_telemetry_hourly').on(t.deviceId, t.property, t.bucket),
  index('idx_iot_telemetry_hourly_bucket').on(t.bucket),
]);

export type IotTelemetryHourlyRow = typeof iotTelemetryHourly.$inferSelect;

export type NewIotTelemetryHourly = typeof iotTelemetryHourly.$inferInsert;

/** 在线率采样：离线扫描任务每分钟顺带落点（仪表盘在线趋势） */
export const iotOnlineSnapshots = pgTable('iot_online_snapshots', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  totalCount:  integer().notNull(),
  onlineCount: integer().notNull(),
  sampledAt:   timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_iot_online_snapshots_time').on(t.sampledAt),
]);

export type IotOnlineSnapshotRow = typeof iotOnlineSnapshots.$inferSelect;

// ─── 三期：固件与 OTA ─────────────────────────────────────────────────────────
export const iotOtaTaskStatusEnum = pgEnum('iot_ota_task_status', ['running', 'paused', 'completed', 'cancelled']);

export const iotOtaDeviceStatusEnum = pgEnum('iot_ota_device_status', [
  'pending', 'notified', 'downloading', 'installing', 'succeeded', 'failed', 'cancelled',
]);

export const iotFirmwares = pgTable('iot_firmwares', {
  id:           integer().primaryKey().generatedAlwaysAsIdentity(),
  productId:    integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  /** 语义化版本（同产品唯一），设备上报一致即判定升级成功 */
  version:      varchar({ length: 32 }).notNull(),
  /** 托管文件；文件被删时置空以保留固件记录（不可再下发） */
  fileId:       uuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  fileName:     varchar({ length: 255 }).notNull(),
  size:         bigint({ mode: 'number' }).notNull().default(0),
  sha256:       varchar({ length: 64 }).notNull(),
  releaseNotes: text(),
  status:       statusEnum().notNull().default('enabled'),
  tenantId:     integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('uq_iot_firmwares_product_version').on(t.productId, t.version),
]);

export type IotFirmwareRow = typeof iotFirmwares.$inferSelect;

export type NewIotFirmware = typeof iotFirmwares.$inferInsert;

export const iotOtaTasks = pgTable('iot_ota_tasks', {
  id:              integer().primaryKey().generatedAlwaysAsIdentity(),
  title:           varchar({ length: 128 }).notNull(),
  /** 固件存在升级任务时禁止删除（restrict），保证任务明细可追溯 */
  firmwareId:      integer().notNull().references(() => iotFirmwares.id, { onDelete: 'restrict' }),
  productId:       integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  firmwareVersion: varchar({ length: 32 }).notNull(),
  status:          iotOtaTaskStatusEnum().notNull().default('running'),
  /** 单设备超时（分钟）：越期未终态的设备判 failed，全部终态后任务收敛为 completed */
  timeoutMinutes:  integer().notNull().default(30),
  /** 灰度批次大小：null = 全量一批；否则首批 N 台，放量后逐批推进 */
  batchSize:       integer(),
  /** 当前已放量到的批次号（从 1 开始） */
  currentBatch:    integer().notNull().default(1),
  /** 失败率熔断阈值（百分比，1-100）：当前批失败占比达到即自动暂停；null = 不熔断 */
  failureThreshold: integer(),
  totalCount:      integer().notNull().default(0),
  succeededCount:  integer().notNull().default(0),
  failedCount:     integer().notNull().default(0),
  tenantId:        integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_ota_tasks_product').on(t.productId),
  index('idx_iot_ota_tasks_status').on(t.status),
]);

export type IotOtaTaskRow = typeof iotOtaTasks.$inferSelect;

export type NewIotOtaTask = typeof iotOtaTasks.$inferInsert;

export const iotOtaTaskDevices = pgTable('iot_ota_task_devices', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  taskId:      integer().notNull().references(() => iotOtaTasks.id, { onDelete: 'cascade' }),
  deviceId:    integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  status:      iotOtaDeviceStatusEnum().notNull().default('pending'),
  /** 下载/安装进度（0-100，设备 ota:progress 帧回报） */
  progress:    integer().notNull().default(0),
  /** 升级前固件版本快照 */
  fromVersion: varchar({ length: 32 }),
  /** 灰度批次号（从 1 开始；全量任务恒为 1） */
  batchIndex:  integer().notNull().default(1),
  errorMsg:    varchar({ length: 256 }),
  notifiedAt:  timestamp(),
  finishedAt:  timestamp(),
  ...timestampColumns(),
}, (t) => [
  uniqueIndex('uq_iot_ota_task_devices').on(t.taskId, t.deviceId),
  index('idx_iot_ota_task_devices_device').on(t.deviceId, t.status),
]);

export type IotOtaTaskDeviceRow = typeof iotOtaTaskDevices.$inferSelect;

export type NewIotOtaTaskDevice = typeof iotOtaTaskDevices.$inferInsert;

// ─── 四期：场景联动 ───────────────────────────────────────────────────────────
export const iotAutomationTriggerEnum = pgEnum('iot_automation_trigger', ['property', 'event', 'online', 'offline']);

/** 联动动作（jsonb 内嵌，随联动整体编辑） */
export interface IotAutomationActionDef {
  type: 'command' | 'desired' | 'notify' | 'workflow';
  /** 动作目标：self = 触发设备；或显式设备/分组（command/desired 用） */
  target?: 'self' | 'device' | 'group';
  targetDeviceId?: number | null;
  targetGroupId?: number | null;
  /** command：服务标识符与参数 */
  service?: string | null;
  params?: Record<string, unknown> | null;
  /** desired：期望属性 */
  desired?: Record<string, number | string | boolean> | null;
  /** notify：接收人（管理端用户） */
  userIds?: number[] | null;
  /** workflow：流程定义 id 与表单数据 */
  workflowDefinitionId?: number | null;
  formData?: Record<string, unknown> | null;
}

export const iotAutomations = pgTable('iot_automations', {
  id:                 integer().primaryKey().generatedAlwaysAsIdentity(),
  name:               varchar({ length: 128 }).notNull(),
  productId:          integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  /** 空 = 产品下全部设备触发；指定则仅该设备 */
  deviceId:           integer().references(() => iotDevices.id, { onDelete: 'cascade' }),
  triggerType:        iotAutomationTriggerEnum().notNull(),
  /** property 触发：属性 + 比较符 + 阈值 */
  propertyIdentifier: varchar({ length: 64 }),
  operator:           iotCompareOpEnum(),
  threshold:          doublePrecision(),
  /** event 触发：物模型事件标识符 */
  eventIdentifier:    varchar({ length: 64 }),
  /** 可选：规则中心决策表二次判定（按 key 软引用，命中任意行才执行动作） */
  decisionRuleKey:    varchar({ length: 64 }),
  /** 冷却期（秒）：同一联动 × 同一触发设备在窗口内不重复执行 */
  cooldownSeconds:    integer().notNull().default(60),
  actions:            jsonb().$type<IotAutomationActionDef[]>().notNull().default([]),
  status:             statusEnum().notNull().default('enabled'),
  tenantId:           integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_automations_product').on(t.productId),
]);

export type IotAutomationRow = typeof iotAutomations.$inferSelect;

export type NewIotAutomation = typeof iotAutomations.$inferInsert;

/** 联动执行留痕：追加型日志（触发上下文 + 逐动作结果） */
export const iotAutomationRuns = pgTable('iot_automation_runs', {
  id:             bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  automationId:   integer().notNull().references(() => iotAutomations.id, { onDelete: 'cascade' }),
  /** 名称快照（联动改名后历史不漂移） */
  automationName: varchar({ length: 128 }).notNull(),
  deviceId:       integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  triggerContext: jsonb().$type<Record<string, unknown>>().notNull(),
  /** 逐动作结果：[{ type, target?, success, message? }] */
  results:        jsonb().$type<Array<{ type: string; target?: string; success: boolean; message?: string }>>().notNull().default([]),
  success:        boolean().notNull().default(true),
  createdAt:      timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_iot_automation_runs_automation').on(t.automationId, t.createdAt),
  index('idx_iot_automation_runs_device').on(t.deviceId, t.createdAt),
]);

export type IotAutomationRunRow = typeof iotAutomationRuns.$inferSelect;

// ─── 五期：数据流转 ───────────────────────────────────────────────────────────
export const iotForwardRules = pgTable('iot_forward_rules', {
  id:                  integer().primaryKey().generatedAlwaysAsIdentity(),
  name:                varchar({ length: 128 }).notNull(),
  /** 数据源：telemetry 遥测 / event 设备事件 / alarm 告警 / lifecycle 生命周期 */
  source:              iotForwardSourceEnum().notNull(),
  /** 过滤：产品（空 = 全部产品） */
  productId:           integer().references(() => iotProducts.id, { onDelete: 'cascade' }),
  /** 过滤：设备分组（空 = 不限分组） */
  groupId:             integer().references(() => iotDeviceGroups.id, { onDelete: 'set null' }),
  /** 目的地：HTTP POST 地址（经开放平台同款出站防护） */
  url:                 varchar({ length: 512 }).notNull(),
  /** HMAC-SHA256 签名密钥（可空 = 不签名；签名头 X-Iot-Signature = hex(hmac(secret, body))） */
  secret:              varchar({ length: 128 }),
  /** 自定义请求头 */
  headers:             jsonb().$type<Record<string, string>>(),
  status:              statusEnum().notNull().default('enabled'),
  /** 连续投递失败计数；达到阈值自动停用（autoDisabledAt 置位） */
  consecutiveFailures: integer().notNull().default(0),
  autoDisabledAt:      timestamp(),
  tenantId:            integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_forward_rules_source').on(t.source),
  index('idx_iot_forward_rules_tenant').on(t.tenantId),
]);

export type IotForwardRuleRow = typeof iotForwardRules.$inferSelect;

/** 流转投递日志：追加型（保留策略裁剪） */
export const iotForwardLogs = pgTable('iot_forward_logs', {
  id:             bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  ruleId:         integer().notNull().references(() => iotForwardRules.id, { onDelete: 'cascade' }),
  /** 规则名快照 */
  ruleName:       varchar({ length: 128 }).notNull(),
  source:         iotForwardSourceEnum().notNull(),
  deviceId:       integer(),
  payload:        jsonb().$type<Record<string, unknown>>().notNull(),
  status:         iotForwardStatusEnum().notNull(),
  responseStatus: integer(),
  errorMessage:   varchar({ length: 512 }),
  durationMs:     integer(),
  createdAt:      timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_iot_forward_logs_rule').on(t.ruleId, t.createdAt),
]);

export type IotForwardLogRow = typeof iotForwardLogs.$inferSelect;

// ─── 五期：设备日志通道 ───────────────────────────────────────────────────────
export const iotDeviceLogs = pgTable('iot_device_logs', {
  id:         bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  deviceId:   integer().notNull().references(() => iotDevices.id, { onDelete: 'cascade' }),
  level:      iotLogLevelEnum().notNull().default('info'),
  /** 模块/标签（设备侧自定义，如 net / sensor / ota） */
  tag:        varchar({ length: 64 }),
  content:    varchar({ length: 1024 }).notNull(),
  reportedAt: timestamp().notNull(),
  createdAt:  timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_iot_device_logs_device').on(t.deviceId, t.reportedAt),
  index('idx_iot_device_logs_level').on(t.deviceId, t.level),
]);

export type IotDeviceLogRow = typeof iotDeviceLogs.$inferSelect;

// ─── 六期：维护窗口 ───────────────────────────────────────────────────────────
/** 计划性维护静默：窗口内命中的告警仍记录但不派发通知/升级 */
export const iotMaintenanceWindows = pgTable('iot_maintenance_windows', {
  id:        integer().primaryKey().generatedAlwaysAsIdentity(),
  name:      varchar({ length: 128 }).notNull(),
  /** 作用范围（三者至少其一；同时填写取并集语义按设备命中判断） */
  productId: integer().references(() => iotProducts.id, { onDelete: 'cascade' }),
  groupId:   integer().references(() => iotDeviceGroups.id, { onDelete: 'cascade' }),
  deviceId:  integer().references(() => iotDevices.id, { onDelete: 'cascade' }),
  startAt:   timestamp().notNull(),
  endAt:     timestamp().notNull(),
  reason:    varchar({ length: 256 }),
  tenantId:  integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_maintenance_windows_time').on(t.startAt, t.endAt),
]);

export type IotMaintenanceWindowRow = typeof iotMaintenanceWindows.$inferSelect;

// ─── 六期：设备计划任务 ───────────────────────────────────────────────────────
/** 时间驱动的自动化（与场景联动的事件驱动互补）：cron/一次性定时下发指令或期望属性 */
export const iotSchedules = pgTable('iot_schedules', {
  id:             integer().primaryKey().generatedAlwaysAsIdentity(),
  name:           varchar({ length: 128 }).notNull(),
  scheduleType:   iotScheduleTypeEnum().notNull(),
  /** cron 型：五段 cron 表达式（分 时 日 月 周） */
  cronExpression: varchar({ length: 64 }),
  /** once 型：执行时刻 */
  runAt:          timestamp(),
  /** 目标圈选：product 全量 / group 分组 / device 单台 */
  productId:      integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  groupId:        integer().references(() => iotDeviceGroups.id, { onDelete: 'set null' }),
  deviceId:       integer().references(() => iotDevices.id, { onDelete: 'cascade' }),
  /** 动作：command 服务调用 / desired 期望属性 */
  actionType:     iotScheduleActionEnum().notNull(),
  service:        varchar({ length: 64 }),
  params:         jsonb().$type<Record<string, unknown>>(),
  desired:        jsonb().$type<Record<string, number | string | boolean>>(),
  status:         statusEnum().notNull().default('enabled'),
  /** 调度游标：下次应执行时刻（分钟级扫描按此判定到期；once 执行后置空并停用） */
  nextRunAt:      timestamp(),
  lastRunAt:      timestamp(),
  tenantId:       integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_schedules_next_run').on(t.status, t.nextRunAt),
  index('idx_iot_schedules_product').on(t.productId),
]);

export type IotScheduleRow = typeof iotSchedules.$inferSelect;

/** 计划执行留痕：追加型（保留策略裁剪） */
export const iotScheduleRuns = pgTable('iot_schedule_runs', {
  id:           bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  scheduleId:   integer().notNull().references(() => iotSchedules.id, { onDelete: 'cascade' }),
  scheduleName: varchar({ length: 128 }).notNull(),
  deviceCount:  integer().notNull().default(0),
  successCount: integer().notNull().default(0),
  failedCount:  integer().notNull().default(0),
  /** 失败明细（截断保留前 20 条）：[{ deviceId, sn, error }] */
  errors:       jsonb().$type<Array<{ deviceId: number; sn: string; error: string }>>().notNull().default([]),
  createdAt:    timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_iot_schedule_runs_schedule').on(t.scheduleId, t.createdAt),
]);

export type IotScheduleRunRow = typeof iotScheduleRuns.$inferSelect;

// ─── 六期：动态注册白名单 ─────────────────────────────────────────────────────
/** 一型一密预注册：SN 白名单（设备首连以产品注册密钥签名，命中白名单即自动建档换取设备密钥） */
export const iotDeviceWhitelist = pgTable('iot_device_whitelist', {
  id:        integer().primaryKey().generatedAlwaysAsIdentity(),
  productId: integer().notNull().references(() => iotProducts.id, { onDelete: 'cascade' }),
  sn:        varchar({ length: 64 }).notNull().unique(),
  /** 已使用：注册成功后置位（一次性凭证语义） */
  used:      boolean().notNull().default(false),
  usedAt:    timestamp(),
  /** 注册产生的设备 id（追溯） */
  deviceId:  integer().references(() => iotDevices.id, { onDelete: 'set null' }),
  remark:    varchar({ length: 256 }),
  tenantId:  integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_iot_device_whitelist_product').on(t.productId, t.used),
]);

export type IotDeviceWhitelistRow = typeof iotDeviceWhitelist.$inferSelect;
