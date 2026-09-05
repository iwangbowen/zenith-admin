import { createContext } from 'react';

/** 表单当前值快照（由 WorkflowFormRenderer 提供，深层字段经 context 读取做显隐 / 联动 / 只读展示） */
export const ValuesContext = createContext<Record<string, unknown>>({});
/** 查看态文本化开关（由 WorkflowFormRenderer 的 readOnlyAsText 提供，深层字段经 context 读取） */
export const ReadOnlyTextContext = createContext(false);
