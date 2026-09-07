import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncer } from '@tanstack/react-pacer';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Button, Checkbox, Input, Modal, Select, Space, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { ArrowLeft, Eye, EyeOff, HardDrive, Save, Send } from 'lucide-react';
import type { WikiDoc } from '@zenith/shared/wiki';
import MarkdownPreviewPanel from '@/components/MarkdownPreviewPanel';
import PageLoading from '@/components/PageLoading';
import FileAttachment, { type AttachmentItem } from '@/components/FileAttachment';
import { DriveNodePicker } from '@/pages/drive/components/DriveNodePicker';
import { ApiError } from '@/lib/query';
import './WikiDocEditPage.css';
import { useAllWikiTags } from '@/hooks/queries/wiki-tags';
import { useAllWikiTemplates } from '@/hooks/queries/wiki-templates';
import { useCreateWikiDoc, useSubmitWikiDoc, useUpdateWikiDoc, useWikiDocDetail } from '@/hooks/queries/wiki-docs';

const { Text } = Typography;

interface EditorDraft {
  title: string;
  summary: string;
  content: string;
  tagIds: number[];
  savedAt: string;
}

/**
 * 全屏 Markdown 编辑器（搭建器型工作区，保存后不关闭）：
 * 不适用 useEditModal —— 非弹窗表单、双栏实时预览、保存后需原地继续编辑。
 */
