/**
 * 条件规则编辑器 — 可视化配置分支条件
 *
 * 支持：
 * - 多条件组（AND/OR 逻辑切换）
 * - 条件字段从流程表单字段动态生成
 * - 运算符选择 + 值输入
 */
import { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Select, SideSheet, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ConditionGroup, ConditionRule, ConditionOperator, FlowBranch } from '../types';
import { OPERATOR_LABELS, STARTER_CONDITION_FIELDS } from '../constants';

interface FormField {
  key: string;
  label: string;
  type: string;
  options?: string[];
}

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }
interface DeptOption { id: number; name: string; }
interface PositionOption { id: number; name: string; }

interface ConditionEditorProps {
  visible: boolean;
  branch: FlowBranch | null;
  formFields: FormField[];
  users?: UserOption[];
  roles?: RoleOption[];
  departments?: DeptOption[];
  positions?: PositionOption[];
  onSave: (branchId: string, updates: { name: string; conditions: ConditionGroup[] }) => void;
  onCancel: () => void;
}

const operatorOptions = Object.entries(OPERATOR_LABELS).map(([value, label]) => ({ value, label }));
const NUMERIC_OPERATORS: ConditionOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'];
const DATE_OPERATORS: ConditionOperator[] = ['eq', 'neq', 'withinDays', 'beforeDays', 'isEmpty', 'isNotEmpty'];
const OPTION_OPERATORS: ConditionOperator[] = ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];
const TEXT_OPERATORS: ConditionOperator[] = ['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty'];
const COMPLEX_OPERATORS: ConditionOperator[] = ['isEmpty', 'isNotEmpty'];
/** 发起人维度仅支持 属于/不属于 */
const STARTER_OPERATOR_OPTIONS = [
  { value: 'in', label: '属于' },
  { value: 'notIn', label: '不属于' },
];

const AGGREGATE_OPTIONS = [
  { value: 'none',  label: '无' },
  { value: 'sum',   label: '合计' },
  { value: 'count', label: '计数' },
  { value: 'avg',   label: '平均' },
];

const EMPTY_RULE: ConditionRule = { field: '', operator: 'eq', value: '' };
const DEFAULT_GROUP: ConditionGroup = { type: 'and', rules: [{ ...EMPTY_RULE }] };

let ruleKeyCounter = 0;
function nextRuleKey() {
  return `rule-${++ruleKeyCounter}`;
}
let groupKeyCounter = 0;
function nextGroupKey() {
  return `group-${++groupKeyCounter}`;
}

function initGroups(branch: FlowBranch | null): ConditionGroup[] {
  if (branch?.conditions?.length) return structuredClone(branch.conditions);
  return [{ ...DEFAULT_GROUP, rules: [{ ...EMPTY_RULE }] }];
}

/** 顶层函数：替换指定 group 中的某条 rule（减少嵌套层级） */
function replaceRuleInGroup(group: ConditionGroup, ruleIndex: number, updates: Partial<ConditionRule>): ConditionGroup {
  const newRules = group.rules.map((r, ri) =>
    ri === ruleIndex ? { ...r, ...updates } : r
  );
  return { ...group, rules: newRules };
}

function isComplexFieldType(type: string | undefined): boolean {
  return ['table', 'subtable', 'array', 'object', 'upload', 'file', 'image'].includes(type ?? '');
}

