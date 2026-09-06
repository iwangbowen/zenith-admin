import { createLabelOptions } from '../core/enum-options';
import { NUMERIC_COMPARE_OPS } from '../core/compare';

// ─── 指令状态 ─────────────────────────────────────────────────────────────────
export const IOT_COMMAND_STATUSES = ['pending', 'delivered', 'acked', 'failed', 'expired'] as const;

export type IotCommandStatus = (typeof IOT_COMMAND_STATUSES)[number];

export const IOT_COMMAND_STATUS_LABELS: Record<IotCommandStatus, string> = {
  pending: '待下发',
  delivered: '已送达',
  acked: '执行成功',
  failed: '执行失败',
  expired: '已超时',
};

export const IOT_COMMAND_STATUS_OPTIONS = createLabelOptions(IOT_COMMAND_STATUSES, IOT_COMMAND_STATUS_LABELS);

// ─── 物模型：属性数据类型 ─────────────────────────────────────────────────────
export const IOT_PROPERTY_TYPES = ['number', 'string', 'boolean', 'enum'] as const;

export type IotPropertyType = (typeof IOT_PROPERTY_TYPES)[number];

export const IOT_PROPERTY_TYPE_LABELS: Record<IotPropertyType, string> = {
  number: '数值',
  string: '字符串',
  boolean: '布尔',
  enum: '枚举',
};

export const IOT_PROPERTY_TYPE_OPTIONS = createLabelOptions(IOT_PROPERTY_TYPES, IOT_PROPERTY_TYPE_LABELS);

// ─── 物模型：属性读写模式 ─────────────────────────────────────────────────────
export const IOT_ACCESS_MODES = ['r', 'rw'] as const;

export type IotAccessMode = (typeof IOT_ACCESS_MODES)[number];

export const IOT_ACCESS_MODE_LABELS: Record<IotAccessMode, string> = {
  r: '只读',
  rw: '读写',
};

export const IOT_ACCESS_MODE_OPTIONS = createLabelOptions(IOT_ACCESS_MODES, IOT_ACCESS_MODE_LABELS);

// ─── 物模型：事件级别 ─────────────────────────────────────────────────────────
export const IOT_EVENT_LEVELS = ['info', 'warn', 'fault'] as const;

export type IotEventLevel = (typeof IOT_EVENT_LEVELS)[number];

export const IOT_EVENT_LEVEL_LABELS: Record<IotEventLevel, string> = {
  info: '信息',
  warn: '告警',
  fault: '故障',
};

export const IOT_EVENT_LEVEL_OPTIONS = createLabelOptions(IOT_EVENT_LEVELS, IOT_EVENT_LEVEL_LABELS);

// ─── 遥测校验模式 ─────────────────────────────────────────────────────────────
export const IOT_VALIDATION_MODES = ['loose', 'strict'] as const;

export type IotValidationMode = (typeof IOT_VALIDATION_MODES)[number];

export const IOT_VALIDATION_MODE_LABELS: Record<IotValidationMode, string> = {
  loose: '宽松（校验已声明属性，未声明键放行）',
  strict: '严格（仅接受已声明属性）',
};

export const IOT_VALIDATION_MODE_OPTIONS = createLabelOptions(IOT_VALIDATION_MODES, IOT_VALIDATION_MODE_LABELS);

// ─── 设备事件流 ───────────────────────────────────────────────────────────────
export const IOT_DEVICE_EVENT_KINDS = ['lifecycle', 'model', 'anomaly'] as const;

export type IotDeviceEventKind = (typeof IOT_DEVICE_EVENT_KINDS)[number];

export const IOT_DEVICE_EVENT_KIND_LABELS: Record<IotDeviceEventKind, string> = {
  lifecycle: '生命周期',
  model: '设备事件',
  anomaly: '异常检测',
};

export const IOT_DEVICE_EVENT_KIND_OPTIONS = createLabelOptions(IOT_DEVICE_EVENT_KINDS, IOT_DEVICE_EVENT_KIND_LABELS);

/** 生命周期事件标识符 → 展示名 */
export const IOT_LIFECYCLE_EVENTS = {
  online: '设备上线',
  offline: '设备离线',
  activated: '设备激活',
  secret_reset: '密钥重置',
} as const;

export type IotLifecycleEventId = keyof typeof IOT_LIFECYCLE_EVENTS;

// ─── 告警 ─────────────────────────────────────────────────────────────────────
export const IOT_ALARM_RULE_TYPES = ['threshold', 'offline', 'event'] as const;

export type IotAlarmRuleType = (typeof IOT_ALARM_RULE_TYPES)[number];

