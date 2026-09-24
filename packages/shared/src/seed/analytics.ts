import { ANALYTICS_EXPERIMENT_EXPOSURE_EVENT, ANALYTICS_SEMANTIC_EVENT_LABELS } from '../analytics/constants';
import { CMS_ATTRIBUTION_EVENTS, CMS_ATTRIBUTION_EVENT_LABELS } from '../cms/constants';
import type { AnalyticsSemanticEventName } from '../analytics/constants';
import type { AnalyticsSite, AnalyticsUserSegment } from '../analytics/contracts';
import type { AnalyticsEventPropertyDef } from '../analytics/validation';
import { SEED_DATE } from './_base';

// ─── 行为中心阶段 1：服务端权威语义事件 Tracking Plan 初始种子 ─────────────────
// 首批服务端事件（支付 / 工作流 / 会员关键操作）的事件字典契约，供 DB 种子与 MSW mock 共同派生，
// eventName 必须与 ANALYTICS_SEMANTIC_EVENT_NAMES（constants.ts）以及各来源事件总线订阅者产出的
// eventName 完全一致，否则 Tracking Plan 治理（propertySchema 校验）与事件字典展示会失配。
export interface SeedAnalyticsEventMeta {
  /** 仅供 MSW mock 内存列表展示排序使用，不写入 DB（DB 侧以 eventName 唯一索引 upsert，id 由数据库自增）*/
  id: number;
  eventName: AnalyticsSemanticEventName;
  displayName: string;
  category: 'payment' | 'workflow' | 'member' | 'system' | 'growth';
  description: string;
  propertySchema: AnalyticsEventPropertyDef[];
  strictMode: boolean;
}

const PAYMENT_BASE_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'orderNo', type: 'string', required: true, description: '支付订单号' },
  { key: 'bizType', type: 'string', required: true, description: '业务类型（如 member_recharge）' },
  { key: 'bizId', type: 'string', required: true, description: '业务记录主键' },
  { key: 'channel', type: 'string', description: '支付渠道' },
  { key: 'amount', type: 'number', required: true, description: '金额（分）' },
];

const REFUND_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'orderNo', type: 'string', required: true, description: '原支付订单号' },
  { key: 'bizType', type: 'string', description: '业务类型' },
  { key: 'bizId', type: 'string', description: '业务记录主键' },
  { key: 'refundNo', type: 'string', required: true, description: '退款单号' },
  { key: 'refundAmount', type: 'number', required: true, description: '退款金额（分）' },
];

const WORKFLOW_INSTANCE_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'instanceId', type: 'number', required: true, description: '流程实例 ID' },
  { key: 'definitionId', type: 'number', description: '流程定义 ID' },
  { key: 'status', type: 'string', description: '实例状态' },
];

const WORKFLOW_NODE_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'instanceId', type: 'number', required: true, description: '流程实例 ID' },
  { key: 'nodeKey', type: 'string', required: true, description: '节点 key' },
  { key: 'nodeName', type: 'string', description: '节点名称' },
  { key: 'nodeType', type: 'string', description: '节点类型' },
];

const WORKFLOW_TASK_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'instanceId', type: 'number', required: true, description: '流程实例 ID' },
  { key: 'taskId', type: 'number', required: true, description: '审批任务 ID' },
  { key: 'nodeKey', type: 'string', description: '所在节点 key' },
  { key: 'status', type: 'string', description: '任务状态' },
];

const MEMBER_POINTS_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
  { key: 'amount', type: 'number', required: true, description: '带符号变动量' },
  { key: 'balanceAfter', type: 'number', required: true, description: '变动后余额' },
  { key: 'bizType', type: 'string', description: '业务类型' },
  { key: 'bizId', type: 'string', description: '业务记录主键' },
];

const MEMBER_COUPON_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
  { key: 'couponId', type: 'number', required: true, description: '优惠券模板 ID' },
  { key: 'memberCouponId', type: 'number', description: '会员领券记录 ID' },
  { key: 'bizType', type: 'string', description: '核销业务类型' },
  { key: 'bizId', type: 'string', description: '核销业务记录主键' },
];

