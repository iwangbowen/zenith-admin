/**
 * 报表资源列表页共用的「负责人 / 目录」筛选与下拉源。
 *
 * 仪表盘、数据集、数据源、打印模板、填报模板、指标、资产目录七个页面的搜索栏与编辑表单
 * 都需要同一份「全量用户 + 某资源类型的目录树平铺」下拉源，这里收口取数与控件装饰，
 * 页面只传 `value` / `onChange`（以及需要自定义时的 `items` / `width`）。
 */
import type { ReportResourceType } from '@zenith/shared/report';
import { FilterSelect, type FilterOption } from '@/components/search-filters';
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

interface ReportLookupFilterProps {
  readonly items: readonly FilterOption<number>[];
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  /** 默认 140；选项文案更长的页面（带资源类型前缀的目录）按需加宽 */
  readonly width?: number;
  readonly placeholder?: string;
}

/** 负责人筛选：可搜索的「全部负责人」下拉 */
export function ReportOwnerFilter({ width = 140, placeholder = '全部负责人', ...rest }: ReportLookupFilterProps) {
  return <FilterSelect<number> placeholder={placeholder} width={width} filter {...rest} />;
}

/** 目录筛选：可搜索的「全部目录」下拉 */
export function ReportFolderFilter({ width = 140, placeholder = '全部目录', ...rest }: ReportLookupFilterProps) {
  return <FilterSelect<number> placeholder={placeholder} width={width} filter {...rest} />;
}
