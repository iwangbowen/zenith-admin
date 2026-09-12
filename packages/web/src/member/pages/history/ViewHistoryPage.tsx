/** 浏览历史：CMS 内容浏览记录（最近浏览优先，可清空） */
import { Button } from '@douyinfe/semi-ui';
import { Trash2 } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { CmsContentPagedList } from '../../components/CmsContentList';
import { useMyCmsViewHistory, useClearCmsViewHistory } from '../../hooks/queries';
import { confirmAndDelete } from '@/components/list-page';
import { usePagination } from '@/hooks/usePagination';

export default function ViewHistoryPage() {
  const { page, pageSize, setPage } = usePagination(10);
  const listQuery = useMyCmsViewHistory({ page, pageSize });
  const clearMutation = useClearCmsViewHistory();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  function handleClear() {
    confirmAndDelete({
      title: '清空浏览历史',
      content: '确定清空全部浏览记录吗？',
      okText: '清空',
      run: () => clearMutation.mutateAsync({}),
      successMessage: '已清空',
      onDeleted: () => setPage(1),
    });
  }

  return (
    <MemberPage
      title="浏览历史"
      rightSlot={total > 0 ? (
        <Button theme="light" type="danger" icon={<Trash2 size={14} />} onClick={handleClear}>清空</Button>
      ) : undefined}
    >
      <CmsContentPagedList
        loading={listQuery.isLoading}
        items={list}
        total={total}
        page={page}
        onPageChange={setPage}
        emptyTitle="暂无浏览记录"
        emptyDescription="登录后浏览前台内容会自动记录（保留最近 100 条）"
        meta={(item) => <>最近浏览 {item.updatedAt ?? item.createdAt}{item.viewCount && item.viewCount > 1 ? ` · 共 ${item.viewCount} 次` : ''}</>}
      />
    </MemberPage>
  );
}
