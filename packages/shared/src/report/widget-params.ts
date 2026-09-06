import type { ReportWidget } from './contracts/dashboards';

/**
 * 按组件的参数绑定，从看板筛选器当前值中取出该组件的取数参数。
 * 服务端看板取数与前端设计器 / 预览取数共用，保证同一份筛选值两侧算出的参数一致。
 */
export function computeWidgetParams(widget: ReportWidget, filterValues: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const binding of widget.paramBindings ?? []) {
    if (binding.filterId && binding.param) params[binding.param] = filterValues[binding.filterId];
  }
  return params;
}
