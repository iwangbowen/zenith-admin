import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Col, Form, Input, Modal, Row, Select, Space, Spin, Tag, Toast, Switch, Banner, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, Trash2, Flame } from 'lucide-react';
import { MP_REPLY_CONTENT_TYPE_LABELS, MP_REPLY_CONTENT_TYPE_OPTIONS } from '@zenith/shared';
import type { MpAutoReply, MpAutoReplyType, MpReplyContentType, MpReplyArticle } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpAutoReplyKeys,
  useDeleteMpAutoReply,
  useDeleteMpUnmatchedKeyword,
  useMpAutoReplyList,
  useMpAutoReplyMaterials,
  useMpUnmatchedKeywords,
  useSaveMpAutoReply,
} from '@/hooks/queries/mp-auto-replies';

const REPLY_TYPE_OPTIONS = [
  { label: '关注回复', value: 'subscribe' },
  { label: '关键词回复', value: 'keyword' },
  { label: '默认回复', value: 'default' },
];
const MATCH_OPTIONS = [
  { label: '全匹配', value: 'exact' },
  { label: '包含匹配', value: 'contain' },
  { label: '正则匹配', value: 'regex' },
];
const TYPE_TAG_COLOR: Record<MpAutoReplyType, 'green' | 'blue' | 'orange'> = {
  subscribe: 'green', keyword: 'blue', default: 'orange',
};

function summarizeReply(r: MpAutoReply): string {
  switch (r.contentType) {
    case 'image': return `[图片] ${r.mediaId ?? ''}`;
    case 'voice': return `[语音] ${r.mediaId ?? ''}`;
    case 'video': return `[视频] ${r.content || r.mediaId || ''}`;
    case 'news': return `[图文] ${(r.newsArticles ?? []).map((a) => a.title).join('、')}`;
    default: return r.content ?? '';
  }
}

const emptyArticle = (): MpReplyArticle => ({ title: '', description: '', picUrl: '', url: '' });

