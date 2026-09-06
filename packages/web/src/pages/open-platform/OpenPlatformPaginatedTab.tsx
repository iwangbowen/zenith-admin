import type { ReactNode } from 'react';
import type { Data } from '@douyinfe/semi-ui/lib/es/table';
import type { UseQueryResult } from '@tanstack/react-query';
import ConfigurableTable from '@/components/ConfigurableTable';
import { listTableProps } from '@/components/list-page';
import { usePagination } from '@/hooks/usePagination';

type PaginatedData<T> = { list: T[]; total: number };

interface OpenPlatformPaginatedTabProps<T extends Data> {
  useList: (page: number, pageSize: number) => UseQueryResult<PaginatedData<T>>;
  columns: React.ComponentProps<typeof ConfigurableTable<T>>['columns'];
  rowKey: React.ComponentProps<typeof ConfigurableTable<T>>['rowKey'];
  empty: ReactNode;
  pageSize?: number;
}

export function OpenPlatformPaginatedTab<T extends Data>({
  useList,
  columns,
  rowKey,
  empty,
  pageSize: initialPageSize = 10,
}: OpenPlatformPaginatedTabProps<T>) {
  const { page, pageSize, setPage, buildPagination } = usePagination(initialPageSize);
  const query = useList(page, pageSize);

  return (
    <ConfigurableTable<T>
      columns={columns}
      {...listTableProps(query, {
        rowKey,
        empty,
        pagination: (total) => ({
          ...buildPagination(total),
          onPageChange: setPage,
        }),
      })}
    />
  );
}
