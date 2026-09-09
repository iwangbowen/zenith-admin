/**
 * 报表资源列表页共用的「负责人 / 目录」筛选控件；下拉源来自 `report-lookups.ts` 的 `useReportOwnerFolderOptions`。
 * 页面只传 `value` / `onChange`（以及需要自定义时的 `items` / `width` / `placeholder`）。
 */
import { FilterSelect, type FilterOption } from '@/components/search-filters';

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
