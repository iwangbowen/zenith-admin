/**
 * 通知模板变量归一化：`renderTemplate`（`lib/sms-sender`）只做字面替换，
 * 数字 / 布尔直接传会渲染出 `undefined`，这里统一转成字符串，`null` / `undefined` 渲染为空串。
 * 派发引擎（单条事件）与摘要合并（digest）共用同一口径。
 */
export function normalizeTemplateVars(vars: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    result[key] = value === null || value === undefined ? '' : String(value);
  }
  return result;
}