export default function MpAutoRepliesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const { page, pageSize, setPage, buildPagination } = usePagination();

  interface SearchParams { filterType: MpAutoReplyType | undefined; keyword: string; }
  const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpAutoReply | null>(null);
  const [modalType, setModalType] = useState<MpAutoReplyType>('keyword');
  const [contentType, setContentType] = useState<MpReplyContentType>('text');
  const [articles, setArticles] = useState<MpReplyArticle[]>([emptyArticle()]);
  const formRef = useRef<FormApi>(null);
  const listQuery = useMpAutoReplyList({
    accountId: currentId,
    page,
    pageSize,
    replyType: submittedParams.filterType,
    keyword: submittedParams.keyword || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const materialsQuery = useMpAutoReplyMaterials(currentId);
  const materials = (materialsQuery.data?.list ?? []).filter((m) => m.wechatMediaId);
  const saveMutation = useSaveMpAutoReply();
  const toggleMutation = useSaveMpAutoReply();
  const deleteMutation = useDeleteMpAutoReply();
  const submitting = saveMutation.isPending;
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: mpAutoReplyKeys.lists(currentId) });
  };
  const handleReset = () => {
    setDraftParams(defaultSearch);
    setSubmittedParams(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpAutoReplyKeys.lists(currentId) });
  };

  const openCreate = () => {
    setEditingRecord(null); setModalType('keyword'); setContentType('text'); setArticles([emptyArticle()]); setModalVisible(true);
  };
  const openEdit = (record: MpAutoReply) => {
    setEditingRecord(record); setModalType(record.replyType); setContentType(record.contentType);
    setArticles(record.newsArticles?.length ? record.newsArticles.map((a) => ({ ...a })) : [emptyArticle()]);
    setModalVisible(true);
  };

  const materialOptions = (type: MpReplyContentType) =>
    materials.filter((m) => m.type === type).map((m) => ({ label: `${m.name}（${m.wechatMediaId}）`, value: m.wechatMediaId as string }));

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    if (!currentId) return;

    const payload: Record<string, unknown> = {
      contentType,
      matchType: values.matchType,
      keyword: values.keyword,
      sort: values.sort,
      status: values.status,
      transferToKf: values.transferToKf ?? false,
    };
    if (contentType === 'text') {
      payload.content = values.content;
    } else if (contentType === 'news') {
      const valid = articles.filter((a) => a.title.trim() && a.url.trim());
      if (valid.length === 0) { Toast.error('图文回复至少需要一篇有标题和链接的文章'); return; }
      payload.newsArticles = valid;
    } else {
      payload.mediaId = values.mediaId;
      if (contentType === 'video') payload.content = values.content || undefined;
    }

    await saveMutation.mutateAsync({ id: editingRecord?.id, values: editingRecord ? payload : { ...payload, accountId: currentId, replyType: modalType } });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleToggle = async (record: MpAutoReply, status: 'enabled' | 'disabled') => {
    await toggleMutation.mutateAsync({ id: record.id, values: { status } });
    Toast.success(status === 'enabled' ? '已启用' : '已禁用');
  };

  const handleDelete = (record: MpAutoReply) => {
    Modal.confirm({
      title: '确定要删除该自动回复吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const updateArticle = (idx: number, patch: Partial<MpReplyArticle>) => {
    setArticles((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const columns = [
    {
      title: '类型', dataIndex: 'replyType', width: 110,
      render: (v: MpAutoReplyType) => <Tag color={TYPE_TAG_COLOR[v]} type="light">{REPLY_TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v}</Tag>,
    },
    { title: '关键词', dataIndex: 'keyword', width: 130, render: (v: string | null) => v || '—' },
    { title: '匹配', dataIndex: 'matchType', width: 80, render: (v: string, r: MpAutoReply) => (r.replyType === 'keyword' ? (v === 'exact' ? '全匹配' : '包含') : '—') },
    { title: '内容类型', dataIndex: 'contentType', width: 90, render: (v: MpReplyContentType) => <Tag type="light" color="violet">{MP_REPLY_CONTENT_TYPE_LABELS[v]}</Tag> },
    { title: '回复内容', dataIndex: 'content', width: 260, render: (_: unknown, r: MpAutoReply) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{summarizeReply(r)}</Typography.Text> },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, align: 'center' as const, fixed: 'right' as const,
      render: (v: string, record: MpAutoReply) => (
        <Switch size="small" checked={v === 'enabled'} loading={togglingId === record.id}
          disabled={!can('mp:reply:update')} onChange={(ck: boolean) => void handleToggle(record, ck ? 'enabled' : 'disabled')} />
      ),
    },
    createOperationColumn<MpAutoReply>({
      width: 140,
      desktopInlineKeys: ['edit', 'delete'],
      menuAriaLabel: '自动回复操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:reply:update'), onClick: () => openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:reply:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const [hotwordsVisible, setHotwordsVisible] = useState(false);
  const hotwordsQuery = useMpUnmatchedKeywords(currentId, hotwordsVisible);
  const hotwords = hotwordsQuery.data?.list ?? [];
  const deleteHotwordMutation = useDeleteMpUnmatchedKeyword();

  const openHotwords = () => {
    if (!currentId) return;
    setHotwordsVisible(true);
  };

  const handleDeleteHotword = async (id: number) => {
    await deleteHotwordMutation.mutateAsync(id);
  };

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderTypeFilter = () => (
    <Select
      placeholder="回复类型"
      value={draftParams.filterType}
      onChange={(v) => setDraftParams({ ...draftParams, filterType: v as MpAutoReplyType | undefined })}
      optionList={REPLY_TYPE_OPTIONS}
      showClear
      style={{ width: 140 }}
    />
  );
  const renderKeywordInput = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索关键词"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 180 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => can('mp:reply:create') ? (
    <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增</Button>
  ) : null;
  const renderHotwordsButton = () => can('mp:reply:list') ? (
    <Button icon={<Flame size={14} />} disabled={!currentId} onClick={() => void openHotwords()}>未命中热词</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderAccountFilter()}
            {renderTypeFilter()}
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
            {renderHotwordsButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderAccountFilter()}
            {renderTypeFilter()}
          </>
        )}
        mobileActions={renderHotwordsButton()}
        filterTitle="自动回复筛选"
        actionTitle="自动回复操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} scroll={{ x: 1100 }} />

      <AppModal title={editingRecord ? '编辑自动回复' : '新增自动回复'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={640}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? `new-${modalType}`}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={editingRecord
              ? { keyword: editingRecord.keyword ?? '', matchType: editingRecord.matchType, content: editingRecord.content ?? '', mediaId: editingRecord.mediaId ?? '', status: editingRecord.status, sort: editingRecord.sort, transferToKf: editingRecord.transferToKf }
              : { matchType: 'contain', content: '', mediaId: '', status: 'enabled', sort: 0, transferToKf: false }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Slot label="回复类型">
                  <Select style={{ width: '100%' }} optionList={REPLY_TYPE_OPTIONS} value={modalType}
                    disabled={!!editingRecord} onChange={(v) => setModalType(v as MpAutoReplyType)} />
                </Form.Slot>
              </Col>
              {modalType === 'keyword' && (
                <Col span={12}>
                  <Form.Select field="matchType" label="匹配方式" style={{ width: '100%' }} optionList={MATCH_OPTIONS} />
                </Col>
              )}
            </Row>
            {modalType === 'keyword' && (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="keyword" label="关键词" placeholder="请输入关键词"
                    rules={[{ required: true, message: '请输入关键词' }]} />
                </Col>
                <Col span={12}>
                  <Form.InputNumber field="sort" label="优先级" style={{ width: '100%' }} min={0} />
                </Col>
              </Row>
            )}

            <Form.Slot label="内容类型">
              <Select style={{ width: '100%' }} optionList={MP_REPLY_CONTENT_TYPE_OPTIONS} value={contentType}
                onChange={(v) => setContentType(v as MpReplyContentType)} />
            </Form.Slot>

            {contentType === 'text' && (
              <Form.TextArea field="content" label="回复内容" rows={4} placeholder="请输入回复内容"
                rules={[{ required: true, message: '请输入回复内容' }]} />
            )}

            {(contentType === 'image' || contentType === 'voice' || contentType === 'video') && (
              <>
                <Form.Select field="mediaId" label="素材" style={{ width: '100%' }} filter showClear
                  placeholder={`请选择${MP_REPLY_CONTENT_TYPE_LABELS[contentType]}素材（来自素材库的永久素材）`}
                  optionList={materialOptions(contentType)}
                  rules={[{ required: true, message: '请选择素材' }]}
                  emptyContent="暂无对应类型的永久素材，请先在「素材管理」上传" />
                {contentType === 'video' && (
                  <Form.Input field="content" label="视频标题" placeholder="可选，被动回复时作为视频标题" />
                )}
              </>
            )}

            {contentType === 'news' && (
              <Form.Slot label="图文文章">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {articles.map((a, idx) => (
                    <div key={idx} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12, position: 'relative' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Typography.Text type="secondary" size="small">文章 {idx + 1}</Typography.Text>
                        {articles.length > 1 && (
                          <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={13} />}
                            onClick={() => setArticles((prev) => prev.filter((_, i) => i !== idx))} />
                        )}
                      </div>
                      <Space vertical style={{ width: '100%' }} spacing={8}>
                        <Input prefix="标题" value={a.title} onChange={(v) => updateArticle(idx, { title: v })} placeholder="必填" />
                        <Input prefix="链接" value={a.url} onChange={(v) => updateArticle(idx, { url: v })} placeholder="必填，https://" />
                        <Input prefix="封面" value={a.picUrl ?? ''} onChange={(v) => updateArticle(idx, { picUrl: v })} placeholder="可选，图片 URL" />
                        <Input prefix="摘要" value={a.description ?? ''} onChange={(v) => updateArticle(idx, { description: v })} placeholder="可选" />
                      </Space>
                    </div>
                  ))}
                  {articles.length < 8 && (
                    <Button theme="light" type="primary" icon={<Plus size={13} />} onClick={() => setArticles((prev) => [...prev, emptyArticle()])}>
                      添加文章
                    </Button>
                  )}
                </div>
              </Form.Slot>
            )}

            <Form.Select field="status" label="状态" style={{ width: '100%' }}
              optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))} />
            <Form.Switch field="transferToKf" label="命中转人工" extraText="命中该关键词后引导粉丝进入多客服会话队列" />
          </Form>
        </Spin>
      </AppModal>

      <AppModal title="未命中热词（优化关键词库参考）" visible={hotwordsVisible} footer={null}
        onCancel={() => setHotwordsVisible(false)} width={520}>
        <Spin spinning={hotwordsQuery.isFetching}>
          {hotwords.length === 0 ? <Typography.Text type="tertiary">暂无未命中热词记录</Typography.Text> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {hotwords.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                  <Tag color="orange" type="light">{h.count} 次</Tag>
                  <span style={{ flex: 1 }}>{h.keyword}</span>
                  <Typography.Text type="tertiary" size="small">{h.lastAt}</Typography.Text>
                  <Button theme="borderless" size="small" type="danger" icon={<Trash2 size={12} />} onClick={() => void handleDeleteHotword(h.id)} />
                </div>
              ))}
            </div>
          )}
        </Spin>
      </AppModal>
    </div>
  );
}
