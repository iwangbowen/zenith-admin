/**
 * 报表资源列表页共用的「负责人 / 目录」下拉源。
 *
 * 仪表盘、数据集、数据源、打印模板、填报模板、指标、资产目录七个页面的搜索栏与编辑表单
 * 都需要同一份「全量用户 + 某资源类型的目录树平铺」下拉源，这里收口取数与选项映射。
 */
import type { ReportResourceType } from '@zenith/shared/report';
import type { FilterOption } from '@/components/search-filters';
import { flattenReportFolders, useReportFolderTree } from '@/hooks/queries/report-folders';
import { toUserOptions, useAllUsers } from '@/hooks/queries/users';

/** 目录下拉选项：标签取目录名 */
export function toFolderOptions(folders: readonly { id: number; name: string }[]): FilterOption<number>[] {
  return folders.map((folder) => ({ value: folder.id, label: folder.name }));
}

/**
 * 负责人 / 目录下拉源：全量用户 + 指定资源类型的目录树平铺（省略 resourceType 取全部目录）。
 * `users` / `folders` 保留原始记录供表单或标签渲染使用。
 */
export function useReportOwnerFolderOptions(resourceType?: ReportResourceType) {
  const users = useAllUsers().data ?? [];
  const folders = flattenReportFolders(useReportFolderTree(resourceType ? { resourceType } : {}).data ?? []);
  return { users, folders, userOptions: toUserOptions(users), folderOptions: toFolderOptions(folders) };
}
