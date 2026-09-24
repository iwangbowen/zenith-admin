import { Pagination } from '@douyinfe/semi-ui';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { TABLE_PAGE_SIZE_OPTIONS, type PaginationConfig } from '@/hooks/usePagination';

/**
 * List 列表页的分页条，对齐 ConfigurableTable（Semi Table 内置分页）的形态：
 * 左侧「显示第 x 条-第 y 条，共 z 条」信息，右侧分页器；
 * 移动端与表格同策略——隐藏条数信息、总页数与每页条数选择器，使用小尺寸。
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
        pageSizeOpts={TABLE_PAGE_SIZE_OPTIONS}
        showSizeChanger={!isMobile}
        showTotal={!isMobile}
        size={isMobile ? 'small' : 'default'}
        hoverShowPageSelect={isMobile}
        onPageChange={pagination.onPageChange}
        onPageSizeChange={pagination.onPageSizeChange}
      />
    </div>
  );
}
