/**
 * 规则中心通用常量（SSOT）：统一求值门面的资产类型与执行留痕来源。
 * validation / 契约实体通过 z.enum() 引用，前端展示复用 labels。
 */

/** 可求值的规则资产类型：决策表 / 决策流 / 评分卡 / 名单 */
export const RULE_REF_KINDS = ['table', 'flow', 'scorecard', 'list'] as const;

export type RuleRefKind = typeof RULE_REF_KINDS[number];

export const RULE_REF_KIND_LABELS: Record<RuleRefKind, string> = {
  table: '决策表', flow: '决策流', scorecard: '评分卡', list: '名单',
};

/** 执行留痕来源：runtime=业务运行时；manual=后台按 key 求值；test=测试求值；open=开放平台 */
export const RULE_EXECUTION_SOURCES = ['runtime', 'manual', 'test', 'open'] as const;

export type RuleExecutionSource = typeof RULE_EXECUTION_SOURCES[number];

export const RULE_EXECUTION_SOURCE_LABELS: Record<RuleExecutionSource, string> = {
  runtime: '运行时', manual: '手动', test: '测试', open: '开放平台',
};

/** 内置调用方标识 → 展示名；open.{clientId} 由服务端解析为 open.{应用名} */
export const RULE_CALLER_LABELS: Record<string, string> = {
  'admin.test': '后台测试',
  'admin.evaluate': '后台求值',
  'workflow.gateway': '工作流网关',
  'workflow.assignee': '工作流审批人解析',
  'member.coupon': '优惠券资格判定',
  'member.auth': '会员认证风控',
  'payment.risk': '支付风控',
  'cms.submit': 'CMS 提交守卫',
  'payment.dispute': '争议智能分流',
};

// ─── 决策表 ───────────────────────────────────────────────────────────────────

/** 命中策略：first=首个命中；unique=唯一命中；priority=按优先级；collect=收集全部；any=任一（输出须一致） */
export const RULE_HIT_POLICIES = ['first', 'unique', 'priority', 'collect', 'any'] as const;

/** 规则资产（决策表 / 决策流 / 评分卡）的生命周期状态 */
export const RULE_DECISION_STATUSES = ['draft', 'published', 'disabled'] as const;

export const RULE_FIELD_TYPES = ['string', 'number', 'boolean', 'date'] as const;

/** collect 策略聚合方式：list=输出数组（默认）；sum/min/max 数值聚合；count=命中行数；distinct=去重数组 */
export const RULE_COLLECT_AGGREGATES = ['list', 'sum', 'min', 'max', 'count', 'distinct'] as const;

/** 求值未命中/冲突原因：no_match=无行命中；unique_conflict=唯一命中策略下命中多行；any_conflict=any 策略下多行输出不一致 */
export const RULE_EVALUATE_REASONS = ['no_match', 'unique_conflict', 'any_conflict'] as const;

/** 决策表引用方类型（where-used 分析） */
export const RULE_USAGE_TYPES = ['workflow', 'coupon', 'paymentRisk'] as const;

/** 版本 diff 的变更对象 / 变更类型 */
export const RULE_VERSION_CHANGE_KINDS = ['input', 'output', 'rule', 'meta'] as const;

export const RULE_VERSION_CHANGE_OPS = ['added', 'removed', 'changed'] as const;

/** 发布审批（四眼）状态：pending=待审批 */
export const RULE_REVIEW_STATUSES = ['pending'] as const;

/** 灰度操作：complete=转正（新版本全量）；cancel=取消灰度（全量回旧版本） */
export const RULE_GRAY_ACTIONS = ['complete', 'cancel'] as const;

// ─── 决策流 ───────────────────────────────────────────────────────────────────

/** 步骤跳过原因：condition=条件不满足；unavailable=决策表不可用；error=执行异常 */
export const RULE_FLOW_SKIP_REASONS = ['condition', 'unavailable', 'error'] as const;

/** 拥有版本快照的资产类型（决策流 / 评分卡） */
export const RULE_ASSET_VERSION_KINDS = ['flow', 'scorecard'] as const;

// ─── 评分卡 ───────────────────────────────────────────────────────────────────

/** 分段匹配方式：range=数值区间[min,max)；eq=等值；in=集合；default=兜底恒中 */
export const RULE_SCORECARD_BAND_OPS = ['range', 'eq', 'in', 'default'] as const;

export const RULE_SCORECARD_VARIABLE_TYPES = ['number', 'string', 'boolean'] as const;

// ─── 名单库 ───────────────────────────────────────────────────────────────────

export const RULE_LIST_TYPES = ['black', 'white', 'grey'] as const;

/** 条目匹配模式：exact=精确；prefix=前缀；regex=正则 */
export const RULE_LIST_MATCH_MODES = ['exact', 'prefix', 'regex'] as const;
