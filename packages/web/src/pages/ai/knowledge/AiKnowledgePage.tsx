import { useRef, useState } from 'react';
import { Button, Form, SideSheet, Space, Tag, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, FileUp, Globe } from 'lucide-react';
import type { AiKnowledgeBase, AiKbDocument } from '@zenith/shared/ai';
import { AppModal } from '@/components/AppModal';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import {
  useAiKnowledgeBases,
  useSaveAiKnowledgeBase,
  useDeleteAiKnowledgeBase,
  useAiKbDocuments,
  useAiKbChunks,
  useAddAiKbDocument,
  useDeleteAiKbDocument,
  useImportAiKbUrl,
} from '@/hooks/queries/ai-extras';
import { CreateButton, ResetButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

const { Text } = Typography;

const DOC_STATUS_TAGS = {
  ready: { label: '已就绪', color: 'green' },
  processing: { label: '处理中', color: 'orange' },
  failed: { label: '失败', color: 'red' },
} as const;

/** 知识库管理：个人知识库 CRUD + 文档管理（纯文本 / txt / md） */
export default function AiKnowledgePage() {
  const { hasPermission } = usePermission();
  const [search, setSearch] = useState('');
  const [docsKb, setDocsKb] = useState<AiKnowledgeBase | null>(null);
  const [viewingDoc, setViewingDoc] = useState<AiKbDocument | null>(null);
  const [docModalVisible, setDocModalVisible] = useState(false);
  const [urlModalVisible, setUrlModalVisible] = useState(false);
  const docFormApi = useRef<FormApi | null>(null);
  const urlFormApi = useRef<FormApi | null>(null);

  const listQuery = useAiKnowledgeBases();
  const list = (listQuery.data ?? []).filter(
    (kb) => !search || kb.name.toLowerCase().includes(search.toLowerCase()),
  );
  const saveMutation = useSaveAiKnowledgeBase();
  const deleteMutation = useDeleteAiKnowledgeBase();
  const docsQuery = useAiKbDocuments(docsKb?.id ?? null);
  const chunksQuery = useAiKbChunks(docsKb?.id ?? null, viewingDoc?.id ?? null);
  const addDocMutation = useAddAiKbDocument();
  const importUrlMutation = useImportAiKbUrl();
  const deleteDocMutation = useDeleteAiKbDocument();

  const kbModal = useEditModal<AiKnowledgeBase, { name: string; description?: string }, { name: string; description: string | null }>({
    entityName: '知识库',
    save: saveMutation,
    defaults: { name: '', description: '' },
    toValues: (record) => ({ name: record.name, description: record.description ?? '' }),
    beforeSave: (values) => ({ name: values.name.trim(), description: values.description?.trim() || null }),
    labelWidth: 70,
  });

  async function handleAddDoc() {
    if (!docsKb) return;
    let values: { name: string; content: string };
    try {
      values = (await docFormApi.current?.validate()) as { name: string; content: string };
    } catch {
      abortSubmit('validation');
    }
    await addDocMutation.mutateAsync({ params: { id: docsKb.id }, body: { name: values.name.trim(), content: values.content } });
    Toast.success('文档已入库');
    setDocModalVisible(false);
  }

  async function handleImportUrl() {
    if (!docsKb) return;
    let values: { url: string; name?: string };
    try {
      values = (await urlFormApi.current?.validate()) as { url: string; name?: string };
    } catch {
      abortSubmit('validation');
    }
    await importUrlMutation.mutateAsync({ params: { id: docsKb.id }, body: { url: values.url.trim(), name: values.name?.trim() || undefined } });
    Toast.success('网页已入库');
    setUrlModalVisible(false);
  }

  /** 读取上传的 txt/md 文件填充表单 */
  function handleFileRead(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      Toast.warning('文件超过 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      docFormApi.current?.setValue('content', String(reader.result ?? ''));
      if (!docFormApi.current?.getValue('name')) {
        docFormApi.current?.setValue('name', file.name.replace(/\.(txt|md|markdown)$/i, ''));
      }
      Toast.success('文件内容已读取');
    };
    reader.readAsText(file);
  }

  const columns: ColumnProps<AiKnowledgeBase>[] = [
    { title: '名称', dataIndex: 'name', width: 200, render: renderEllipsis },
    { title: '描述', dataIndex: 'description', render: renderEllipsis },
    { title: '文档数', dataIndex: 'documentCount', width: 90, align: 'right' },
    { title: '分块数', dataIndex: 'chunkCount', width: 90, align: 'right' },
    {
      title: '检索方式',
      dataIndex: 'embeddingModel',
      width: 160,
      render: (v: string | null) => v
        ? <Tag color="green" size="small">向量（{v}）</Tag>
        : <Tag color="grey" size="small">关键词</Tag>,
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<AiKnowledgeBase>({
      width: 210,
      desktopInlineKeys: ['docs', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'docs',
          label: '文档',
          onClick: () => setDocsKb(record),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('ai:kb:edit'),
          onClick: () => { kbModal.openEdit(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('ai:kb:delete'),
          onClick: () => {
            confirmDelete({
              title: '确定要删除该知识库吗？',
              content: '将级联删除全部文档与分块，且解除已挂载对话',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('删除成功');
              },
            });
          },
        },
      ],
    }),
  ];

  const docColumns: ColumnProps<AiKbDocument>[] = [
    { title: '文档名称', dataIndex: 'name', render: renderEllipsis },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: AiKbDocument['status']) => {
        const cfg = DOC_STATUS_TAGS[v];
        return <Tag color={cfg.color} size="small">{cfg.label}</Tag>;
      },
    },
    { title: '分块', dataIndex: 'chunkCount', width: 70, align: 'right' },
    { title: '字符数', dataIndex: 'charCount', width: 90, align: 'right' },
    dateTimeColumn('时间', 'createdAt'),
    createOperationColumn<AiKbDocument>({
      width: 150,
      desktopInlineKeys: ['view', 'delete'],
      actions: (record) => [
        {
          key: 'view',
          label: '查看',
          onClick: () => setViewingDoc(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('ai:kb:edit'),
          onClick: () => {
            confirmDelete({
              title: '确定要删除该文档吗？',
              onOk: async () => {
                if (!docsKb) return;
                await deleteDocMutation.mutateAsync({ params: { id: docsKb.id, docId: record.id } });
                Toast.success('删除成功');
              },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <KeywordInput placeholder="搜索知识库名称" value={search} onChange={(v) => setSearch(String(v ?? ''))} />
            <ResetButton onClick={() => setSearch('')} />
          </>
        )}
        actions={hasPermission('ai:kb:create') ? (
          <CreateButton onClick={kbModal.openCreate} />
        ) : null}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        empty="暂无知识库，点击「新增」创建后即可在智能对话中挂载"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={false}
      />

      <AppModal
        {...kbModal.modalProps}
        width={480}
        closeOnEsc
      >
        <Form
          key={kbModal.formKey} {...kbModal.formProps}
        >
          <Form.Input field="name" label="名称" placeholder="请输入名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="description" label="描述" placeholder="可选" maxLength={300} />
        </Form>
      </AppModal>

        <SideSheet
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
            <span>文档管理 — {docsKb?.name}</span>
            {hasPermission('ai:kb:edit') && (
              <Space spacing={8}>
                <Button size="small" icon={<Globe size={13} />} onClick={() => setUrlModalVisible(true)}>
                  导入网页
                </Button>
                <Button type="primary" size="small" icon={<Plus size={13} />} onClick={() => setDocModalVisible(true)}>
                  添加文档
                </Button>
              </Space>
            )}
          </div>
        }
        visible={docsKb !== null}
        onCancel={() => setDocsKb(null)}
        width={800}
        footer={null}
      >
        <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
          支持粘贴纯文本或上传 txt / md 文件；配置系统参数「ai_embedding_model」后自动向量化，否则走关键词检索
        </Text>
        <ConfigurableTable
          bordered
          columns={docColumns}
          dataSource={docsQuery.data ?? []}
          loading={docsQuery.isFetching}
          rowKey="id"
          size="small"
          empty="暂无文档"
          pagination={false}
        />
      </SideSheet>

      <AppModal
        title={viewingDoc ? `文档内容 — ${viewingDoc.name}` : '文档内容'}
        visible={viewingDoc !== null}
        onCancel={() => setViewingDoc(null)}
        footer={null}
        width={640}
        closeOnEsc
      >
        {chunksQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Text type="tertiary">加载中…</Text>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
            {(chunksQuery.data ?? []).map((chunk, i) => (
              <div
                key={chunk.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--semi-border-radius-medium)',
                  background: 'var(--semi-color-fill-0)',
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 4 }}>
                  分块 {i + 1} / {chunksQuery.data?.length ?? 0} · {chunk.tokenCount} tokens
                </Text>
                {chunk.content}
              </div>
            ))}
            {(chunksQuery.data ?? []).length === 0 && (
              <Text type="tertiary" style={{ textAlign: 'center', padding: '24px 0' }}>无分块内容</Text>
            )}
          </div>
        )}
      </AppModal>

      <AppModal
        title="添加文档"
        visible={docModalVisible}
        onOk={handleAddDoc}
        onCancel={() => setDocModalVisible(false)}
        okButtonProps={{ loading: addDocMutation.isPending }}
        width={640}
        closeOnEsc
      >
        <Form
          key={docsKb?.id ?? 'doc'}
          getFormApi={(api) => { docFormApi.current = api; }}
          labelPosition="top"
        >
          <div style={{ marginBottom: 8 }}>
            <Upload
              action=""
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              showUploadList={false}
              beforeUpload={({ file }) => {
                const fi = (file as { fileInstance?: File }).fileInstance;
                if (fi) handleFileRead(fi);
                return false;
              }}
            >
              <Button icon={<FileUp size={14} />}>读取 txt / md 文件</Button>
            </Upload>
          </div>
          <Form.Input field="name" label="文档名称" placeholder="请输入名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.TextArea
            field="content"
            label="文档内容"
            rows={10}
            placeholder="粘贴文档纯文本内容（最长 50 万字符），入库时自动按段落分块"
            rules={[{ required: true, message: '请输入内容' }]}
          />
        </Form>
      </AppModal>

      <AppModal
        title="从 URL 导入网页"
        visible={urlModalVisible}
        onOk={handleImportUrl}
        onCancel={() => setUrlModalVisible(false)}
        okButtonProps={{ loading: importUrlMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form
          key={`url-${docsKb?.id ?? 0}`}
          getFormApi={(api) => { urlFormApi.current = api; }}
          labelPosition="top"
        >
          <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
            抓取网页正文（自动去除脚本/导航等噪音）入库分块；仅支持公网可访问的网页/文本链接
          </Text>
          <Form.Input
            field="url"
            label="网页 URL"
            placeholder="https://example.com/docs/guide"
            rules={[
              { required: true, message: '请输入 URL' },
              { pattern: /^https?:\/\/.+/i, message: '请输入合法的 http(s) 链接' },
            ]}
          />
          <Form.Input field="name" label="文档名称" placeholder="留空取网页标题" maxLength={200} />
        </Form>
      </AppModal>
    </div>
  );
}
