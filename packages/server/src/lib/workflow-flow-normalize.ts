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
 * 流程定义 `flowData` 的写入归一（所有写入入口的唯一收口）。
 *
 * 只做**形状收敛**，不做业务校验：
 * - 指定成员统一到 `assigneeIds`：合并 `userIds` 后删除 `userIds`。
 *   设计器、审批链路、节点卡片只读 `assigneeIds`/`assigneeNames`，而引擎历史上同时接受
 *   `userIds`/`assigneeId`，导致 API / 导入写出的流程在界面上显示为「请选择成员」。
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
    const nodeData = data as JsonRecord;
    const merged = normalizeIdList(nodeData.assigneeIds, nodeData.userIds);
    if (merged) nodeData.assigneeIds = merged;
    else if ('assigneeIds' in nodeData && Array.isArray(nodeData.assigneeIds) && nodeData.assigneeIds.length === 0) {
      nodeData.assigneeIds = undefined;
    }
    if ('userIds' in nodeData) delete nodeData.userIds;
  }

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
 * 收集 flowData 中「指定成员」节点引用到的用户 id（用于补写姓名）。
 * 同时读 `assigneeIds` 与历史写法 `userIds`，因此既可对原始 flowData 调用，也可对归一后的结果调用。
 */
export function collectFlowAssigneeIds(flowData: unknown): number[] {
  if (!flowData || typeof flowData !== 'object') return [];
  const nodes = (flowData as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const ids = new Set<number>();
  for (const node of nodes as JsonRecord[]) {
    const data = node?.data as JsonRecord | undefined;
    if (!data || typeof data !== 'object') continue;
    const type = data.assigneeType;
    // 仅处理「指定成员」语义的节点（user 及未声明类型时的回退读取）
    if (type !== undefined && type !== 'user') continue;
    for (const raw of [
      ...(Array.isArray(data.assigneeIds) ? data.assigneeIds : []),
      ...(Array.isArray(data.userIds) ? data.userIds : []),
      data.assigneeId,
    ]) {
      const id = Number(raw);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * 为「指定成员」节点补写 `assigneeNames`（画布卡片、审批链路面板只读该字段）。
 * 姓名按 assigneeIds 顺序一一对应；查不到的退化为 `用户#id`，避免名字与 id 错位。
 */
export function applyFlowAssigneeNames(flowData: unknown, names: Map<number, string>): unknown {
  if (!flowData || typeof flowData !== 'object' || names.size === 0) return flowData;
  const cloned = flowData as JsonRecord;
  const nodes = Array.isArray(cloned.nodes) ? (cloned.nodes as JsonRecord[]) : [];
  for (const node of nodes) {
    const data = node?.data as JsonRecord | undefined;
    if (!data || typeof data !== 'object') continue;
    const type = data.assigneeType;
    if (type !== undefined && type !== 'user') continue;
    const ids = Array.isArray(data.assigneeIds) ? data.assigneeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
    if (ids.length === 0) continue;
    data.assigneeNames = ids.map((id) => names.get(id) ?? `用户#${id}`);
  }
  return cloned;
}