function operatorsForField(field: FormField | undefined, aggregate?: ConditionRule['aggregate']): Array<{ value: string; label: string }> {
  if (aggregate) {
    const allowed = aggregate === 'count' ? NUMERIC_OPERATORS.filter((op) => op !== 'isEmpty' && op !== 'isNotEmpty') : NUMERIC_OPERATORS;
    return operatorOptions.filter((op) => allowed.includes(op.value as ConditionOperator));
  }
  if (!field) return operatorOptions;
  let allowed: ConditionOperator[];
  if (field.type === 'number') allowed = NUMERIC_OPERATORS;
  else if (field.type === 'date' || field.type === 'datetime') allowed = DATE_OPERATORS;
  else if (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') allowed = OPTION_OPERATORS;
  else if (isComplexFieldType(field.type)) allowed = COMPLEX_OPERATORS;
  else allowed = TEXT_OPERATORS;
  return operatorOptions.filter((op) => allowed.includes(op.value as ConditionOperator));
}

function normalizeOperatorForField(rule: ConditionRule, field: FormField | undefined): ConditionOperator {
  const options = rule.source === 'starter' ? STARTER_OPERATOR_OPTIONS : operatorsForField(field, rule.aggregate);
  return options.some((op) => op.value === rule.operator) ? rule.operator : options[0].value as ConditionOperator;
}

/** 顶层函数：移除指定 group 中的某条 rule */
function removeRuleFromGroup(group: ConditionGroup, ruleIndex: number): ConditionGroup {
  const newRules = group.rules.filter((_, ri) => ri !== ruleIndex);
  return { ...group, rules: newRules.length > 0 ? newRules : [{ ...EMPTY_RULE }] };
}

/** 顶层函数：按 index 移除数组项 */
function filterByIndex<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

export default function ConditionEditor({
  visible,
  branch,
  formFields,
  users = [],
  roles = [],
  departments = [],
  positions = [],
  onSave,
  onCancel,
}: Readonly<ConditionEditorProps>) {
  const [name, setName] = useState<string>(branch?.name ?? '');
  const [groups, setGroups] = useState<ConditionGroup[]>(() => initGroups(branch));
  const [groupKeys, setGroupKeys] = useState<string[]>(() => initGroups(branch).map(() => nextGroupKey()));
  const [ruleKeys, setRuleKeys] = useState<string[][]>(() =>
    initGroups(branch).map(g => g.rules.map(() => nextRuleKey()))
  );

  // 当 branch 变化时重新初始化
  useEffect(() => {
    const g = initGroups(branch);
    setName(branch?.name ?? '');
    setGroups(g);
    setGroupKeys(g.map(() => nextGroupKey()));
    setRuleKeys(g.map(gr => gr.rules.map(() => nextRuleKey())));
  }, [branch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGroupTypeToggle = (groupIndex: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? { ...g, type: g.type === 'and' ? 'or' : 'and' } : g
    ));
  };

  const handleAddRule = (groupIndex: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? { ...g, rules: [...g.rules, { ...EMPTY_RULE }] } : g
    ));
    setRuleKeys(prev => prev.map((keys, i) =>
      i === groupIndex ? [...keys, nextRuleKey()] : keys
    ));
  };

  const handleRemoveRule = (groupIndex: number, ruleIndex: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? removeRuleFromGroup(g, ruleIndex) : g
    ));
    setRuleKeys(prev => prev.map((keys, i) =>
      i === groupIndex ? filterByIndex(keys, ruleIndex) : keys
    ));
  };

  const updateRule = (groupIndex: number, ruleIndex: number, updates: Partial<ConditionRule>) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? replaceRuleInGroup(g, ruleIndex, updates) : g
    ));
  };

  /** 字段选择变化：解析 form:/starter: 前缀，切换来源时重置运算符与值 */
  const handleFieldChange = (groupIndex: number, ruleIndex: number, val: string) => {
    if (val.startsWith('starter:')) {
      updateRule(groupIndex, ruleIndex, { source: 'starter', field: val.slice('starter:'.length), operator: 'in', value: '' });
    } else {
      const key = val.startsWith('form:') ? val.slice('form:'.length) : val;
      const field = formFields.find((item) => item.key === key);
      updateRule(groupIndex, ruleIndex, { source: 'form', field: key, operator: normalizeOperatorForField({ ...EMPTY_RULE, field: key }, field), value: '' });
    }
  };

  const handleAddGroup = () => {
    setGroups(prev => [...prev, { ...DEFAULT_GROUP, rules: [{ ...EMPTY_RULE }] }]);
    setGroupKeys(prev => [...prev, nextGroupKey()]);
    setRuleKeys(prev => [...prev, [nextRuleKey()]]);
  };

  const handleRemoveGroup = (groupIndex: number) => {
    setGroups(prev => {
      const updated = prev.filter((_, i) => i !== groupIndex);
      return updated.length > 0 ? updated : [{ ...DEFAULT_GROUP, rules: [{ ...EMPTY_RULE }] }];
    });
    setGroupKeys(prev => {
      const updated = prev.filter((_, i) => i !== groupIndex);
      return updated.length > 0 ? updated : [nextGroupKey()];
    });
    setRuleKeys(prev => {
      const updated = prev.filter((_, i) => i !== groupIndex);
      return updated.length > 0 ? updated : [[nextRuleKey()]];
    });
  };

  const handleSave = () => {
    if (!branch) return;
    // 过滤掉空条件
    const cleaned = groups
      .map(g => ({
        ...g,
        rules: g.rules.filter((r) => {
          if (r.field === '') return false;
          if (r.source === 'starter') return STARTER_OPERATOR_OPTIONS.some((op) => op.value === r.operator);
          const field = formFields.find((item) => item.key === r.field);
          return operatorsForField(field, r.aggregate).some((op) => op.value === r.operator);
        }),
      }))
      .filter(g => g.rules.length > 0);
    const trimmedName = name.trim() || branch.name;
    onSave(branch.id, { name: trimmedName, conditions: cleaned });
  };

  return (
    <SideSheet
      title={`条件配置 — ${branch?.name ?? ''}`}
      visible={visible}
      onCancel={onCancel}
      placement="right"
      width={520}
      className="fd-config-drawer"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 0' }}>
          <button type="button" className="fd-drawer-btn fd-drawer-btn--cancel" onClick={onCancel}>取消</button>
          <button type="button" className="fd-drawer-btn fd-drawer-btn--save" onClick={handleSave}>保存</button>
        </div>
      }
    >
      {branch?.isDefault ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--semi-color-text-2)' }}>
          <Typography.Title heading={6}>默认分支</Typography.Title>
          <Typography.Text type="tertiary">
            当其他分支条件都不满足时，将进入此分支，无需配置条件。
          </Typography.Text>
        </div>
      ) : (
        <div className="fd-condition-editor">
          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>分支名称</Typography.Text>
            <Input
              value={name}
              onChange={setName}
              placeholder="请输入分支名称"
              maxLength={20}
              showClear
            />
          </div>
          {groups.map((group, gi) => (
            <div key={groupKeys[gi]} className="fd-condition-group">
              {/* 条件组头部 */}
              <div className="fd-condition-group__header">
                <button
                  type="button"
                  className="fd-condition-logic-btn"
                  onClick={() => handleGroupTypeToggle(gi)}
                >
                  {group.type === 'and' ? '且 (AND)' : '或 (OR)'}
                </button>
                {groups.length > 1 && (
                  <button
                    type="button"
                    className="fd-condition-remove-group"
                    onClick={() => handleRemoveGroup(gi)}
                    title="删除条件组"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* 条件规则列表 */}
              {group.rules.map((rule, ri) => {
                const field = formFields.find((item) => item.key === rule.field);
                const currentOperatorOptions = rule.source === 'starter' ? STARTER_OPERATOR_OPTIONS : operatorsForField(field, rule.aggregate);
                const operatorUnsupported = !currentOperatorOptions.some((op) => op.value === rule.operator);
                return (
                <div key={ruleKeys[gi]?.[ri] ?? ri} className="fd-condition-rule" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  {/* 主控件行 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Select
                      value={rule.source === 'starter'
                        ? `starter:${rule.field}`
                        : (rule.field ? `form:${rule.field}` : undefined)}
                      onChange={(v) => handleFieldChange(gi, ri, v as string)}
                      placeholder="选择字段"
                      style={{ width: 150 }}
                      size="small"
                    >
                      {formFields.length > 0 && (
                        <Select.OptGroup label="表单字段">
                          {formFields.map(f => (
                            <Select.Option key={`form:${f.key}`} value={`form:${f.key}`}>{f.label}</Select.Option>
                          ))}
                        </Select.OptGroup>
                      )}
                      <Select.OptGroup label="发起人维度">
                        {STARTER_CONDITION_FIELDS.map(s => (
                          <Select.Option key={`starter:${s.value}`} value={`starter:${s.value}`}>{s.label}</Select.Option>
                        ))}
                      </Select.OptGroup>
                    </Select>
                    <Select
                      value={operatorUnsupported ? undefined : rule.operator}
                      onChange={(v) => updateRule(gi, ri, { operator: v as ConditionOperator, value: '' })}
                      optionList={currentOperatorOptions}
                      placeholder="选择条件"
                      style={{ width: 100 }}
                      size="small"
                    />
                    {renderValueInput(rule, formFields, { users, roles, departments, positions }, (v) => updateRule(gi, ri, { value: v }))}
                    <button
                      type="button"
                      className="fd-condition-rule__remove"
                      onClick={() => handleRemoveRule(gi, ri)}
                      title="删除条件"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {/* 聚合控件行 — 仅表单来源规则 */}
                  {rule.source !== 'starter' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 2 }}>
                      <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', flexShrink: 0 }}>聚合</span>
                      <Select
                        value={rule.aggregate ?? 'none'}
                        onChange={(v) => {
                          if (v === 'none') {
                            const nextRule = { ...rule, aggregate: undefined, aggregateField: undefined };
                            updateRule(gi, ri, { aggregate: undefined, aggregateField: undefined, operator: normalizeOperatorForField(nextRule, field) });
                          } else {
                            const nextRule = { ...rule, aggregate: v as 'sum' | 'count' | 'avg' };
                            updateRule(gi, ri, { aggregate: nextRule.aggregate, operator: normalizeOperatorForField(nextRule, field) });
                          }
                        }}
                        optionList={AGGREGATE_OPTIONS}
                        style={{ width: 90 }}
                        size="small"
                      />
                      {rule.aggregate && rule.aggregate !== 'count' && (
                        <Input
                          value={rule.aggregateField ?? ''}
                          onChange={(v) => updateRule(gi, ri, { aggregateField: v })}
                          placeholder="聚合列"
                          style={{ flex: 1 }}
                          size="small"
                        />
                      )}
                    </div>
                  )}
                  {operatorUnsupported && (
                    <Typography.Text type="warning" size="small">
                      当前字段类型不支持该操作符，请重新选择条件。
                    </Typography.Text>
                  )}
                </div>
              );})}

              {/* 添加条件按钮 */}
              <Button
                type="tertiary"
                size="small"
                icon={<Plus size={12} />}
                onClick={() => handleAddRule(gi)}
                style={{ marginTop: 8 }}
              >
                添加条件
              </Button>
            </div>
          ))}

          {/* 添加条件组 */}
          <Button
            type="secondary"
            size="small"
            icon={<Plus size={12} />}
            onClick={handleAddGroup}
            style={{ marginTop: 12 }}
            block
          >
            添加条件组
          </Button>
        </div>
      )}
    </SideSheet>
  );
}