export const IOT_ALARM_RULE_TYPE_LABELS: Record<IotAlarmRuleType, string> = {
  threshold: '属性阈值',
  offline: '设备离线',
  event: '事件触发',
};

export const IOT_ALARM_RULE_TYPE_OPTIONS = createLabelOptions(IOT_ALARM_RULE_TYPES, IOT_ALARM_RULE_TYPE_LABELS);

/** 属性比较算子：与 `@zenith/shared/core` 的 `NUMERIC_COMPARE_OPS` 同源，判定用 `compareNumber()` */
export const IOT_COMPARE_OPS = NUMERIC_COMPARE_OPS;

export type IotCompareOp = (typeof IOT_COMPARE_OPS)[number];

export const IOT_COMPARE_OP_LABELS: Record<IotCompareOp, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
};

export const IOT_COMPARE_OP_OPTIONS = createLabelOptions(IOT_COMPARE_OPS, IOT_COMPARE_OP_LABELS);

export const IOT_ALARM_LEVELS = ['warning', 'critical'] as const;

export type IotAlarmLevel = (typeof IOT_ALARM_LEVELS)[number];

export const IOT_ALARM_LEVEL_LABELS: Record<IotAlarmLevel, string> = {
  warning: '警告',
  critical: '严重',
};

export const IOT_ALARM_LEVEL_OPTIONS = createLabelOptions(IOT_ALARM_LEVELS, IOT_ALARM_LEVEL_LABELS);

export const IOT_ALARM_STATUSES = ['firing', 'acknowledged', 'resolved'] as const;

export type IotAlarmStatus = (typeof IOT_ALARM_STATUSES)[number];

export const IOT_ALARM_STATUS_LABELS: Record<IotAlarmStatus, string> = {
  firing: '告警中',
  acknowledged: '已认领',
  resolved: '已恢复',
};

export const IOT_ALARM_STATUS_OPTIONS = createLabelOptions(IOT_ALARM_STATUSES, IOT_ALARM_STATUS_LABELS);

// ─── 设备接入协议 ─────────────────────────────────────────────────────────────
/** 设备上报/WS 握手签名头（HMAC-SHA256(secret, `${sn}\n${ts}\n${body}`) 的 hex） */
export const IOT_SIGN_HEADER = 'X-IoT-Sign';

export const IOT_SN_HEADER = 'X-IoT-Sn';

export const IOT_TIMESTAMP_HEADER = 'X-IoT-Timestamp';

/** 签名时间窗（秒）：超过视为重放/时钟漂移，拒绝 */
export const IOT_SIGN_MAX_SKEW_SECONDS = 300;

/** 心跳在线 TTL（秒）：Redis 键存活即在线；设备建议 30s 心跳一次 */
export const IOT_ONLINE_TTL_SECONDS = 90;

/** 指令默认超时（秒） */
export const IOT_COMMAND_DEFAULT_TTL_SECONDS = 300;

/** 单次批量遥测上报最大条数 */
export const IOT_TELEMETRY_BATCH_MAX = 100;

/** 单次批量事件上报最大条数 */
export const IOT_EVENT_BATCH_MAX = 20;

/** 批量操作（指令/期望值）单次最大目标设备数 */
export const IOT_BATCH_DEVICE_MAX = 500;

// ─── WS 帧类型（设备网关双向协议）────────────────────────────────────────────
export const IOT_WS_FRAME_TYPES = {
  /** 设备 → 服务端 */
  heartbeat: 'heartbeat',
  telemetry: 'telemetry',
  event: 'event',
  commandAck: 'command:ack',
  /** 设备 → 服务端：批量上报运行日志 */
  log: 'log',
  /** 网关 → 服务端：代理子设备批量遥测 */
  gatewayBatch: 'gateway:batch',
  /** 网关 → 服务端：代理子设备事件 */
  gatewayEvent: 'gateway:event',
  /** 服务端 → 设备 */
  commandExec: 'command:exec',
  heartbeatAck: 'heartbeat:ack',
  /** 服务端 → 设备：期望属性变更（设备应用后通过属性上报回执，服务端按键收敛） */
  shadowDesired: 'shadow:desired',
  /** 服务端 → 设备：OTA 升级通知 */
  otaUpgrade: 'ota:upgrade',
  /** 设备 → 服务端：OTA 进度回报 */
  otaProgress: 'ota:progress',
} as const;

// ─── OTA 升级 ─────────────────────────────────────────────────────────────────
export const IOT_OTA_TASK_STATUSES = ['running', 'paused', 'completed', 'cancelled'] as const;

