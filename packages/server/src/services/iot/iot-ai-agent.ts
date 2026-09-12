/**
 * IoT AI 设备助手（编程式智能体）。
 *
 * 面向运维的自然语言入口：设备状态查询、活跃告警摘要、异常事件解读、
 * 遥测快照对比（"哪台设备温度最高"）。工具直接查询 IoT 域数据（只读），
 * 模型来自系统默认 AI 服务商（未配置时跳过注册，不影响其他功能）。
 *
 * 注册时机：getMastra() 初始化（见 lib/mastra/index.ts）；
 * 前端在智能体列表以「内置」形式出现，可直接发起对话。
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Mastra } from '@mastra/core';
import type { AiBuiltinAgent } from '@zenith/shared/ai';
import { IOT_ALARM_LEVEL_LABELS, IOT_ALARM_STATUS_LABELS } from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotAlarms, iotDeviceEvents, iotDevices, iotDeviceState, iotProducts,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { getOnlineMap } from './iot-access.service';

export const IOT_AGENT_METAS: AiBuiltinAgent[] = [
  {
    agentId: 'iot-device-assistant',
    name: 'IoT 设备助手',
    description: '设备运维智能助手：设备在线状态、活跃告警摘要、异常事件解读、遥测快照对比',
    avatar: '📡',
    openingMessage: '你好，我是 IoT 设备助手。可以问我设备在线情况、当前告警、最近异常，比如「哪台设备温度最高」「有哪些未处理的告警」。',
    suggestedQuestions: ['当前有哪些活跃告警？', '哪台设备温度最高？', '最近有异常检测事件吗？', '设备在线情况如何？'],
  },
];

/** 设备清单 + 在线态 + 影子快照（上限 50 台，给模型的紧凑 JSON） */
async function loadDeviceOverview() {
  const rows = await db.select({
    id: iotDevices.id, sn: iotDevices.sn, name: iotDevices.name,
    nodeType: iotDevices.nodeType, status: iotDevices.status,
    productName: iotProducts.name,
    lastSeenAt: iotDevices.lastSeenAt,
    reported: iotDeviceState.reported,
  }).from(iotDevices)
    .innerJoin(iotProducts, eq(iotDevices.productId, iotProducts.id))
    .leftJoin(iotDeviceState, eq(iotDevices.id, iotDeviceState.deviceId))
    .orderBy(desc(iotDevices.id))
    .limit(50);
  const onlineMap = await getOnlineMap(rows.map((r) => r.id));
  return rows.map((r) => ({
    sn: r.sn,
    name: r.name,
    product: r.productName,
    form: r.nodeType,
    enabled: r.status === 'enabled',
    online: onlineMap.get(r.id) ?? false,
    lastSeenAt: formatNullableDateTime(r.lastSeenAt),
    metrics: r.reported ?? {},
  }));
}

/** 活跃告警（firing/acknowledged）摘要 */
async function loadActiveAlarms() {
  const rows = await db.select({
    alarm: iotAlarms, deviceName: iotDevices.name, deviceSn: iotDevices.sn,
  }).from(iotAlarms)
    .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
    .where(inArray(iotAlarms.status, ['firing', 'acknowledged']))
    .orderBy(desc(iotAlarms.firedAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.alarm.id,
    rule: r.alarm.ruleName,
    device: `${r.deviceName}（${r.deviceSn}）`,
    level: IOT_ALARM_LEVEL_LABELS[r.alarm.level],
    status: IOT_ALARM_STATUS_LABELS[r.alarm.status],
    message: r.alarm.message,
    firedAt: formatDateTime(r.alarm.firedAt),
    acknowledged: !!r.alarm.acknowledgedAt,
  }));
}

/** 近 N 天设备事件（异常/故障优先） */
async function loadRecentEvents(days: number, anomalyOnly: boolean) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select({
    event: iotDeviceEvents, deviceName: iotDevices.name, deviceSn: iotDevices.sn,
  }).from(iotDeviceEvents)
    .innerJoin(iotDevices, eq(iotDeviceEvents.deviceId, iotDevices.id))
    .where(and(
      gte(iotDeviceEvents.reportedAt, since),
      anomalyOnly ? eq(iotDeviceEvents.kind, 'anomaly') : undefined,
    ))
    .orderBy(desc(iotDeviceEvents.reportedAt))
    .limit(50);
  return rows.map((r) => ({
    device: `${r.deviceName}（${r.deviceSn}）`,
    kind: r.event.kind,
    name: r.event.name,
    level: r.event.level,
    payload: r.event.payload ?? null,
    reportedAt: formatDateTime(r.event.reportedAt),
  }));
}

