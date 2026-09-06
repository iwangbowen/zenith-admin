/** 我的收藏：CMS 内容收藏列表（点击跳前台详情，可取消收藏） */
import { useState } from 'react';
import { Button, Modal, Toast } from '@douyinfe/semi-ui';
import { Trash2 } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { CmsContentPagedList } from '../../components/CmsContentList';
import { useMyCmsFavorites, useRemoveCmsFavorite } from '../../hooks/queries';

export default function FavoritesPage() {
  const [page, setPage] = useState(1);
  const listQuery = useMyCmsFavorites({ page, pageSize: 10 });
  const removeMutation = useRemoveCmsFavorite();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  function handleRemove(contentId: number, title: string) {
    Modal.confirm({
      title: '取消收藏',
      content: `确定取消收藏「${title}」吗？`,
      onOk: async () => {
        await removeMutation.mutateAsync({ params: { id: contentId } });
        Toast.success('已取消收藏');
      },
    });
  }

  return (
    <MemberPage title="我的收藏">
      <CmsContentPagedList
        loading={listQuery.isLoading}
        items={list}
        total={total}
        page={page}
        onPageChange={setPage}
        emptyTitle="暂无收藏"
        emptyDescription="在前台内容页点击「收藏」即可同步到这里"
        meta={(item) => <>收藏于 {item.createdAt}</>}
        extra={(item) => (
          <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => handleRemove(item.contentId, item.title)} />
        )}
      />
    </MemberPage>
  );
}