export type IotOtaTaskStatus = (typeof IOT_OTA_TASK_STATUSES)[number];

export const IOT_OTA_TASK_STATUS_LABELS: Record<IotOtaTaskStatus, string> = {
  running: '进行中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
};

export const IOT_OTA_TASK_STATUS_OPTIONS = createLabelOptions(IOT_OTA_TASK_STATUSES, IOT_OTA_TASK_STATUS_LABELS);

export const IOT_OTA_DEVICE_STATUSES = ['pending', 'notified', 'downloading', 'installing', 'succeeded', 'failed', 'cancelled'] as const;

export type IotOtaDeviceStatus = (typeof IOT_OTA_DEVICE_STATUSES)[number];

export const IOT_OTA_DEVICE_STATUS_LABELS: Record<IotOtaDeviceStatus, string> = {
  pending: '待通知',
  notified: '已通知',
  downloading: '下载中',
  installing: '安装中',
  succeeded: '升级成功',
  failed: '升级失败',
  cancelled: '已取消',
};

export const IOT_OTA_DEVICE_STATUS_OPTIONS = createLabelOptions(IOT_OTA_DEVICE_STATUSES, IOT_OTA_DEVICE_STATUS_LABELS);

/** 设备可回报的 OTA 进度状态（终态由服务端收敛） */
export const IOT_OTA_PROGRESS_STATUSES = ['downloading', 'installing', 'succeeded', 'failed'] as const;

export type IotOtaProgressStatus = (typeof IOT_OTA_PROGRESS_STATUSES)[number];

/** OTA 单设备默认超时（分钟） */
export const IOT_OTA_DEFAULT_TIMEOUT_MINUTES = 30;

/** 固件版本格式：1.2.3 或 1.2.3-beta.1 */
export const IOT_FIRMWARE_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// ─── 场景联动 ─────────────────────────────────────────────────────────────────
export const IOT_AUTOMATION_TRIGGERS = ['property', 'event', 'online', 'offline'] as const;

export type IotAutomationTrigger = (typeof IOT_AUTOMATION_TRIGGERS)[number];

export const IOT_AUTOMATION_TRIGGER_LABELS: Record<IotAutomationTrigger, string> = {
  property: '属性条件',
  event: '设备事件',
  online: '设备上线',
  offline: '设备离线',
};

export const IOT_AUTOMATION_TRIGGER_OPTIONS = createLabelOptions(IOT_AUTOMATION_TRIGGERS, IOT_AUTOMATION_TRIGGER_LABELS);

export const IOT_AUTOMATION_ACTION_TYPES = ['command', 'desired', 'notify', 'workflow'] as const;

export type IotAutomationActionType = (typeof IOT_AUTOMATION_ACTION_TYPES)[number];

export const IOT_AUTOMATION_ACTION_TYPE_LABELS: Record<IotAutomationActionType, string> = {
  command: '下发服务指令',
  desired: '设置期望属性',
  notify: '发送通知',
  workflow: '发起工作流',
};

export const IOT_AUTOMATION_ACTION_TYPE_OPTIONS = createLabelOptions(IOT_AUTOMATION_ACTION_TYPES, IOT_AUTOMATION_ACTION_TYPE_LABELS);

/** 动作目标语义（command/desired） */
export const IOT_AUTOMATION_TARGETS = ['self', 'device', 'group'] as const;

export type IotAutomationTarget = (typeof IOT_AUTOMATION_TARGETS)[number];

export const IOT_AUTOMATION_TARGET_LABELS: Record<IotAutomationTarget, string> = {
  self: '触发设备',
  device: '指定设备',
  group: '指定分组',
};

export const IOT_AUTOMATION_TARGET_OPTIONS = createLabelOptions(IOT_AUTOMATION_TARGETS, IOT_AUTOMATION_TARGET_LABELS);

/** 联动默认冷却期（秒） */
export const IOT_AUTOMATION_DEFAULT_COOLDOWN_SECONDS = 60;

/** 单条联动最大动作数 */
export const IOT_AUTOMATION_ACTION_MAX = 5;

// ─── 五期：设备形态（网关与子设备）───────────────────────────────────────────
export const IOT_NODE_TYPES = ['direct', 'gateway', 'sub'] as const;

export type IotNodeType = (typeof IOT_NODE_TYPES)[number];

export const IOT_NODE_TYPE_LABELS: Record<IotNodeType, string> = {
  direct: '直连设备',
  gateway: '网关',
  sub: '子设备',
};

