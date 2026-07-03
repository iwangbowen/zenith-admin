import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Space, Spin, Tag, Toast, Banner, Typography, TextArea } from '@douyinfe/semi-ui';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { MpDraft, MpArticle } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpDraftKeys,
  useDeleteMpDraft,
  useMpDraftDetail,
  useMpDraftList,
  usePushMpDraft,
  useSaveMpDraft,
} from '@/hooks/queries/mp-drafts';

const blankArticle = (): MpArticle => ({ title: '', author: '', digest: '', content: '', thumbUrl: '', showCoverPic: true });

export default function MpDraftsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const listQuery = useMpDraftList(currentId, { page, pageSize, keyword: submittedKeyword || undefined });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpDraft | null>(null);
  const [articles, setArticles] = useState<MpArticle[]>([blankArticle()]);
  const detailQuery = useMpDraftDetail(editingRecord?.id, modalVisible);

  const saveMutation = useSaveMpDraft();
  const pushMutation = usePushMpDraft();
  const deleteMutation = useDeleteMpDraft();
  const pushingId = pushMutation.isPending ? (pushMutation.variables ?? null) : null;

  useEffect(() => {
    if (modalVisible && editingRecord) setArticles(detailQuery.data?.articles.length ? detailQuery.data.articles : [blankArticle()]);
  }, [modalVisible, editingRecord, detailQuery.data]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: mpDraftKeys.lists(currentId) });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpDraftKeys.lists(currentId) });
  };

  const openCreate = () => { setEditingRecord(null); setArticles([blankArticle()]); setModalVisible(true); };
  const openEdit = (record: MpDraft) => { setEditingRecord(record); setArticles([blankArticle()]); setModalVisible(true); };

  const updateArticle = (i: number, patch: Partial<MpArticle>) => setArticles((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const addArticle = () => setArticles((prev) => [...prev, blankArticle()]);
  const removeArticle = (i: number) => setArticles((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!currentId) return;
    for (const a of articles) {
      if (!a.title.trim()) { Toast.error('每篇图文都需要标题'); throw new Error('validation'); }
      if (!a.content.trim()) { Toast.error('每篇图文都需要正文'); throw new Error('validation'); }
    }
    await saveMutation.mutateAsync({ id: editingRecord?.id, accountId: currentId, articles });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handlePush = async (record: MpDraft) => {
    await pushMutation.mutateAsync(record.id);
    Toast.success('已推送到微信草稿箱');
  };

  const handleDelete = (record: MpDraft) => {
    Modal.confirm({
      title: `确定删除图文「${record.title}」吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const columns = [
    { title: '标题', dataIndex: 'title', width: 220, render: renderEllipsis },
    { title: '文章数', dataIndex: 'articles', width: 90, render: (v: MpArticle[]) => `${v?.length ?? 0} 篇` },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => (v === 'published' ? <Tag color="green" type="light">已推送</Tag> : <Tag color="grey" type="light">草稿</Tag>),
    },
    { title: '微信 MediaID', dataIndex: 'wechatMediaId', width: 200, render: (v: string | null) => v || '—' },
    createdAtColumn,
    createOperationColumn<MpDraft>({
      width: 200,
      desktopInlineKeys: ['edit', 'push', 'delete'],
      menuAriaLabel: '图文草稿操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:draft:update'), onClick: () => openEdit(record) },
        { key: 'push', label: '推送', loading: pushingId === record.id, hidden: !can('mp:draft:push'), onClick: () => void handlePush(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:draft:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderKeywordInput = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索标题"
      value={draftKeyword}
      onChange={setDraftKeyword}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 180 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => can('mp:draft:create') ? (
    <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增图文</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderAccountFilter()}
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderAccountFilter()}
        filterTitle="图文草稿筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} scroll={{ x: 1000 }} />

      <AppModal title={editingRecord ? '编辑图文' : '新增图文'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => setModalVisible(false)} confirmLoading={saveMutation.isPending}
        okButtonProps={{ disabled: !!editingRecord && detailQuery.isFetching }} width={760}>
        <Spin spinning={!!editingRecord && detailQuery.isFetching} wrapperClassName="modal-spin-wrapper">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflow: 'auto' }}>
            {articles.map((a, i) => (
              <div key={i} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Typography.Text strong>第 {i + 1} 篇</Typography.Text>
                  {articles.length > 1 && <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={13} />} onClick={() => removeArticle(i)}>移除</Button>}
                </div>
                <Space vertical align="start" style={{ width: '100%' }}>
                  <Input prefix="标题" value={a.title} onChange={(v) => updateArticle(i, { title: v })} placeholder="文章标题" />
                  <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                    <Input prefix="作者" value={a.author ?? ''} onChange={(v) => updateArticle(i, { author: v })} placeholder="作者" style={{ flex: 1 }} />
                    <Input prefix="封面" value={a.thumbUrl ?? ''} onChange={(v) => updateArticle(i, { thumbUrl: v })} placeholder="封面图 URL" style={{ flex: 2 }} />
                  </div>
                  <Input prefix="摘要" value={a.digest ?? ''} onChange={(v) => updateArticle(i, { digest: v })} placeholder="摘要（选填）" />
                  <TextArea value={a.content} onChange={(v) => updateArticle(i, { content: v })} rows={4} placeholder="正文内容（支持 HTML）" />
                </Space>
              </div>
            ))}
            <Button theme="light" icon={<Plus size={14} />} onClick={addArticle} style={{ alignSelf: 'flex-start' }}>添加一篇</Button>
          </div>
        </Spin>
      </AppModal>
    </div>
  );
}