export default function WikiDocEditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ? Number(searchParams.get('id')) : undefined;
  const spaceIdParam = searchParams.get('spaceId') ? Number(searchParams.get('spaceId')) : undefined;
  const parentIdParam = searchParams.get('parentId') ? Number(searchParams.get('parentId')) : undefined;

  const detailQuery = useWikiDocDetail(id);
  const createMutation = useCreateWikiDoc();
  const updateMutation = useUpdateWikiDoc();
  const submitMutation = useSubmitWikiDoc();
  const tagsQuery = useAllWikiTags();
  const templatesQuery = useAllWikiTemplates();
  const saving = createMutation.isPending || updateMutation.isPending;

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [requireReadReceipt, setRequireReadReceipt] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [drivePickerVisible, setDrivePickerVisible] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<EditorDraft | null>(null);
  const seededDocId = useRef<number | null>(null);
  // 乐观锁：保存时回传加载详情时的 revision，冲突时服务端返回 409
  const revisionRef = useRef<number | undefined>(undefined);

  const draftKey = `wiki-doc-draft:${id ?? `new-${spaceIdParam ?? 0}`}`;

  const readDraft = useCallback((): EditorDraft | null => {
    try {
      const raw = localStorage.getItem(draftKey);
      return raw ? (JSON.parse(raw) as EditorDraft) : null;
    } catch {
      return null;
    }
  }, [draftKey]);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* storage unavailable */ }
  }, [draftKey]);

  // 编辑模式：详情到达后播种一次表单；新建模式立即检测本地草稿
  useEffect(() => {
    if (!id) {
      setPendingDraft(readDraft());
      return;
    }
    const doc = detailQuery.data;
    if (!doc || seededDocId.current === doc.id) return;
    seededDocId.current = doc.id;
    revisionRef.current = doc.revision;
    setTitle(doc.title);
    setSummary(doc.summary ?? '');
    setContent(doc.content ?? '');
    setTagIds(doc.tagIds);
    setAttachments(doc.attachments ?? []);
    setRequireReadReceipt(doc.requireReadReceipt);
    setDirty(false);
    setPendingDraft(readDraft());
  }, [id, detailQuery.data, readDraft]);

  // 自动保存草稿：有未保存修改时每 2 秒落一次 localStorage，异常退出可恢复
  const draftDebouncer = useDebouncer(() => {
    try {
      const draft: EditorDraft = {
        title, summary, content, tagIds,
        savedAt: new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19),
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch { /* storage unavailable */ }
  }, { wait: 2000 });

  useEffect(() => {
    if (!dirty) { draftDebouncer.cancel(); return; }
    draftDebouncer.maybeExecute();
  }, [dirty, title, summary, content, tagIds, draftKey, draftDebouncer]);

  function restoreDraft() {
    if (!pendingDraft) return;
    setTitle(pendingDraft.title);
    setSummary(pendingDraft.summary);
    setContent(pendingDraft.content);
    setTagIds(pendingDraft.tagIds);
    setDirty(true);
    setPendingDraft(null);
  }

  function discardDraft() {
    clearDraft();
    setPendingDraft(null);
  }

  // 离开未保存提醒
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const loading = !!id && detailQuery.isPending;
  const doc = detailQuery.data;

  function markDirty() {
    if (!dirty) setDirty(true);
  }

  function applyTemplate(templateId: number) {
    const tpl = templatesQuery.data?.find((t) => t.id === templateId);
    if (!tpl) return;
    if (content.trim()) {
      Toast.warning('已有内容，模板将追加到正文末尾');
      setContent((c) => `${c}\n\n${tpl.content}`);
    } else {
      setContent(tpl.content);
    }
    markDirty();
  }

  /** 409 冲突：他人已保存过，提供刷新或继续编辑的选择 */
  function handleConflict() {
    Modal.confirm({
      title: '文档已被他人修改',
      content: '当前编辑基于旧版本。可加载最新内容（放弃本次修改，本地草稿仍保留），或继续编辑稍后自行处理。',
      okText: '加载最新内容',
      cancelText: '继续编辑',
      onOk: () => {
        seededDocId.current = null;
        setDirty(false);
        void detailQuery.refetch();
      },
    });
  }

  async function handleSave(): Promise<number | null> {
    if (!title.trim()) {
      Toast.warning('请填写文档标题');
      return null;
    }
    const fileIds = attachments.map((a) => a.fileId);
    try {
      let saved: WikiDoc;
      if (id) {
        saved = await updateMutation.mutateAsync({
          params: { id },
          body: { title: title.trim(), summary: summary || null, content, tagIds, fileIds, requireReadReceipt, changeNote: changeNote || undefined, revision: revisionRef.current },
        });
      } else {
        // 缺少空间参数的新建入口在渲染层已拦截
        if (spaceIdParam === undefined) return null;
        saved = await createMutation.mutateAsync({
          body: { spaceId: spaceIdParam, parentId: parentIdParam ?? null, title: title.trim(), summary: summary || undefined, content, tagIds, fileIds, requireReadReceipt },
        });
      }
      revisionRef.current = saved.revision;
      setDirty(false);
      setChangeNote('');
      clearDraft();
      if (!id) navigate(`/wiki/docs/edit?id=${saved.id}`, { replace: true });
      return saved.id;
    } catch (err) {
      if (err instanceof ApiError && err.code === 409) handleConflict();
      return null;
    }
  }

  async function handleSaveOnly() {
    const savedId = await handleSave();
    if (savedId) Toast.success('保存成功');
  }

  async function handleSaveAndSubmit() {
    const savedId = await handleSave();
    if (!savedId) return;
    submitMutation.mutate({ params: { id: savedId } }, {
      onSuccess: (saved) => {
        Toast.success(saved.status === 'published' ? '已发布' : '已提交审核');
        navigate(-1);
      },
    });
  }

  function handleBack() {
    if (dirty) {
      Toast.warning('有未保存的修改，请先保存或再次点击返回放弃修改');
      setDirty(false);
      return;
    }
    navigate(-1);
  }

  if (!id && spaceIdParam === undefined) {
    return (
      <div className="page-container">
        <Banner type="warning" description="缺少空间参数，请从文档中心进入新建" />
      </div>
    );
  }

  return (
    <div className="page-container page-container--stretch" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {pendingDraft ? (
        <Banner
          type="info"
          description={`检测到 ${pendingDraft.savedAt} 自动保存的草稿，是否恢复？`}
          onClose={() => setPendingDraft(null)}
        >
          <Space spacing={8}>
            <Button size="small" theme="solid" onClick={restoreDraft}>恢复草稿</Button>
            <Button size="small" onClick={discardDraft}>丢弃</Button>
          </Space>
        </Banner>
      ) : null}
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Space spacing={8}>
          <Button icon={<ArrowLeft size={14} />} onClick={handleBack}>返回</Button>
          <Input
            style={{ width: 320 }}
            placeholder="文档标题（必填）"
            value={title}
            onChange={(v) => { setTitle(v); markDirty(); }}
            maxLength={200}
          />
          {doc ? <Text type="tertiary" size="small">v{doc.currentVersion} · {doc.spaceName ?? ''}</Text> : null}
        </Space>
        <Space spacing={8}>
          <Select
            placeholder="选用模板"
            style={{ width: 150 }}
            showClear
            optionList={(templatesQuery.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => { if (v !== undefined) applyTemplate(Number(v)); }}
          />
          <Button
            icon={showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setShowPreview((s) => !s)}
          >
            {showPreview ? '隐藏预览' : '显示预览'}
          </Button>
          <Button icon={<HardDrive size={14} />} onClick={() => setDrivePickerVisible(true)}>插入网盘文件</Button>
          <Button
            icon={<Save size={14} />}
            loading={saving}
            onClick={() => void handleSaveOnly()}
          >
            保存草稿
          </Button>
          <Button
            theme="solid"
            icon={<Send size={14} />}
            loading={saving || submitMutation.isPending}
            onClick={() => void handleSaveAndSubmit()}
          >
            保存并提交发布
          </Button>
        </Space>
      </div>

      {/* 元信息行 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          style={{ flex: '1 1 240px' }}
          placeholder="摘要（选填，用于列表与搜索展示）"
          value={summary}
          onChange={(v) => { setSummary(v); markDirty(); }}
          maxLength={500}
        />
        <Select
          multiple
          style={{ flex: '1 1 240px' }}
          placeholder="选择标签"
          value={tagIds}
          onChange={(v) => { setTagIds((v as number[]) ?? []); markDirty(); }}
          optionList={(tagsQuery.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          maxTagCount={4}
        />
        {id ? (
          <Input
            style={{ flex: '1 1 240px' }}
            placeholder="本次变更说明（选填，记入版本历史）"
            value={changeNote}
            onChange={setChangeNote}
            maxLength={300}
          />
        ) : null}
        <Checkbox
          checked={requireReadReceipt}
          onChange={(e) => { setRequireReadReceipt(!!e.target.checked); markDirty(); }}
        >
          要求阅读确认
        </Checkbox>
      </div>

      {/* 编辑器主体（高度链：page-container--stretch → wiki-editor-body → textarea） */}
      <div className="wiki-editor-body">
        {loading ? (
          <div className="wiki-editor-loading"><PageLoading inline /></div>
        ) : (
          <>
            <TextArea
              className="wiki-editor-textarea"
              placeholder={'使用 Markdown 编写文档内容...\n\n# 一级标题\n## 二级标题\n- 列表项\n**加粗** `代码`'}
              value={content}
              onChange={(v) => { setContent(v); markDirty(); }}
            />
            {showPreview ? (
              <div className="wiki-editor-preview">
                <MarkdownPreviewPanel content={content || '*预览区：左侧输入 Markdown 后此处实时渲染*'} />
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* 附件 */}
      <FileAttachment
        mode="edit"
        title="附件"
        value={attachments}
        onChange={(items) => { setAttachments(items); markDirty(); }}
        limit={10}
        maxSizeMB={50}
      />
      <DriveNodePicker visible={drivePickerVisible} allowFolders title="插入网盘文件链接" okText="插入链接"
        onCancel={() => setDrivePickerVisible(false)}
        onOk={({ node, url }) => {
          // 只插入站内链接，不复制对象：读者仍按网盘 ACL 判定可见性
          const snippet = `[${node.type === 'folder' ? '📁' : '📎'} ${node.name}](${url})`;
          setContent((current) => (current ? `${current.replace(/\s*$/, '')}\n\n${snippet}\n` : `${snippet}\n`));
          markDirty();
          setDrivePickerVisible(false);
          Toast.success('已插入网盘链接');
        }} />
    </div>
  );
}
