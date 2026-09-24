import { Pagination } from '@douyinfe/semi-ui';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { COMPACT_PAGINATION_PROPS, DESKTOP_PAGINATION_PROPS, type PaginationConfig } from '@/hooks/usePagination';

/**
 * List 列表页的分页条，对齐 ConfigurableTable（Semi Table 内置分页）的形态：
 * 左侧「显示第 x 条-第 y 条，共 z 条」信息，右侧分页器；
 * 移动端与表格同策略——隐藏条数信息、总页数与每页条数选择器，使用小尺寸，
 * 并开启 hover 页码快速切换；两侧共用 `usePagination` 的分页预设，页面无需再分支。
 */
export function ListPagination({ pagination }: Readonly<{ pagination: PaginationConfig }>) {
  const isMobile = useIsMobile();
  const { currentPage, pageSize, total } = pagination;
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isMobile ? 'flex-end' : 'space-between',
        alignItems: 'center',
        marginTop: 12,
        color: 'var(--semi-color-text-2)',
      }}
    >
      {!isMobile && <span style={{ fontSize: 14 }}>{`显示第 ${start} 条-第 ${end} 条，共 ${total} 条`}</span>}
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        total={total}
        {...(isMobile ? COMPACT_PAGINATION_PROPS : DESKTOP_PAGINATION_PROPS)}
        onPageChange={pagination.onPageChange}
        onPageSizeChange={pagination.onPageSizeChange}
      />
    </div>
  );
}