/** 解析逗号分隔的 ID 字符串为 number[] */
function parseIdValue(value: string | number | boolean): number[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  if (typeof value === 'string') {
    return value.split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map(Number)
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

interface EntityLists {
  users: UserOption[];
  roles: RoleOption[];
  departments: DeptOption[];
  positions: PositionOption[];
}

/** 发起人维度：渲染对应实体的多选 */
function renderStarterValueInput(
  rule: ConditionRule,
  lists: EntityLists,
  onChange: (value: string) => void,
) {
  let options: Array<{ value: number; label: string }> = [];
  let placeholder = '选择';
  switch (rule.field) {
    case 'user': options = lists.users.map((u) => ({ value: u.id, label: u.nickname })); placeholder = '选择成员'; break;
    case 'dept': options = lists.departments.map((d) => ({ value: d.id, label: d.name })); placeholder = '选择部门'; break;
    case 'role': options = lists.roles.map((r) => ({ value: r.id, label: r.name })); placeholder = '选择角色'; break;
    case 'post': options = lists.positions.map((p) => ({ value: p.id, label: p.name })); placeholder = '选择岗位'; break;
  }
  return (
    <Select
      multiple
      filter
      value={parseIdValue(rule.value)}
      onChange={(v) => onChange((Array.isArray(v) ? (v as number[]) : []).join(','))}
      optionList={options}
      placeholder={placeholder}
      style={{ flex: 1, minWidth: 150 }}
      size="small"
      maxTagCount={2}
    />
  );
}

/** 根据字段类型渲染值输入组件 */
function renderValueInput(
  rule: ConditionRule,
  formFields: FormField[],
  lists: EntityLists,
  onChange: (value: string | number | boolean) => void,
) {
  // 发起人维度：渲染对应实体多选（值存为逗号分隔 ID 字符串）
  if (rule.source === 'starter') {
    return renderStarterValueInput(rule, lists, onChange);
  }

  // 为空 / 不为空：无需值输入，占位保持布局
  if (rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty') {
    return <span style={{ flex: 1 }} />;
  }

  // 区间：两个数值输入，存为 "min,max" 字符串
  if (rule.operator === 'between') {
    const parts = String(rule.value ?? '').split(',');
    const minVal = parts[0] !== '' ? Number(parts[0]) : undefined;
    const maxVal = parts[1] !== '' ? Number(parts[1]) : undefined;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
        <InputNumber
          value={minVal}
          onChange={(v) => onChange(`${v ?? ''},${parts[1] ?? ''}`)}
          placeholder="最小值"
          style={{ width: 80 }}
          size="small"
        />
        <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', flexShrink: 0 }}>~</span>
        <InputNumber
          value={maxVal}
          onChange={(v) => onChange(`${parts[0] ?? ''},${v ?? ''}`)}
          placeholder="最大值"
          style={{ width: 80 }}
          size="small"
        />
      </div>
    );
  }

  // 相对日期：N 天内 / 早于 N 天前
  if (rule.operator === 'withinDays' || rule.operator === 'beforeDays') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <InputNumber
          value={rule.value !== '' ? Number(rule.value) : undefined}
          onChange={(v) => onChange(v !== null ? Number(v) : 0)}
          placeholder="天数"
          min={0}
          style={{ width: 110 }}
          size="small"
        />
        <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', flexShrink: 0 }}>天</span>
      </div>
    );
  }

  const field = formFields.find(f => f.key === rule.field);

  if (field?.type === 'select' && field.options) {
    return (
      <Select
        value={rule.value as string}
        onChange={(v) => onChange(v as string)}
        optionList={field.options.map(o => ({ value: o, label: o }))}
        style={{ width: 140 }}
        size="small"
        placeholder="选择值"
      />
    );
  }

  if (field?.type === 'number') {
    return (
      <Input
        value={String(rule.value ?? '')}
        onChange={(v) => onChange(Number(v) || 0)}
        placeholder="输入数值"
        style={{ width: 140 }}
        size="small"
        type="number"
      />
    );
  }

  return (
    <Input
      value={String(rule.value ?? '')}
      onChange={(v) => onChange(v)}
      placeholder="输入值"
      style={{ width: 140 }}
      size="small"
    />
  );
}