/** 设备/告警关键数字（回答"总体情况"类问题） */
async function loadIotStats() {
  const deviceTotal = await db.$count(iotDevices);
  const deviceRows = await db.select({ id: iotDevices.id }).from(iotDevices).where(eq(iotDevices.status, 'enabled'));
  const onlineMap = await getOnlineMap(deviceRows.map((r) => r.id));
  const online = [...onlineMap.values()].filter(Boolean).length;
  const firing = await db.$count(iotAlarms, eq(iotAlarms.status, 'firing'));
  const acked = await db.$count(iotAlarms, eq(iotAlarms.status, 'acknowledged'));
  return {
    deviceTotal,
    onlineCount: online,
    firingAlarms: firing,
    acknowledgedAlarms: acked,
  };
}

/** 注册 IoT 设备助手到 Mastra 实例（getMastra 初始化时调用） */
export async function registerIotAgent(mastra: Mastra): Promise<void> {
  const [{ Agent }, { createTool }, { z }] = await Promise.all([
    import('@mastra/core/agent'),
    import('@mastra/core/tools'),
    import('zod'),
  ]);
  const { getRawDefaultProviderConfig } = await import('../ai/ai-providers.service');
  const { buildModelChain } = await import('../../lib/ai/mastra-models');
  const { getChatMemory } = await import('../../lib/mastra');

  const cfg = await getRawDefaultProviderConfig();
  if (!cfg) {
    logger.warn('[iot-agent] no default provider config, skip iot agent registration');
    return;
  }
  const model = buildModelChain([{ source: cfg, model: cfg.defaultModel, maxRetries: 1, modelSettings: cfg.modelSettings }]);

  const deviceOverviewTool = createTool({
    id: 'iot_device_overview',
    description: '查询设备清单与实时状态：SN、名称、产品、形态、在线状态、最后在线时间、最新遥测快照（metrics）。回答"哪台设备XX最高/在线情况"类问题的数据来源',
    inputSchema: z.object({}),
    execute: async () => JSON.stringify(await loadDeviceOverview()),
  });

  const activeAlarmsTool = createTool({
    id: 'iot_active_alarms',
    description: '查询当前活跃告警（告警中 + 已认领未恢复）：规则、设备、级别、内容、触发时间、是否已认领',
    inputSchema: z.object({}),
    execute: async () => JSON.stringify(await loadActiveAlarms()),
  });

  const recentEventsTool = createTool({
    id: 'iot_recent_events',
    description: '查询近 N 天设备事件流；anomalyOnly=true 时仅返回异常检测事件（3σ 偏离基线，payload 含统计上下文 value/mean/std/sigma）',
    inputSchema: z.object({
      days: z.number().int().min(1).max(30).default(7).describe('时间窗（天）'),
      anomalyOnly: z.boolean().default(false).describe('仅异常检测事件'),
    }),
    execute: async (input) => JSON.stringify(await loadRecentEvents(input.days, input.anomalyOnly)),
  });

  const statsTool = createTool({
    id: 'iot_stats',
    description: '查询 IoT 总体统计：设备总数、在线数、告警中数量、已认领待处理数量',
    inputSchema: z.object({}),
    execute: async () => JSON.stringify(await loadIotStats()),
  });

  const iotAssistant = new Agent({
    id: 'iot-device-assistant',
    name: 'IoT 设备助手',
    description: '设备运维智能助手：设备状态、告警摘要、异常解读',
    instructions: [
      '你是 IoT 设备运维助手，用中文回答。',
      '- 回答任何设备/告警/事件问题前，先调用对应工具获取实时数据，严禁编造；',
      '- "哪台设备XX最高/最低"类问题：调用 iot_device_overview，比较各设备 metrics 中的对应属性后回答；',
      '- 告警问题调用 iot_active_alarms；异常/故障调用 iot_recent_events（异常事件的 payload 含 value/mean/std/sigma，向用户解释偏离程度）；',
      '- 总体情况调用 iot_stats；',
      '- 回答保持简洁，用列表呈现多条数据，必要时提示用户到「IoT 设备」菜单操作。',
    ].join('\n'),
    model,
    tools: {
      iot_device_overview: deviceOverviewTool,
      iot_active_alarms: activeAlarmsTool,
      iot_recent_events: recentEventsTool,
      iot_stats: statsTool,
    },
    memory: (() => getChatMemory()) as never,
  });

  mastra.addAgent(iotAssistant as never, 'iot-device-assistant');
  logger.info('[iot-agent] registered iot-device-assistant');
}
