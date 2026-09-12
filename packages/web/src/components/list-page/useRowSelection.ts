import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Data } from '@douyinfe/semi-ui/lib/es/table';
import type { RowSelectionProps } from '@douyinfe/semi-ui/lib/es/table/interface';

export type RowSelectionKey = string | number;

export interface UseRowSelectionOptions<T extends Data> {
  /** 行级禁用、固定列等 Semi `rowSelection` 附加属性；`selectedRowKeys` / `onChange` 由 hook 接管 */
  extra?: Omit<RowSelectionProps<T>, 'selectedRowKeys' | 'onChange'>;
}

export interface RowSelectionController<K extends RowSelectionKey, T extends Data> {
  readonly selectedRowKeys: K[];
  readonly setSelectedRowKeys: Dispatch<SetStateAction<K[]>>;
  /** `selectedRowKeys.length > 0`：批量按钮的显示条件 */
  readonly hasSelection: boolean;
  /** 清空选中：查询 / 重置 / 翻页 / 批量操作完成后调用（引用稳定，可直接交给 `onSearch` / `onDeleted`） */
  readonly clear: () => void;
  /** 展开到 `listTableProps(query, { rowSelection })` */
  readonly rowSelection: RowSelectionProps<T>;
}

/**
 * 列表页多选状态：把各页手抄的 `useState<number[]>([])` + `onChange: (keys) => set(keys as number[])`
 * + 各处 `setSelectedRowKeys([])` 收敛到一处；Semi 回传的 `(string | number)[] | undefined` 在这里归一。
 *
 * @example
 * const selection = useRowSelection();
 * const { ... } = useListSearch({ defaults, listKey, onSearch: selection.clear });
 * confirmAndDelete({ ..., onDeleted: selection.clear });
 * {selection.hasSelection && <BatchDeleteButton count={selection.selectedRowKeys.length} onClick={...} />}
 * <ConfigurableTable {...listTableProps(listQuery, { pagination: buildPagination, rowSelection: selection.rowSelection })} />
 *
 * 行键是字符串（会话 id 等）时 `useRowSelection<string>()`；需要 `getCheckboxProps` 等附加属性传 `{ extra }`。
 */
export function useRowSelection<K extends RowSelectionKey = number, T extends Data = Data>(
  options: UseRowSelectionOptions<T> = {},
): RowSelectionController<K, T> {
  const [selectedRowKeys, setSelectedRowKeys] = useState<K[]>([]);
  const clear = useCallback(() => setSelectedRowKeys([]), []);
  const { extra } = options;
  const rowSelection = useMemo<RowSelectionProps<T>>(() => ({
    ...extra,
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys((keys ?? []) as K[]),
  }), [extra, selectedRowKeys]);
  return { selectedRowKeys, setSelectedRowKeys, hasSelection: selectedRowKeys.length > 0, clear, rowSelection };
}