export const IOT_NODE_TYPE_OPTIONS = createLabelOptions(IOT_NODE_TYPES, IOT_NODE_TYPE_LABELS);

/** 网关单帧代理上报的子设备条目上限 */
export const IOT_GATEWAY_BATCH_MAX = 100;

// ─── 五期：数据流转 ───────────────────────────────────────────────────────────
export const IOT_FORWARD_SOURCES = ['telemetry', 'event', 'alarm', 'lifecycle'] as const;

export type IotForwardSource = (typeof IOT_FORWARD_SOURCES)[number];

export const IOT_FORWARD_SOURCE_LABELS: Record<IotForwardSource, string> = {
  telemetry: '遥测数据',
  event: '设备事件',
  alarm: '告警',
  lifecycle: '生命周期',
};

export const IOT_FORWARD_SOURCE_OPTIONS = createLabelOptions(IOT_FORWARD_SOURCES, IOT_FORWARD_SOURCE_LABELS);

/** 单次投递结果 */
export const IOT_FORWARD_STATUSES = ['succeeded', 'failed'] as const;

export type IotForwardStatus = (typeof IOT_FORWARD_STATUSES)[number];

export const IOT_FORWARD_STATUS_LABELS: Record<IotForwardStatus, string> = {
  succeeded: '成功',
  failed: '失败',
};

export const IOT_FORWARD_STATUS_OPTIONS = createLabelOptions(IOT_FORWARD_STATUSES, IOT_FORWARD_STATUS_LABELS);

/** 连续投递失败达到该次数后规则自动停用 */
export const IOT_FORWARD_AUTO_DISABLE_THRESHOLD = 10;

// ─── 五期：设备日志 ───────────────────────────────────────────────────────────
export const IOT_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type IotLogLevel = (typeof IOT_LOG_LEVELS)[number];

export const IOT_LOG_LEVEL_LABELS: Record<IotLogLevel, string> = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误',
};

export const IOT_LOG_LEVEL_OPTIONS = createLabelOptions(IOT_LOG_LEVELS, IOT_LOG_LEVEL_LABELS);

/** 设备日志单帧条目上限 */
export const IOT_LOG_BATCH_MAX = 100;

// ─── 五期：遥测异常检测 ───────────────────────────────────────────────────────
/** 基线窗口：近 N 天小时聚合 */
export const IOT_ANOMALY_BASELINE_DAYS = 7;

/** 偏离倍数：|value - mean| > N × std 判定异常 */
export const IOT_ANOMALY_SIGMA = 3;

/** 同一设备 × 属性的异常事件去抖窗口（秒） */
export const IOT_ANOMALY_DEBOUNCE_SECONDS = 600;

/** 基线最少样本数（小时桶数），不足则不判定 */
export const IOT_ANOMALY_MIN_SAMPLES = 24;

// ─── 六期：设备计划任务 ───────────────────────────────────────────────────────
export const IOT_SCHEDULE_TYPES = ['cron', 'once'] as const;

export type IotScheduleType = (typeof IOT_SCHEDULE_TYPES)[number];

export const IOT_SCHEDULE_TYPE_LABELS: Record<IotScheduleType, string> = {
  cron: '周期执行',
  once: '定时一次',
};

export const IOT_SCHEDULE_TYPE_OPTIONS = createLabelOptions(IOT_SCHEDULE_TYPES, IOT_SCHEDULE_TYPE_LABELS);

export const IOT_SCHEDULE_ACTIONS = ['command', 'desired'] as const;

export type IotScheduleAction = (typeof IOT_SCHEDULE_ACTIONS)[number];

export const IOT_SCHEDULE_ACTION_LABELS: Record<IotScheduleAction, string> = {
  command: '下发服务指令',
  desired: '设置期望属性',
};

export const IOT_SCHEDULE_ACTION_OPTIONS = createLabelOptions(IOT_SCHEDULE_ACTIONS, IOT_SCHEDULE_ACTION_LABELS);

/** 计划单次执行的目标设备上限（防误圈全量大产品） */
export const IOT_SCHEDULE_TARGET_MAX = 500;

// ─── 六期：OTA 灰度 ───────────────────────────────────────────────────────────
/** 灰度失败率熔断阈值默认值（百分比） */
export const IOT_OTA_DEFAULT_FAILURE_THRESHOLD = 30;

// ─── 六期：动态注册 ───────────────────────────────────────────────────────────
/** 注册请求时间窗（秒，防重放） */
export const IOT_REGISTER_MAX_SKEW_SECONDS = 300;

/** 白名单单次批量导入上限 */
export const IOT_WHITELIST_BATCH_MAX = 1000;
