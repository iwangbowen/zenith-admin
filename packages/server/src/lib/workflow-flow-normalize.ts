type JsonRecord = Record<string, unknown>;

/** 条件值归一：数组 → 逗号分隔串（契约 value = string | number | boolean，多值用逗号串表达） */
function normalizeConditionValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .join(',');
}

/** 解析正整数字段（去重 + 排序稳定） */
function normalizeIdList(value: unknown, extra: unknown): number[] | undefined {
  const ids = new Set<number>();
  for (const list of [value, extra]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const id = Number(raw);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return ids.size > 0 ? [...ids] : undefined;
}

/**
 * 指定成员字段归一：`userIds` 合并进 `assigneeIds` 后删除 `userIds`。
 * 扁平节点的 `data` 与设计器树的 `props` 是同一份定义的两种表达，共用该逻辑。
 */
function normalizeAssigneeFields(container: JsonRecord): void {
  const merged = normalizeIdList(container.assigneeIds, container.userIds);
  if (merged) container.assigneeIds = merged;
  else if (Array.isArray(container.assigneeIds) && container.assigneeIds.length === 0) {
    container.assigneeIds = undefined;
  }
  if ('userIds' in container) delete container.userIds;
}

/**
 * 深度遍历设计器保存的 `process` 树（initiator → children / branches[].children）。
 * 画布读 `process`，运行时与引擎读扁平 `nodes`/`edges`：两者必须同步归一，
 * 否则画布会拿旧写法渲染成「请选择成员」，保存时又会把旧写法带回扁平节点。
 */
function walkProcessNodes(process: unknown, visit: (node: JsonRecord) => void): void {
  const initiator = (process as { initiator?: unknown } | null | undefined)?.initiator;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const record = node as JsonRecord;
    visit(record);
    walk(record.children);
    if (Array.isArray(record.branches)) {
      for (const branch of record.branches) {
        if (branch && typeof branch === 'object') walk((branch as JsonRecord).children);
      }
    }
  };
  walk(initiator);
}

/**
 * 流程定义 `flowData` 的写入归一（所有写入入口的唯一收口）。
 *
 * 只做**形状收敛**，不做业务校验：
 * - 指定成员统一到 `assigneeIds`：合并 `userIds` 后删除 `userIds`。
 *   设计器、审批链路、节点卡片只读 `assigneeIds`/`assigneeNames`，而引擎历史上同时接受
 *   `userIds`/`assigneeId`，导致 API / 导入写出的流程在界面上显示为「请选择成员」。
 *   扁平 `nodes` 与设计器树 `process` 同时处理（画布只读 `process`）。
 * - 条件值数组 → 逗号分隔串：数组会让 `in`/`notIn` 比较恒不成立并**静默**走默认分支。
 *
 * 幂等：可重复调用；非法输入原样返回。
 */
export function normalizeDefinitionFlowData(flowData: unknown): unknown {
  if (!flowData || typeof flowData !== 'object' || Array.isArray(flowData)) return flowData;
  const cloned = JSON.parse(JSON.stringify(flowData)) as JsonRecord;

  const nodes = Array.isArray(cloned.nodes) ? (cloned.nodes as JsonRecord[]) : [];
  for (const node of nodes) {
    const data = node?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    normalizeAssigneeFields(data as JsonRecord);
  }

  walkProcessNodes(cloned.process, (node) => {
    const props = node.props;
    if (!props || typeof props !== 'object' || Array.isArray(props)) return;
    normalizeAssigneeFields(props as JsonRecord);
  });

  const edges = Array.isArray(cloned.edges) ? (cloned.edges as JsonRecord[]) : [];
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') continue;
    const condition = edge.condition as JsonRecord | null | undefined;
    if (condition && typeof condition === 'object' && 'value' in condition) {
      condition.value = normalizeConditionValue(condition.value);
    }
    const groups = Array.isArray(edge.conditions) ? (edge.conditions as JsonRecord[]) : [];
    for (const group of groups) {
      const rules = Array.isArray(group?.rules) ? (group.rules as JsonRecord[]) : [];
      for (const rule of rules) {
        if (rule && typeof rule === 'object' && 'value' in rule) {
          rule.value = normalizeConditionValue(rule.value);
        }
      }
    }
  }

  return cloned;
}

/**
 * 从「节点配置容器」（扁平节点的 data / 设计器树的 props）收集指定成员 id。
 * 仅处理「指定成员」语义的节点（user 及未声明类型时的回退读取）。
 */
function collectAssigneeIds(container: JsonRecord, ids: Set<number>): void {
  const type = container.assigneeType;
  if (type !== undefined && type !== 'user') return;
  for (const raw of [
    ...(Array.isArray(container.assigneeIds) ? container.assigneeIds : []),
    ...(Array.isArray(container.userIds) ? container.userIds : []),
    container.assigneeId,
  ]) {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
}

/**
 * 收集 flowData 中「指定成员」节点引用到的用户 id（用于补写姓名）。
 * 同时读 `assigneeIds`、历史写法 `userIds`，并覆盖扁平 `nodes` 与设计器树 `process`，
 * 因此既可对原始 flowData 调用，也可对归一后的结果调用。
 */
export function collectFlowAssigneeIds(flowData: unknown): number[] {
  if (!flowData || typeof flowData !== 'object') return [];
  const ids = new Set<number>();
  const record = flowData as { nodes?: unknown; process?: unknown };
  if (Array.isArray(record.nodes)) {
    for (const node of record.nodes as JsonRecord[]) {
      const data = node?.data as JsonRecord | undefined;
      if (!data || typeof data !== 'object') continue;
      collectAssigneeIds(data, ids);
    }
  }
  walkProcessNodes(record.process, (node) => {
    const props = node.props;
    if (!props || typeof props !== 'object' || Array.isArray(props)) return;
    collectAssigneeIds(props as JsonRecord, ids);
  });
  return [...ids];
}

/**
 * 为「指定成员」容器补写 `assigneeNames`（按 assigneeIds 顺序一一对应）。
 * 姓名查不到时退化为 `用户#id`，避免名字与 id 错位。
 */
function applyAssigneeNames(container: JsonRecord, names: Map<number, string>): void {
  const type = container.assigneeType;
  if (type !== undefined && type !== 'user') return;
  const ids = Array.isArray(container.assigneeIds) ? container.assigneeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
  if (ids.length === 0) return;
  container.assigneeNames = ids.map((id) => names.get(id) ?? `用户#${id}`);
}

/**
 * 为「指定成员」节点补写 `assigneeNames`（画布卡片、审批链路面板只读该字段）。
 * 覆盖扁平 `nodes` 与设计器树 `process`：画布渲染只读树的 `props.assigneeNames`。
 */
export function applyFlowAssigneeNames(flowData: unknown, names: Map<number, string>): unknown {
  if (!flowData || typeof flowData !== 'object' || names.size === 0) return flowData;
  const cloned = flowData as JsonRecord;
  const nodes = Array.isArray(cloned.nodes) ? (cloned.nodes as JsonRecord[]) : [];
  for (const node of nodes) {
    const data = node?.data as JsonRecord | undefined;
    if (!data || typeof data !== 'object') continue;
    applyAssigneeNames(data, names);
  }
  walkProcessNodes(cloned.process, (node) => {
    const props = node.props;
    if (!props || typeof props !== 'object' || Array.isArray(props)) return;
    applyAssigneeNames(props as JsonRecord, names);
  });
  return cloned;
}


