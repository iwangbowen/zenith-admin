import { globalSearchRoutePrefixes, globalSearchTypes, type GlobalSearchResult, type GlobalSearchType } from '@zenith/shared/platform';
import { supportsEntityRelations } from '@zenith/shared/platform/entity-catalog';

export const GLOBAL_SEARCH_TYPE_LABELS: Record<GlobalSearchType, string> = {
  user: '用户',
  member: '会员',
  order: '订单',
  workflow: '流程',
  file: '文件',
  'iot-device': '设备',
  'iot-alarm': '告警',
  'cms-content': 'CMS 内容',
  'wiki-document': 'Wiki 文档',
  announcement: '公告',
  'chat-message': '聊天消息',
  'biz-leave': '请假单',
  'report-dashboard': '仪表盘',
  'report-dataset': '数据集',
  'ai-knowledge-base': 'AI 知识库',
  'async-task': '异步任务',
  'operation-log': '操作日志',
  'exception-log': '异常日志',
};

export const GLOBAL_SEARCH_TYPE_OPTIONS = globalSearchTypes.map((value) => ({
  value,
  label: GLOBAL_SEARCH_TYPE_LABELS[value],
}));

export function globalSearchTypeLabel(type: GlobalSearchResult['type']): string {
  return GLOBAL_SEARCH_TYPE_LABELS[type];
}

export function isSafeInternalSearchRoute(route: string): boolean {
  if (route.startsWith('/search?')) {
    const params = new URLSearchParams(route.slice('/search?'.length));
    return supportsEntityRelations(params.get('entityType') ?? '') && Boolean(params.get('entityKey'));
  }
  return route.startsWith('/') && !route.startsWith('//') && globalSearchRoutePrefixes.some((prefix) => {
    const root = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return route === root || route.startsWith(`${root}?`) || route.startsWith(prefix);
  });
}