export const SEED_ANALYTICS_SITES: AnalyticsSite[] = [
  { id: 1, tenantId: null, tenantName: null, name: '管理后台', appId: 'admin', siteKey: 'zk_admin_default_0000000000000000', allowedOrigins: null, dailyEventQuota: null, todayUsage: 0, status: 'enabled', remark: '平台默认管理后台站点', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, tenantId: null, tenantName: null, name: '会员端', appId: 'member', siteKey: 'zk_member_default_000000000000000', allowedOrigins: null, dailyEventQuota: null, todayUsage: 0, status: 'enabled', remark: '平台默认会员端站点', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_ANALYTICS_EVENT_META: SeedAnalyticsEventMeta[] = [
  ...CMS_ATTRIBUTION_EVENTS.map((eventName, index): SeedAnalyticsEventMeta => ({ id: 1070 + index, eventName, displayName: CMS_ATTRIBUTION_EVENT_LABELS[eventName], category: 'growth', description: 'CMS 内容与发布版本的入口转化事件；表单及投票完成由服务端确认', strictMode: false, propertySchema: [
    { key: 'cmsSiteId', type: 'number', required: true, description: 'CMS 站点 ID' }, { key: 'contentId', type: 'number', description: '内容 ID' },
    { key: 'releaseId', type: 'number', description: '本次页面的发布单 ID' }, { key: 'deploymentId', type: 'number', description: '本次页面部署代次' },
    { key: 'entryPath', type: 'string', description: '会话入口路径' }, { key: 'entrySource', type: 'string', description: '入口来源' },
  ] })),
  // ── A/B 实验（source=web_*，SDK getVariant 自动上报）──
  { id: 1050, eventName: ANALYTICS_EXPERIMENT_EXPOSURE_EVENT, displayName: ANALYTICS_SEMANTIC_EVENT_LABELS[ANALYTICS_EXPERIMENT_EXPOSURE_EVENT], category: 'system', description: 'A/B 实验变体曝光（SDK getVariant 自动上报）', propertySchema: [
    { key: 'expKey', type: 'string', required: true, description: '实验标识' },
    { key: 'variantKey', type: 'string', required: true, description: '变体标识' },
  ], strictMode: true },
  // ── 导航失败语义事件（source=web_*，404/403 页面组件上报）──
  { id: 1051, eventName: 'page_not_found', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS.page_not_found, category: 'system', description: '访问了不存在的路由（NotFoundPage 上报），用于发现失效链接与错误跳转', propertySchema: [
    { key: 'path', type: 'string', required: true, description: '被访问的原始路径' },
  ], strictMode: false },
  { id: 1052, eventName: 'page_forbidden', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS.page_forbidden, category: 'system', description: '无权限访问被拦截（ForbiddenPage 上报），用于发现权限配置缺口与越权尝试', propertySchema: [
    { key: 'path', type: 'string', required: true, description: '被拦截的路径' },
  ], strictMode: false },
  // ── 支付中心（source=server，来自 paymentEventBus）──
  { id: 1001, eventName: 'payment.succeeded', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['payment.succeeded'], category: 'payment', description: '支付订单支付成功（服务端权威事件，来自 paymentEventBus）', propertySchema: PAYMENT_BASE_SCHEMA, strictMode: false },
  { id: 1002, eventName: 'payment.closed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['payment.closed'], category: 'payment', description: '支付订单超时关闭（服务端权威事件，来自 paymentEventBus）', propertySchema: PAYMENT_BASE_SCHEMA, strictMode: false },
  { id: 1003, eventName: 'payment.failed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['payment.failed'], category: 'payment', description: '支付订单支付失败（服务端权威事件，来自 paymentEventBus）', propertySchema: PAYMENT_BASE_SCHEMA, strictMode: false },
  { id: 1004, eventName: 'refund.succeeded', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['refund.succeeded'], category: 'payment', description: '退款成功（服务端权威事件，来自 paymentEventBus）', propertySchema: REFUND_SCHEMA, strictMode: false },
  { id: 1005, eventName: 'refund.failed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['refund.failed'], category: 'payment', description: '退款失败（服务端权威事件，来自 paymentEventBus）', propertySchema: REFUND_SCHEMA, strictMode: false },
  // ── 工作流（source=server，来自 workflowEventBus，经 event_dispatch 作业投递）──
  { id: 1010, eventName: 'workflow.instance.created', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.created'], category: 'workflow', description: '流程实例发起（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1011, eventName: 'workflow.instance.approved', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.approved'], category: 'workflow', description: '流程实例审批通过（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1012, eventName: 'workflow.instance.rejected', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.rejected'], category: 'workflow', description: '流程实例被驳回（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1013, eventName: 'workflow.instance.withdrawn', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.withdrawn'], category: 'workflow', description: '流程实例被撤回（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1014, eventName: 'workflow.node.entered', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.node.entered'], category: 'workflow', description: '流程节点进入（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_NODE_SCHEMA, strictMode: false },
  { id: 1015, eventName: 'workflow.node.left', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.node.left'], category: 'workflow', description: '流程节点离开（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_NODE_SCHEMA, strictMode: false },
  { id: 1016, eventName: 'workflow.task.created', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.created'], category: 'workflow', description: '审批任务创建（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1017, eventName: 'workflow.task.assigned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.assigned'], category: 'workflow', description: '审批任务分配（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1018, eventName: 'workflow.task.approved', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.approved'], category: 'workflow', description: '审批任务通过（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1019, eventName: 'workflow.task.rejected', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.rejected'], category: 'workflow', description: '审批任务驳回（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1020, eventName: 'workflow.task.skipped', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.skipped'], category: 'workflow', description: '审批任务自动跳过（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1021, eventName: 'workflow.task.transferred', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.transferred'], category: 'workflow', description: '审批任务转办/改派（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1022, eventName: 'workflow.task.addSigned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.addSigned'], category: 'workflow', description: '审批任务加签（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1023, eventName: 'workflow.task.reduceSigned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.reduceSigned'], category: 'workflow', description: '审批任务减签（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1024, eventName: 'workflow.task.urged', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.urged'], category: 'workflow', description: '审批任务催办（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  // ── 会员关键操作（source=server，业务 service 成功后直接调用）──
  { id: 1030, eventName: 'member.registered', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.registered'], category: 'member', description: '会员注册成功（服务端权威事件）', propertySchema: [
    { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
    { key: 'source', type: 'string', description: '注册来源' },
    { key: 'hasPhone', type: 'boolean', description: '是否绑定手机号' },
    { key: 'hasEmail', type: 'boolean', description: '是否绑定邮箱' },
  ], strictMode: false },
  { id: 1031, eventName: 'member.profile.updated', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.profile.updated'], category: 'member', description: '会员资料更新（服务端权威事件，不含具体字段值）', propertySchema: [
    { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
    { key: 'changedFields', type: 'array', description: '本次变更的字段名列表（不含值）' },
  ], strictMode: false },
  { id: 1032, eventName: 'member.points.earned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.earned'], category: 'member', description: '会员积分获得（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1033, eventName: 'member.points.redeemed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.redeemed'], category: 'member', description: '会员积分消费（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1034, eventName: 'member.points.adjusted', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.adjusted'], category: 'member', description: '会员积分人工调整（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1035, eventName: 'member.points.expired', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.expired'], category: 'member', description: '会员积分过期清零（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1036, eventName: 'member.points.refunded', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.refunded'], category: 'member', description: '会员积分退回（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1037, eventName: 'member.coupon.received', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.coupon.received'], category: 'member', description: '会员领取优惠券（服务端权威事件）', propertySchema: MEMBER_COUPON_SCHEMA, strictMode: false },
  { id: 1038, eventName: 'member.coupon.redeemed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.coupon.redeemed'], category: 'member', description: '会员核销优惠券（服务端权威事件）', propertySchema: MEMBER_COUPON_SCHEMA, strictMode: false },
  { id: 1039, eventName: 'member.checkin.completed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.checkin.completed'], category: 'member', description: '会员签到完成（服务端权威事件）', propertySchema: [
    { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
    { key: 'consecutiveDays', type: 'number', description: '连续签到天数' },
    { key: 'pointsAwarded', type: 'number', description: '本次奖励积分' },
    { key: 'experienceAwarded', type: 'number', description: '本次奖励经验值' },
    { key: 'checkinDate', type: 'string', description: '签到日期（YYYY-MM-DD）' },
  ], strictMode: false },
  { id: 1060, eventName: 'shortlink.link.clicked', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['shortlink.link.clicked'], category: 'growth', description: '短链跳转成功（服务端权威事件，爬虫流量不上报）', propertySchema: [
    { key: 'linkId', type: 'number', required: true, description: '短链 ID' },
    { key: 'code', type: 'string', required: true, description: '短码' },
    { key: 'bizType', type: 'string', description: '来源业务类型（custom/sms/broadcast/payment_link/cms_content）' },
    { key: 'bizRef', type: 'string', description: '来源业务标识' },
    { key: 'deviceType', type: 'string', description: '设备类型' },
    { key: 'os', type: 'string', description: '操作系统' },
    { key: 'browser', type: 'string', description: '浏览器' },
    { key: 'country', type: 'string', description: '国家' },
    { key: 'province', type: 'string', description: '省份' },
    { key: 'city', type: 'string', description: '城市' },
  ], strictMode: false },
];

