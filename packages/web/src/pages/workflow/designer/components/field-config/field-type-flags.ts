// ─── 字段类型标志集中推导（拆分自 FieldConfigPanel.tsx）───
import type { WorkflowFormField } from '@zenith/shared';

/** 由字段类型推导出的一组布尔标志，供各设置分区做条件渲染 */
export function getFieldTypeFlags(field: WorkflowFormField) {
  const hasOptions = field.type === 'select' || field.type === 'multiSelect' || field.type === 'radio' || field.type === 'checkbox' || field.type === 'autoComplete';
  const supportsCascade = field.type === 'select' || field.type === 'multiSelect';
  const hasChildren = field.type === 'detail';
  const isDescription = field.type === 'description';
  const isSerialNumber = field.type === 'serialNumber';
  const isAmountOrNumber = field.type === 'amount' || field.type === 'number';
  const isAmount = field.type === 'amount';
  const isDate = field.type === 'date' || field.type === 'dateRange';
  const isFileType = field.type === 'attachment' || field.type === 'image';
  const isLayout = field.type === 'row' || field.type === 'divider' || field.type === 'group' || field.type === 'tabs' || field.type === 'steps';
  const isPanesContainer = field.type === 'tabs' || field.type === 'steps';
  const isText = field.type === 'text' || field.type === 'textarea';
  const isFormatted = field.type === 'phone' || field.type === 'email' || field.type === 'idCard' || field.type === 'url' || field.type === 'password';
  const isRate = field.type === 'rate';
  const isFormula = field.type === 'formula';
  const isTime = field.type === 'time';
  const isRegion = field.type === 'region';
  const isSwitch = field.type === 'switch';
  const isSlider = field.type === 'slider';
  const isTags = field.type === 'tags';
  const isColorPicker = field.type === 'colorPicker';
  const isPinCode = field.type === 'pinCode';
  const isAutoComplete = field.type === 'autoComplete';
  const isUserSelect = field.type === 'userSelect';
  const isDeptSelect = field.type === 'deptSelect';
  const isDictSelect = field.type === 'dictSelect';
  const isRelationSelect = field.type === 'relation';
  const isCascader = field.type === 'cascader';
  const isNps = field.type === 'nps';
  const isSystemSelect = isUserSelect || isDeptSelect || isDictSelect || isRelationSelect;
  // 支持响应式列宽 / 只读 / 隐藏的普通输入字段（排除布局类与纯展示类）
  const supportsLayoutState = !isLayout && !isDescription && !isSerialNumber;
  // 支持字段级标签覆盖（排除布局/分割线/纯展示）
  const supportsLabelOverride = !isLayout && !isDescription;
  // 字段标识(key) 可编辑（排除布局/纯展示类，其 key 不参与数据提交与联动）
  const supportsKeyEdit = !isLayout && !isDescription;
  const showValidationTab = isText || isFormatted || isAmountOrNumber || isDate;
  const supportsUnique = isText || isFormatted || isAmountOrNumber;
  const supportsCompare = isAmountOrNumber || isDate;
  const allowOtherTypes = field.type === 'select' || field.type === 'radio';

  return {
    hasOptions, supportsCascade, hasChildren, isDescription, isSerialNumber, isAmountOrNumber, isAmount,
    isDate, isFileType, isLayout, isPanesContainer, isText, isFormatted, isRate, isFormula, isTime,
    isRegion, isSwitch, isSlider, isTags, isColorPicker, isPinCode, isAutoComplete, isUserSelect,
    isDeptSelect, isDictSelect, isRelationSelect, isCascader, isNps, isSystemSelect, supportsLayoutState,
    supportsLabelOverride, supportsKeyEdit, showValidationTab, supportsUnique, supportsCompare, allowOtherTypes,
  };
}

export type FieldTypeFlags = ReturnType<typeof getFieldTypeFlags>;