// ─── 内置用户分群（圈选规则种子）───────────────────────────────────────────────
// 全部基于服务端权威语义事件与身份属性，装机即可用（点「重算」即物化成员快照）；
// 覆盖三种规则形态：单事件条件 / 属性条件 / 属性 × 事件组合。
export const SEED_ANALYTICS_SEGMENTS: AnalyticsUserSegment[] = [
  {
    id: 1,
    tenantId: null,
    name: '短链点击人群',
    description: '近 30 天点击过任意短链的用户（事件 shortlink.link.clicked），适合渠道再触达',
    rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'shortlink.link.clicked', days: 30, minCount: 1 }] },
    status: 'enabled',
    estimatedSize: 0,
    snapshotAt: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    tenantId: null,
    name: '新注册会员',
    description: '近 30 天完成注册的会员（事件 member.registered），适合新人引导与首单转化',
    rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'member.registered', days: 30, minCount: 1 }] },
    status: 'enabled',
    estimatedSize: 0,
    snapshotAt: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    tenantId: null,
    name: '签到活跃会员',
    description: '近 30 天签到不少于 3 次的会员（事件 member.checkin.completed），高粘性人群',
    rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'member.checkin.completed', days: 30, minCount: 3 }] },
    status: 'enabled',
    estimatedSize: 0,
    snapshotAt: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 4,
    tenantId: null,
    name: '支付成功用户',
    description: '近 90 天有成功支付记录的用户（事件 payment.succeeded），适合复购与会员权益运营',
    rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'payment.succeeded', days: 90, minCount: 1 }] },
    status: 'enabled',
    estimatedSize: 0,
    snapshotAt: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 5,
    tenantId: null,
    name: '优惠券核销会员',
    description: '近 90 天核销过优惠券的会员（事件 member.coupon.redeemed），券敏感人群',
    rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'member.coupon.redeemed', days: 90, minCount: 1 }] },
    status: 'enabled',
    estimatedSize: 0,
    snapshotAt: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 6,
    tenantId: null,
    name: '全部前台会员',
    description: '身份类型为前台会员的全部用户（属性条件示例）',
    rules: { operator: 'AND', conditions: [{ type: 'attribute', field: 'identityType', op: 'eq', value: 'member' }] },
    status: 'enabled',
    estimatedSize: 0,
    snapshotAt: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 7,
    tenantId: null,
    name: '点击短链的会员',
    description: '会员身份且近 30 天点击过短链（属性 × 事件组合示例），营销触达优选人群',
    rules: {
      operator: 'AND',
      conditions: [
        { type: 'attribute', field: 'identityType', op: 'eq', value: 'member' },
        { type: 'event', eventName: 'shortlink.link.clicked', days: 30, minCount: 1 },
      ],
    },
    status: 'enabled',
    estimatedSize: 0,
    snapshotAt: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];
