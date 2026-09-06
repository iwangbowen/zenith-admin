import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Breadcrumb, Button, Checkbox, Divider, Dropdown, Empty, List, Popover, Select, Space, Spin, Tabs, Tag, TextArea, Toast, Tooltip, Tree, TreeSelect, Typography } from '@douyinfe/semi-ui';
import type { OnDragProps, TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import {
  Bell, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, FilePlus2, FileUp, FolderInput, History, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Send, Star, TableOfContents, Trash2, Undo2,
} from 'lucide-react';
import type { WikiComment, WikiDocTreeNode } from '@zenith/shared/wiki';
import { WIKI_DOC_STATUS_LABELS } from '@zenith/shared/wiki';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import MarkdownPreviewPanel from '@/components/MarkdownPreviewPanel';
import FileAttachment from '@/components/FileAttachment';
import AppModal from '@/components/AppModal';
import { KeywordInput } from '@/components/search-filters';
import { usePermission } from '@/hooks/usePermission';
import { usePreferences } from '@/hooks/usePreferences';
import { useAuth } from '@/hooks/useAuth';
import { confirmDelete } from '@/utils/confirm';
import { extractMarkdownHeadings, type MarkdownHeading } from '@/utils/markdown-outline';
import { useAllUsers } from '@/hooks/queries/users';
import { useMyWikiSpaces } from '@/hooks/queries/wiki-spaces';
import {
  useConfirmWikiDocRead, useDeleteWikiDocs, useFavoriteWikiDoc, useMoveWikiDoc, useMyFavoriteWikiDocs,
  useRecentWikiDocs, useRecordWikiDocView, useReportWikiSearchClick, useSubmitWikiDoc, useSubscribeWikiDoc, useUpdateWikiDoc,
  useWikiDocDetail, useWikiDocList, useWikiDocReadReceipts, useWikiDocSearch, useWikiDocTree, useWithdrawWikiDoc,
} from '@/hooks/queries/wiki-docs';
import { useCreateWikiComment, useDeleteMyWikiComment, useResolveWikiComment, useWikiDocComments } from '@/hooks/queries/wiki-comments';
import { useImportWikiDocs } from '@/hooks/queries/wiki-governance';
import './WikiDocCenterPage.css';
import { WIKI_DOC_STATUS_TAG_COLOR } from '../wiki-tag-colors';

const { Text, Title } = Typography;

/** 与 .md-preview-content 相同的阅读列（860px 居中 + 40px 水平内边距），附件与评论跟随正文对齐 */
const READING_COLUMN_STYLE = { maxWidth: 860, margin: '0 auto', padding: '0 40px' } as const;

function toTreeData(nodes: WikiDocTreeNode[], renderNodeActions?: (node: WikiDocTreeNode) => React.ReactNode): TreeNodeData[] {
  return nodes.map((n) => ({
    key: String(n.id),
    value: n.id,
    // label 是 JSX，Semi 默认按 label 过滤永远匹配不到；搜索经 treeNodeFilterProp 走这里的纯文本
    titleText: n.title,
    label: (
      <span className="wiki-tree-label">
        <Space spacing={4} className="wiki-tree-label-main">
          {n.isPinned ? <Pin size={12} style={{ color: 'var(--semi-color-warning)', flexShrink: 0 }} /> : null}
          <span>{n.title}</span>
          {n.status !== 'published' ? (
            <Tag size="small" color={WIKI_DOC_STATUS_TAG_COLOR[n.status]}>{WIKI_DOC_STATUS_LABELS[n.status]}</Tag>
          ) : null}
        </Space>
        {renderNodeActions ? (
          // 阻止冒泡：点操作菜单不应选中/展开节点
          <span
            className="wiki-tree-node-actions"
            role="presentation"
            onClick={(e) => e.stopPropagation()}
          >
            {renderNodeActions(n)}
          </span>
        ) : null}
      </span>
    ),
    children: n.children?.length ? toTreeData(n.children, renderNodeActions) : undefined,
  }));
}

function collectTreeDocIds(nodes: WikiDocTreeNode[]): number[] {
  return nodes.flatMap((node) => [node.id, ...collectTreeDocIds(node.children ?? [])]);
}

/** 目录树转移动目标选择数据（纯文本 label，排除自身子树防环） */
function toMoveTreeData(nodes: WikiDocTreeNode[], excludeId: number): TreeNodeData[] {
  return nodes
    .filter((n) => n.id !== excludeId)
    .map((n) => ({
      key: String(n.id),
      value: n.id,
      label: n.title,
      children: n.children?.length ? toMoveTreeData(n.children, excludeId) : undefined,
    }));
}

function CommentItem({ comment, canDelete, canResolve, onReply, onDelete, onResolve }: {
  comment: WikiComment;
  canDelete: (c: WikiComment) => boolean;
  canResolve: (c: WikiComment) => boolean;
  onReply: (c: WikiComment) => void;
  onDelete: (c: WikiComment) => void;
  onResolve: (c: WikiComment) => void;
}) {
  return (
    <div style={{ padding: '8px 0' }}>
      <Space spacing={8}>
        <Text strong>{comment.authorName ?? '已注销用户'}</Text>
        <Text type="tertiary" size="small">{comment.createdAt}</Text>
        {comment.isQuestion ? (
          comment.resolvedAt
            ? <Tag size="small" color="green">已解决</Tag>
            : <Tag size="small" color="orange">问题</Tag>
        ) : null}
      </Space>
      <div style={{ margin: '4px 0' }}>{comment.content}</div>
      <Space spacing={4}>
        <Button size="small" theme="borderless" type="tertiary" onClick={() => onReply(comment)}>回复</Button>
        {comment.isQuestion && !comment.resolvedAt && canResolve(comment) ? (
          <Button size="small" theme="borderless" onClick={() => onResolve(comment)}>标记解决</Button>
        ) : null}
        {canDelete(comment) ? (
          <Button size="small" theme="borderless" type="danger" onClick={() => onDelete(comment)}>删除</Button>
        ) : null}
      </Space>
      {comment.replies?.length ? (
        <div style={{ marginLeft: 24, borderLeft: '2px solid var(--semi-color-border)', paddingLeft: 12 }}>
          {comment.replies.map((r) => (
            <CommentItem key={r.id} comment={r} canDelete={canDelete} canResolve={canResolve}
              onReply={onReply} onDelete={onDelete} onResolve={onResolve} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function WikiDocCenterPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { preferences: { syncPageStateToUrl } } = usePreferences();
  const { user } = useAuth();

  // 空间与文档选中态同步到 URL（?spaceId=&docId=），支持刷新恢复、分享链接与跨页跳转
  const [searchParams, setSearchParams] = useSearchParams();
  const [spaceId, setSpaceId] = useState<number | undefined>(() => Number(searchParams.get('spaceId')) || undefined);
  const [selectedDocId, setSelectedDocId] = useState<number | undefined>(() => Number(searchParams.get('docId')) || undefined);
  const [showDetailOnNarrow, setShowDetailOnNarrow] = useState(false);
  const isNarrowLayoutRef = useRef(false);
  const [masterTab, setMasterTab] = useState('tree');
  const [moveTarget, setMoveTarget] = useState<{ id: number; title: string } | null>(null);
  const [moveParentId, setMoveParentId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<WikiComment | null>(null);
  const [mentionIds, setMentionIds] = useState<number[]>([]);
  const [isQuestion, setIsQuestion] = useState(false);
  const [receiptsVisible, setReceiptsVisible] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');

  // ─── 数据 ─────────────────────────────────────────────────────────────────
  const spacesQuery = useMyWikiSpaces();
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const effectiveSpaceId = spaceId ?? spaces[0]?.id;
  const currentSpace = spaces.find((s) => s.id === effectiveSpaceId);
  const myRole = currentSpace?.myRole ?? null;
  const canWrite = myRole === 'owner' || myRole === 'admin' || myRole === 'editor';

  const treeQuery = useWikiDocTree(effectiveSpaceId);
  const favoritesQuery = useMyFavoriteWikiDocs({ page: 1, pageSize: 50 }, masterTab === 'favorites');
  const recentQuery = useRecentWikiDocs(masterTab === 'recent');
  const myDocsQuery = useWikiDocList({ page: 1, pageSize: 50, mine: true }, masterTab === 'mine');
  const searchQuery = useWikiDocSearch({ page: 1, pageSize: 30, keyword: searchKeyword }, masterTab === 'search');
  const docQuery = useWikiDocDetail(selectedDocId);
  const doc = docQuery.data;
  const commentsQuery = useWikiDocComments(selectedDocId, !!doc && doc.status === 'published');
  const isDocAuthor = !!doc && doc.createdBy === user?.id;
  const docSpaceRole = doc ? spaces.find((space) => space.id === doc.spaceId)?.myRole ?? null : null;
  const canWriteDoc = docSpaceRole === 'owner' || docSpaceRole === 'admin' || docSpaceRole === 'editor';
  const canManageDoc = docSpaceRole === 'owner' || docSpaceRole === 'admin';
  const commentsEnabled = doc?.commentsEnabled !== false;
  const usersQuery = useAllUsers({ enabled: !!doc && doc.status === 'published' && commentsEnabled });
  const receiptsQuery = useWikiDocReadReceipts(selectedDocId, receiptsVisible);

  // ─── 变更 ─────────────────────────────────────────────────────────────────
  const favoriteMutation = useFavoriteWikiDoc();
  const subscribeMutation = useSubscribeWikiDoc();
  const submitMutation = useSubmitWikiDoc();
  const withdrawMutation = useWithdrawWikiDoc();
  const deleteMutation = useDeleteWikiDocs();
  const moveMutation = useMoveWikiDoc();
  const pinMutation = useUpdateWikiDoc();
  const viewMutation = useRecordWikiDocView();
  const createCommentMutation = useCreateWikiComment();
  const deleteCommentMutation = useDeleteMyWikiComment();
  const resolveCommentMutation = useResolveWikiComment();
  const confirmReadMutation = useConfirmWikiDocRead();
  const searchClickMutation = useReportWikiSearchClick();
  const importMutation = useImportWikiDocs();
  const importInputRef = useRef<HTMLInputElement>(null);

  async function handleImportFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || effectiveSpaceId === undefined) return;
    const files = await Promise.all(
      [...fileList].slice(0, 20).map(async (f) => ({ name: f.name, content: await f.text() })),
    );
    importMutation.mutate(
      { body: { spaceId: effectiveSpaceId, parentId: null, files } },
      { onSuccess: (r) => Toast.success(`已导入 ${r.importedCount} 篇草稿`) },
    );
    if (importInputRef.current) importInputRef.current.value = '';
  }

  function selectDoc(id: number) {
    setSelectedDocId(id);
    setShowDetailOnNarrow(true);
  }

  function selectSearchResult(id: number) {
    if (searchKeyword) searchClickMutation.mutate({ body: { keyword: searchKeyword, docId: id } });
    selectDoc(id);
  }

  function handleSubmitComment() {
    const content = commentText.trim();
    if (!content || !selectedDocId) return;
    createCommentMutation.mutate(
      { body: { docId: selectedDocId, parentId: replyTo?.id ?? null, content, mentionedUserIds: mentionIds, isQuestion } },
      {
        onSuccess: () => {
          Toast.success('评论成功');
          setCommentText('');
          setReplyTo(null);
          setMentionIds([]);
          setIsQuestion(false);
        },
      },
    );
  }

  const canEditDoc = canWriteDoc && hasPermission('wiki:doc:edit');
  const canDeleteDoc = canWriteDoc && hasPermission('wiki:doc:delete');
  const canSubmitDoc = canWriteDoc && hasPermission('wiki:doc:publish');
  const canMoveDoc = canWriteDoc && hasPermission('wiki:doc:move');

  // ─── 选中态 ↔ URL 同步 ────────────────────────────────────────────────────
  const lastWrittenParamsRef = useRef<string | null>(null);

  // 状态 → URL：刷新可恢复、地址栏可直接分享。偏好「页面状态同步到地址栏」关闭时不写回
  useEffect(() => {
    if (!syncPageStateToUrl) return;
    const next = new URLSearchParams();
    if (effectiveSpaceId !== undefined) next.set('spaceId', String(effectiveSpaceId));
    if (selectedDocId !== undefined) next.set('docId', String(selectedDocId));
    const str = next.toString();
    if (str !== searchParams.toString()) {
      lastWrittenParamsRef.current = str;
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在选中态变化时写回 URL
  }, [effectiveSpaceId, selectedDocId, syncPageStateToUrl]);

  // 偏好关闭时消费即焚：外部带参深链（评论管理/统计跳转）应用后从地址栏移除
  useEffect(() => {
    if (syncPageStateToUrl) return;
    if (!searchParams.has('spaceId') && !searchParams.has('docId')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('spaceId');
    next.delete('docId');
    lastWrittenParamsRef.current = next.toString();
    setSearchParams(next, { replace: true });
  }, [syncPageStateToUrl, searchParams, setSearchParams]);

  // URL → 状态：页面已挂载时从其他页面（评论管理/知识空间/统计）跳转进来
  useEffect(() => {
    const str = searchParams.toString();
    if (str === lastWrittenParamsRef.current) return;
    const paramDocId = Number(searchParams.get('docId')) || undefined;
    const paramSpaceId = Number(searchParams.get('spaceId')) || undefined;
    if (paramDocId !== undefined && paramDocId !== selectedDocId) {
      setSelectedDocId(paramDocId);
      setShowDetailOnNarrow(true);
    }
    if (paramSpaceId !== undefined && paramSpaceId !== spaceId) setSpaceId(paramSpaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅响应外部 URL 变化
  }, [searchParams]);

  // 深链只带 docId 时（如从评论管理跳转），文档加载后跟随其所属空间，保证目录树定位正确
  useEffect(() => {
    if (doc && doc.spaceId !== effectiveSpaceId) setSpaceId(doc.spaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在文档变化时同步空间
  }, [doc?.id, doc?.spaceId]);

  // 正文中指向文档中心的站内链接（/wiki/docs?docId=N）拦截为页内切换，不整页跳转
  function handleContentClick(event: React.MouseEvent) {
    const anchor = (event.target as HTMLElement).closest?.('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    const match = /^\/wiki\/docs\?(?:.*&)?docId=(\d+)/.exec(href);
    if (match) {
      event.preventDefault();
      selectDoc(Number(match[1]));
    }
  }

  // ─── 渲染 ─────────────────────────────────────────────────────────────────
  const treeDocIds = useMemo(() => collectTreeDocIds(treeQuery.data ?? []), [treeQuery.data]);

  // 目录树索引：父指针、各层展示序与标题（拖拽定位、面包屑、自动展开共用）
  const treeIndex = useMemo(() => {
    const parentOf = new Map<number, number | null>();
    const childrenOf = new Map<number | null, number[]>();
    const titleOf = new Map<number, string>();
    // 展示序拍平（父在前、子随后），供上一篇/下一篇按阅读顺序导航
    const flatIds: number[] = [];
    const walk = (nodes: WikiDocTreeNode[], parent: number | null) => {
      childrenOf.set(parent, nodes.map((n) => n.id));
      for (const n of nodes) {
        parentOf.set(n.id, parent);
        titleOf.set(n.id, n.title);
        flatIds.push(n.id);
        if (n.children?.length) walk(n.children, n.id);
      }
    };
    walk(treeQuery.data ?? [], null);
    return { parentOf, childrenOf, titleOf, flatIds };
  }, [treeQuery.data]);

  // 阅读上下文：祖先面包屑与上一篇/下一篇（均来自当前空间目录树，树外文档不展示）
  const docAncestors = useMemo(() => {
    if (selectedDocId === undefined) return [];
    const chain: Array<{ id: number; title: string }> = [];
    let cursor = treeIndex.parentOf.get(selectedDocId) ?? null;
    while (cursor !== null) {
      chain.unshift({ id: cursor, title: treeIndex.titleOf.get(cursor) ?? '' });
      cursor = treeIndex.parentOf.get(cursor) ?? null;
    }
    return chain;
  }, [selectedDocId, treeIndex]);

  const { prevDoc, nextDoc } = useMemo(() => {
    if (selectedDocId === undefined) return { prevDoc: null, nextDoc: null };
    const position = treeIndex.flatIds.indexOf(selectedDocId);
    if (position === -1) return { prevDoc: null, nextDoc: null };
    const toItem = (id: number | undefined) => (id === undefined ? null : { id, title: treeIndex.titleOf.get(id) ?? '' });
    return { prevDoc: toItem(treeIndex.flatIds[position - 1]), nextDoc: toItem(treeIndex.flatIds[position + 1]) };
  }, [selectedDocId, treeIndex]);

  // ─── 目录树节点操作 ───────────────────────────────────────────────────────
  const canManage = myRole === 'owner' || myRole === 'admin';
  const canCreateInTree = canWrite && hasPermission('wiki:doc:create');
  const canPinInTree = canManage && hasPermission('wiki:doc:edit');
  const canMoveInTree = canWrite && hasPermission('wiki:doc:move');
  const canDeleteInTree = hasPermission('wiki:doc:delete');
  const { mutate: pinDoc } = pinMutation;
  const { mutateAsync: deleteDocs } = deleteMutation;

  const renderNodeActions = useCallback((n: WikiDocTreeNode) => {
    const items: React.ReactNode[] = [];
    if (canCreateInTree) {
      items.push(
        <Dropdown.Item key="child" icon={<FilePlus2 size={14} />} onClick={() => navigate(`/wiki/docs/edit?spaceId=${effectiveSpaceId}&parentId=${n.id}`)}>
          新建子文档
        </Dropdown.Item>,
      );
    }
    if (canPinInTree && n.status !== 'pending') {
      items.push(
        <Dropdown.Item
          key="pin"
          icon={n.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          onClick={() => pinDoc(
            { params: { id: n.id }, body: { isPinned: !n.isPinned } },
            { onSuccess: () => Toast.success(n.isPinned ? '已取消置顶' : '已置顶，目录树中将优先展示') },
          )}
        >
          {n.isPinned ? '取消置顶' : '置顶'}
        </Dropdown.Item>,
      );
    }
    if (canMoveInTree) {
      items.push(
        <Dropdown.Item key="move" icon={<FolderInput size={14} />} onClick={() => { setMoveTarget({ id: n.id, title: n.title }); setMoveParentId(n.parentId ?? null); }}>
          移动
        </Dropdown.Item>,
      );
    }
    // editor 只能删除自己创建的文档，空间管理员不受限（与服务端 ensureDocEditable 一致）
    if (canDeleteInTree && (canManage || (canWrite && n.createdBy === user?.id))) {
      items.push(
        <Dropdown.Item
          key="delete"
          type="danger"
          icon={<Trash2 size={14} />}
          onClick={() => confirmDelete({
            title: `确定要删除「${n.title}」吗？`,
            content: '删除后可在回收站还原',
            onOk: async () => {
              await deleteDocs([n.id]);
              Toast.success('已移入回收站');
              setSelectedDocId((current) => (current === n.id ? undefined : current));
            },
          })}
        >
          删除
        </Dropdown.Item>,
      );
    }
    if (items.length === 0) return null;
    return (
      <Dropdown trigger="click" clickToHide position="bottomRight" render={<Dropdown.Menu>{items}</Dropdown.Menu>}>
        <Button aria-label={`文档「${n.title}」更多操作`} size="small" theme="borderless" type="tertiary" icon={<MoreHorizontal size={14} />} />
      </Dropdown>
    );
  }, [canCreateInTree, canPinInTree, canMoveInTree, canDeleteInTree, canManage, canWrite, user?.id, effectiveSpaceId, navigate, pinDoc, deleteDocs]);

  const treeData = useMemo(() => toTreeData(treeQuery.data ?? [], renderNodeActions), [treeQuery.data, renderNodeActions]);

  // ─── 展开状态：受控 + 按空间持久化，默认全展开 ────────────────────────────
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const expandInitSpaceRef = useRef<number | undefined>(undefined);

  const treeBranchKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: WikiDocTreeNode[]) => {
      for (const n of nodes) {
        if (n.children?.length) {
          keys.push(String(n.id));
          walk(n.children);
        }
      }
    };
    walk(treeQuery.data ?? []);
    return keys;
  }, [treeQuery.data]);

  const applyExpandedKeys = useCallback((keys: string[]) => {
    setExpandedKeys(keys);
    if (effectiveSpaceId === undefined) return;
    try {
      localStorage.setItem(`wiki-doc-tree-expanded:${effectiveSpaceId}`, JSON.stringify(keys));
    } catch { /* storage unavailable */ }
  }, [effectiveSpaceId]);

  // 首次进入空间：恢复上次展开状态，无记录则全展开
  useEffect(() => {
    if (effectiveSpaceId === undefined || !treeQuery.data) return;
    if (expandInitSpaceRef.current === effectiveSpaceId) return;
    expandInitSpaceRef.current = effectiveSpaceId;
    let stored: string[] | null;
    try {
      const raw = localStorage.getItem(`wiki-doc-tree-expanded:${effectiveSpaceId}`);
      stored = raw ? (JSON.parse(raw) as string[]) : null;
    } catch { stored = null; }
    setExpandedKeys(stored ?? treeBranchKeys);
  }, [effectiveSpaceId, treeQuery.data, treeBranchKeys]);

  // 选中文档自动展开其祖先链（深链、正文内链、搜索/收藏/最近选中后目录树可定位）
  useEffect(() => {
    if (selectedDocId === undefined) return;
    const ancestors: string[] = [];
    let cursor = treeIndex.parentOf.get(selectedDocId) ?? null;
    while (cursor !== null) {
      ancestors.push(String(cursor));
      cursor = treeIndex.parentOf.get(cursor) ?? null;
    }
    if (ancestors.length === 0) return;
    setExpandedKeys((keys) => (ancestors.every((k) => keys.includes(k)) ? keys : [...new Set([...keys, ...ancestors])]));
  }, [selectedDocId, treeIndex]);

  const isAllExpanded = treeBranchKeys.length > 0 && treeBranchKeys.every((k) => expandedKeys.includes(k));

  // ─── 拖拽移动 ────────────────────────────────────────────────────────────
  const canDragTree = canWrite && hasPermission('wiki:doc:move');
  // 搜索过滤态下渲染序与完整树不一致，拖拽定位会错位，暂停拖拽
  const [treeSearching, setTreeSearching] = useState(false);

  function handleTreeDrop({ node, dragNode, dropToGap, dropPosition }: OnDragProps) {
    const dragId = Number(dragNode.key);
    const targetId = Number(node.key);
    if (!Number.isFinite(dragId) || !Number.isFinite(targetId) || dragId === targetId) return;
    let parentId: number | null;
    let index: number;
    if (!dropToGap) {
      // 拖放到节点上 = 成为其最后一个子文档
      parentId = targetId;
      index = (treeIndex.childrenOf.get(targetId) ?? []).filter((childId) => childId !== dragId).length;
    } else {
      parentId = treeIndex.parentOf.get(targetId) ?? null;
      const siblings = treeIndex.childrenOf.get(parentId) ?? [];
      const targetIndex = siblings.indexOf(targetId);
      // Semi 的 dropPosition = 目标节点下标 + 相对方位（-1 上方 / +1 下方）
      index = dropPosition - targetIndex < 0 ? targetIndex : targetIndex + 1;
      const dragIndex = siblings.indexOf(dragId);
      // move 接口的 index 语义是「移除自身后的插入位」：同层下移时前面少了自己，回退一位
      if (dragIndex !== -1 && dragIndex < index) index -= 1;
    }
    moveMutation.mutate({ params: { id: dragId }, body: { parentId, index } }, {
      onSuccess: () => {
        Toast.success('已移动');
        // 移入的目标层级保持展开，落点立即可见
        if (parentId !== null) {
          setExpandedKeys((keys) => (keys.includes(String(parentId)) ? keys : [...keys, String(parentId)]));
        }
      },
    });
  }

  useEffect(() => {
    setSelectedDocId((current) => {
      // 保留已有选中（含跨空间深链，等文档详情加载后自动切换空间）；
      // 切换空间时由空间选择器显式清空选中，这里只负责空态兜底选中第一篇
      if (current !== undefined) return current;
      if (treeDocIds.length === 0) return current;
      return isNarrowLayoutRef.current ? undefined : treeDocIds[0];
    });
  }, [treeDocIds]);

  // 浏览上报：跟随选中文档变化（覆盖点击、默认选中首篇、深链与正文内链），
  // 同一文档连续选中只报一次，避免 URL 同步等重复触发虚增浏览量
  const lastViewedDocIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (selectedDocId === undefined || selectedDocId === lastViewedDocIdRef.current) return;
    lastViewedDocIdRef.current = selectedDocId;
    viewMutation.mutate({ params: { id: selectedDocId } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在选中文档变化时上报
  }, [selectedDocId]);

  // 切换文档回到顶部：滚动容器被 React 复用，上一篇的阅读位置会残留
  const detailScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedDocId]);

  // 正文大纲（TOC）：标题少于 2 个不展示
  const outline = useMemo(() => (doc?.content ? extractMarkdownHeadings(doc.content) : []), [doc?.content]);
  const outlineMinLevel = useMemo(() => Math.min(...outline.map((h) => h.level), 6), [outline]);

  function scrollToHeading(heading: MarkdownHeading) {
    const container = detailScrollRef.current;
    if (!container) return;
    const anchors = container.querySelectorAll(`[id="${CSS.escape(heading.id)}"]`);
    (anchors[heading.occurrence] ?? anchors[0])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const detailContent = !selectedDocId ? (
    <Empty title="选择文档开始阅读" description="从左侧目录树选择一篇文档" style={{ marginTop: 80 }} />
  ) : docQuery.isPending ? (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}><Spin size="large" /></div>
  ) : docQuery.isError || !doc ? (
    <Empty title="文档不可用" description="文档不存在或没有访问权限" style={{ marginTop: 80 }} />
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 层级面包屑：嵌套文档展示所属路径，可点击回到上层 */}
      {docAncestors.length > 0 ? (
        <Breadcrumb compact style={{ marginBottom: 6 }}>
          {docAncestors.map((ancestor) => (
            <Breadcrumb.Item key={ancestor.id} onClick={() => selectDoc(ancestor.id)}>
              {ancestor.title}
            </Breadcrumb.Item>
          ))}
          <Breadcrumb.Item>{doc.title}</Breadcrumb.Item>
        </Breadcrumb>
      ) : null}
      {/* 标题与操作 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Space spacing={8}>
            <Title heading={4} style={{ margin: 0 }}>{doc.title}</Title>
            <Tag color={WIKI_DOC_STATUS_TAG_COLOR[doc.status]}>{WIKI_DOC_STATUS_LABELS[doc.status]}</Tag>
            {doc.isPinned ? <Tag color="amber">置顶</Tag> : null}
          </Space>
          <div style={{ marginTop: 6 }}>
            <Space spacing={12}>
              <Text type="tertiary" size="small">{doc.authorName ?? '—'}</Text>
              <Text type="tertiary" size="small">更新于 {doc.updatedAt}</Text>
              <Text type="tertiary" size="small"><Eye size={12} style={{ verticalAlign: -2 }} /> {doc.viewCount}</Text>
              <Text type="tertiary" size="small">v{doc.currentVersion}</Text>
              {doc.requireReadReceipt && (isDocAuthor || canManageDoc) ? (
                <Button size="small" theme="borderless" onClick={() => setReceiptsVisible(true)}>
                  已读 {doc.readReceiptCount ?? 0} 人
                </Button>
              ) : null}
            </Space>
          </div>
          {doc.tags.length ? (
            <Space spacing={4} style={{ marginTop: 6 }}>
              {doc.tags.map((t) => <Tag key={t.id} size="small" style={t.color ? { backgroundColor: t.color, color: '#fff' } : undefined}>{t.name}</Tag>)}
            </Space>
          ) : null}
          {doc.status === 'rejected' && doc.rejectReason ? (
            <div style={{ marginTop: 6 }}><Text type="danger" size="small">驳回意见：{doc.rejectReason}</Text></div>
          ) : null}
        </div>
        <Space spacing={4}>
          {outline.length >= 2 ? (
            <Popover
              trigger="click"
              position="bottomRight"
              content={(
                <div style={{ padding: '8px 6px', minWidth: 200, maxWidth: 320, maxHeight: 360, overflowY: 'auto' }}>
                  {outline.map((heading, headingIndex) => (
                    <div key={headingIndex} style={{ paddingLeft: (heading.level - outlineMinLevel) * 14 }}>
                      <Button
                        size="small"
                        theme="borderless"
                        type="tertiary"
                        style={{ maxWidth: 280, justifyContent: 'flex-start' }}
                        onClick={() => scrollToHeading(heading)}
                      >
                        <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 260, color: 'inherit' }}>{heading.text}</Text>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            >
              <Button aria-label="正文大纲" theme="borderless" icon={<TableOfContents size={16} />} />
            </Popover>
          ) : null}
          <Tooltip content={doc.favorited ? '取消收藏' : '收藏'}>
            <Button
              aria-label={doc.favorited ? '取消收藏' : '收藏文档'}
              theme="borderless"
              icon={<Star size={16} fill={doc.favorited ? 'var(--semi-color-warning)' : 'none'}
                style={doc.favorited ? { color: 'var(--semi-color-warning)' } : undefined} />}
              loading={favoriteMutation.isPending}
              onClick={() => favoriteMutation.mutate({ params: { id: doc.id }, body: { favorite: !doc.favorited } })}
            />
          </Tooltip>
          <Tooltip content={doc.subscribed ? '取消订阅（发布/评论通知）' : '订阅更新（发布/评论通知）'}>
            <Button
              aria-label={doc.subscribed ? '取消订阅文档' : '订阅文档更新'}
              theme="borderless"
              icon={<Bell size={16} fill={doc.subscribed ? 'var(--semi-color-primary)' : 'none'}
                style={doc.subscribed ? { color: 'var(--semi-color-primary)' } : undefined} />}
              loading={subscribeMutation.isPending}
              onClick={() => subscribeMutation.mutate(
                { params: { id: doc.id }, body: { subscribe: !doc.subscribed } },
                { onSuccess: () => Toast.success(doc.subscribed ? '已取消订阅' : '已订阅，更新时将通知你') },
              )}
            />
          </Tooltip>
          {canEditDoc && doc.status !== 'pending' ? (
            <Button icon={<Pencil size={14} />} onClick={() => navigate(`/wiki/docs/edit?id=${doc.id}`)}>编辑</Button>
          ) : null}
          {canSubmitDoc && (doc.status === 'draft' || doc.status === 'rejected') ? (
            <Button
              theme="solid"
              icon={<Send size={14} />}
              loading={submitMutation.isPending}
              onClick={() => submitMutation.mutate({ params: { id: doc.id } }, {
                onSuccess: (saved) => Toast.success(saved.status === 'published' ? '已发布' : '已提交审核'),
              })}
            >
              提交发布
            </Button>
          ) : null}
          {doc.status === 'pending' && isDocAuthor ? (
            <Button
              icon={<Undo2 size={14} />}
              loading={withdrawMutation.isPending}
              onClick={() => withdrawMutation.mutate({ params: { id: doc.id } }, { onSuccess: () => Toast.success('已撤回，可继续编辑') })}
            >
              撤回审核
            </Button>
          ) : null}
          <Dropdown
            trigger="click"
            clickToHide
            position="bottomRight"
            render={(
              <Dropdown.Menu>
                <Dropdown.Item icon={<History size={14} />} onClick={() => navigate(`/wiki/docs/history?id=${doc.id}`)}>
                  版本历史
                </Dropdown.Item>
                {canManageDoc && hasPermission('wiki:doc:edit') && doc.status !== 'pending' ? (
                  <Dropdown.Item
                    icon={doc.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                    onClick={() => pinMutation.mutate(
                      { params: { id: doc.id }, body: { isPinned: !doc.isPinned } },
                      { onSuccess: () => Toast.success(doc.isPinned ? '已取消置顶' : '已置顶，目录树中将优先展示') },
                    )}
                  >
                    {doc.isPinned ? '取消置顶' : '置顶'}
                  </Dropdown.Item>
                ) : null}
                {canMoveDoc ? (
                  <Dropdown.Item icon={<FolderInput size={14} />} onClick={() => { setMoveTarget({ id: doc.id, title: doc.title }); setMoveParentId(doc.parentId ?? null); }}>
                    移动
                  </Dropdown.Item>
                ) : null}
                {canDeleteDoc ? (
                  <Dropdown.Item
                    type="danger"
                    icon={<Trash2 size={14} />}
                    onClick={() => confirmDelete({
                      title: `确定要删除「${doc.title}」吗？`,
                      content: '删除后可在回收站还原',
                      onOk: async () => {
                        await deleteMutation.mutateAsync([doc.id]);
                        Toast.success('已移入回收站');
                        setSelectedDocId(undefined);
                      },
                    })}
                  >
                    删除
                  </Dropdown.Item>
                ) : null}
              </Dropdown.Menu>
            )}
          >
            <Button aria-label="更多文档操作" theme="borderless" type="tertiary" icon={<MoreHorizontal size={16} />} />
          </Dropdown>
        </Space>
      </div>

      <Divider margin={12} />

      {doc.status === 'published' && doc.requireReadReceipt && !doc.readConfirmed ? (
        <Banner
          type="warning"
          closeIcon={null}
          style={{ marginBottom: 8 }}
          description="本文档要求阅读确认，请阅读完成后点击确认。"
        >
          <Button
            size="small"
            theme="solid"
            loading={confirmReadMutation.isPending}
            onClick={() => confirmReadMutation.mutate({ params: { id: doc.id } }, { onSuccess: () => Toast.success('已确认阅读') })}
          >
            确认已读
          </Button>
        </Banner>
      ) : null}

      {/* 正文与评论 */}
      <div ref={detailScrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div onClickCapture={handleContentClick}>
          <MarkdownPreviewPanel content={doc.content ?? ''} anchorHeadings style={{ height: 'auto', overflowY: 'visible' }} />
        </div>

        {doc.attachments?.length ? (
          <div style={{ ...READING_COLUMN_STYLE, marginTop: 16 }}>
            <FileAttachment mode="view" value={doc.attachments} title="附件" />
          </div>
        ) : null}

        {prevDoc || nextDoc ? (
          <div style={{ ...READING_COLUMN_STYLE, marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              {prevDoc ? (
                <Button
                  theme="borderless"
                  icon={<ChevronLeft size={14} />}
                  style={{ maxWidth: '48%' }}
                  onClick={() => selectDoc(prevDoc.id)}
                >
                  <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240, color: 'inherit' }}>
                    上一篇：{prevDoc.title}
                  </Text>
                </Button>
              ) : <span />}
              {nextDoc ? (
                <Button
                  theme="borderless"
                  icon={<ChevronRight size={14} />}
                  iconPosition="right"
                  style={{ maxWidth: '48%' }}
                  onClick={() => selectDoc(nextDoc.id)}
                >
                  <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240, color: 'inherit' }}>
                    下一篇：{nextDoc.title}
                  </Text>
                </Button>
              ) : <span />}
            </div>
          </div>
        ) : null}

        {doc.status === 'published' ? (
          <div style={{ ...READING_COLUMN_STYLE, marginTop: 24, paddingBottom: 32 }}>
            <Divider align="left"><MessageSquare size={14} style={{ verticalAlign: -2, marginRight: 4 }} />评论（{doc.commentCount ?? 0}）</Divider>
            <div>
              {commentsEnabled ? (
                <>
                  {replyTo ? (
                    <div style={{ marginBottom: 4 }}>
                      <Tag closable onClose={() => setReplyTo(null)}>回复 {replyTo.authorName ?? '评论'}</Tag>
                    </div>
                  ) : null}
                  <TextArea
                    value={commentText}
                    onChange={setCommentText}
                    placeholder="写下你的评论..."
                    rows={2}
                    maxCount={1000}
                  />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <Space spacing={8}>
                      <Select
                        multiple
                        size="small"
                        style={{ minWidth: 160 }}
                        placeholder="@ 提及同事（选填）"
                        value={mentionIds}
                        maxTagCount={2}
                        showClear
                        filter
                        onChange={(v) => setMentionIds((v as number[]) ?? [])}
                        optionList={(usersQuery.data ?? []).map((u) => ({ value: u.id, label: u.nickname || u.username }))}
                      />
                      <Checkbox checked={isQuestion} onChange={(e) => setIsQuestion(!!e.target.checked)}>
                        标记为问题
                      </Checkbox>
                    </Space>
                    <Button
                      theme="solid"
                      loading={createCommentMutation.isPending}
                      disabled={!commentText.trim()}
                      onClick={handleSubmitComment}
                    >
                      发表评论
                    </Button>
                  </div>
                </>
              ) : (
                <Banner
                  type="info"
                  closeIcon={null}
                  style={{ marginBottom: 12 }}
                  description="管理员已暂停新评论，已有评论仍可查看。"
                />
              )}
              <div>
                {(commentsQuery.data ?? []).map((c) => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    canDelete={(cm) => cm.authorId === user?.id}
                    canResolve={(cm) => cm.authorId === user?.id || isDocAuthor || canManageDoc}
                    onReply={(cm) => setReplyTo(cm)}
                    onResolve={(cm) => resolveCommentMutation.mutate(
                      { params: { id: cm.id } },
                      { onSuccess: () => Toast.success('已标记解决') },
                    )}
                    onDelete={(cm) => confirmDelete({
                      title: '确定要删除这条评论吗？',
                      onOk: async () => {
                        await deleteCommentMutation.mutateAsync({ id: cm.id, docId: cm.docId });
                        Toast.success('删除成功');
                      },
                    })}
                  />
                ))}
                {commentsQuery.data?.length === 0 ? <Text type="tertiary">暂无评论，来抢沙发</Text> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="page-container page-container--stretch">
      <MasterDetailLayout
        persistKey="wiki-doc-center"
        defaultSize={280}
        minSize={220}
        maxSize={420}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        showDetail={showDetailOnNarrow}
        onBack={() => setShowDetailOnNarrow(false)}
        onResponsiveChange={(narrow) => {
          isNarrowLayoutRef.current = narrow;
          if (!narrow) setSelectedDocId((current) => current ?? treeDocIds[0]);
        }}
        master={(
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <MasterDetailLayout.Header
              extra={canWrite && hasPermission('wiki:doc:create') ? (
                <>
                  <Tooltip content="导入 Markdown 文件">
                    <Button
                      aria-label="导入 Markdown 文件"
                      size="small"
                      theme="borderless"
                      icon={<FileUp size={15} />}
                      loading={importMutation.isPending}
                      onClick={() => importInputRef.current?.click()}
                    />
                  </Tooltip>
                  <Tooltip content="新建文档">
                    <Button
                      aria-label="新建文档"
                      size="small"
                      theme="borderless"
                      icon={<FilePlus2 size={15} />}
                      onClick={() => navigate(`/wiki/docs/edit?spaceId=${effectiveSpaceId}`)}
                    />
                  </Tooltip>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".md,.markdown,.txt"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => void handleImportFiles(e.target.files)}
                  />
                </>
              ) : null}
            >
              <Select
                style={{ width: '100%' }}
                placeholder="选择知识空间"
                value={effectiveSpaceId}
                loading={spacesQuery.isPending}
                onChange={(v) => {
                  setSpaceId(v as number);
                  setSelectedDocId(undefined);
                  setShowDetailOnNarrow(false);
                }}
                optionList={spaces.map((s) => ({ value: s.id, label: s.name }))}
              />
            </MasterDetailLayout.Header>
            <MasterDetailLayout.Body padding={8}>
              <Tabs
                type="button"
                size="small"
                collapsible="auto"
                activeKey={masterTab}
                onChange={setMasterTab}
                tabBarExtraContent={masterTab === 'tree' && treeBranchKeys.length > 0 ? (
                  <Tooltip content={isAllExpanded ? '收起全部' : '展开全部'}>
                    <Button
                      aria-label={isAllExpanded ? '收起全部目录' : '展开全部目录'}
                      size="small"
                      theme="borderless"
                      type="tertiary"
                      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                      onClick={() => applyExpandedKeys(isAllExpanded ? [] : treeBranchKeys)}
                    />
                  </Tooltip>
                ) : null}
              >
                <Tabs.TabPane tab="目录" itemKey="tree">
                  {treeQuery.isPending && effectiveSpaceId !== undefined ? (
                    <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
                  ) : treeData.length === 0 ? (
                    <Empty description="空间还没有文档" style={{ marginTop: 32 }}>
                      {canCreateInTree ? (
                        <div style={{ textAlign: 'center' }}>
                          <Button theme="solid" icon={<FilePlus2 size={14} />} onClick={() => navigate(`/wiki/docs/edit?spaceId=${effectiveSpaceId}`)}>
                            新建文档
                          </Button>
                        </div>
                      ) : null}
                    </Empty>
                  ) : (
                    <Tree
                      treeData={treeData}
                      value={selectedDocId !== undefined ? String(selectedDocId) : undefined}
                      onChange={(v) => selectDoc(Number(v))}
                      filterTreeNode
                      treeNodeFilterProp="titleText"
                      showFilteredOnly
                      searchPlaceholder="搜索文档标题..."
                      onSearch={(input) => setTreeSearching(!!input)}
                      draggable={canDragTree && !treeSearching}
                      onDrop={handleTreeDrop}
                      expandedKeys={expandedKeys}
                      onExpand={(keys) => applyExpandedKeys(keys)}
                    />
                  )}
                </Tabs.TabPane>
                <Tabs.TabPane tab="收藏" itemKey="favorites">
                  <List
                    loading={favoritesQuery.isFetching}
                    dataSource={favoritesQuery.data?.list ?? []}
                    emptyContent={<Empty description="还没有收藏的文档" />}
                    renderItem={(item) => (
                      <List.Item
                        style={{ cursor: 'pointer', padding: '8px 8px' }}
                        onClick={() => selectDoc(item.id)}
                        main={(
                          <div style={{ minWidth: 0 }}>
                            <Text ellipsis={{ showTooltip: true }} style={{ width: '100%' }}>{item.title}</Text>
                            <div><Text type="tertiary" size="small">{item.spaceName}</Text></div>
                          </div>
                        )}
                      />
                    )}
                  />
                </Tabs.TabPane>
                <Tabs.TabPane tab="最近" itemKey="recent">
                  <List
                    loading={recentQuery.isFetching}
                    dataSource={recentQuery.data ?? []}
                    emptyContent={<Empty description="还没有浏览记录" />}
                    renderItem={(item) => (
                      <List.Item
                        style={{ cursor: 'pointer', padding: '8px 8px' }}
                        onClick={() => selectDoc(item.id)}
                        main={(
                          <div style={{ minWidth: 0 }}>
                            <Text ellipsis={{ showTooltip: true }} style={{ width: '100%' }}>{item.title}</Text>
                            <div><Text type="tertiary" size="small">{item.spaceName}</Text></div>
                          </div>
                        )}
                      />
                    )}
                  />
                </Tabs.TabPane>
                <Tabs.TabPane tab="我的" itemKey="mine">
                  <List
                    loading={myDocsQuery.isFetching}
                    dataSource={myDocsQuery.data?.list ?? []}
                    emptyContent={<Empty description="还没有创建过文档" />}
                    renderItem={(item) => (
                      <List.Item
                        style={{ cursor: 'pointer', padding: '8px 8px' }}
                        onClick={() => selectDoc(item.id)}
                        main={(
                          <div style={{ minWidth: 0 }}>
                            <Space spacing={4}>
                              <Text ellipsis={{ showTooltip: true }}>{item.title}</Text>
                              <Tag size="small" color={WIKI_DOC_STATUS_TAG_COLOR[item.status]}>{WIKI_DOC_STATUS_LABELS[item.status]}</Tag>
                            </Space>
                            <div><Text type="tertiary" size="small">{item.spaceName} · {item.updatedAt}</Text></div>
                          </div>
                        )}
                      />
                    )}
                  />
                </Tabs.TabPane>
                <Tabs.TabPane tab="搜索" itemKey="search">
                  <div style={{ padding: '4px 0 8px' }}>
                    <KeywordInput
                      placeholder="搜索标题、摘要、正文..."
                      style={{ width: '100%' }}
                      value={searchDraft}
                      onChange={setSearchDraft}
                      onSearch={() => setSearchKeyword(searchDraft.trim())}
                    />
                  </div>
                  {searchKeyword === '' ? (
                    <Empty description="输入关键词后回车检索全部可访问空间" style={{ marginTop: 32 }} />
                  ) : (
                    <List
                      loading={searchQuery.isFetching}
                      dataSource={searchQuery.data?.list ?? []}
                      emptyContent={<Empty description={`没有找到与「${searchKeyword}」相关的文档`} />}
                      renderItem={(item) => (
                        <List.Item
                          style={{ cursor: 'pointer', padding: '8px 8px' }}
                          onClick={() => selectSearchResult(item.id)}
                          main={(
                            <div style={{ minWidth: 0 }}>
                              <Text ellipsis={{ showTooltip: true }} style={{ width: '100%' }}>{item.title}</Text>
                              {item.snippet ? (
                                <Text type="tertiary" size="small" ellipsis={{ rows: 2 }} style={{ width: '100%' }}>
                                  {item.snippet}
                                </Text>
                              ) : null}
                              <div><Text type="quaternary" size="small">{item.spaceName}</Text></div>
                            </div>
                          )}
                        />
                      )}
                    />
                  )}
                </Tabs.TabPane>
              </Tabs>
            </MasterDetailLayout.Body>
          </div>
        )}
        detail={(
          <MasterDetailLayout.Body padding="0 0 0 16px">
            {detailContent}
          </MasterDetailLayout.Body>
        )}
      />

      {/* 移动文档弹窗 */}
      <AppModal
        title={`移动「${moveTarget?.title ?? ''}」`}
        visible={!!moveTarget}
        closeOnEsc
        width={480}
        onCancel={() => setMoveTarget(null)}
        onOk={() => {
          if (!moveTarget) return;
          moveMutation.mutate(
            { params: { id: moveTarget.id }, body: { parentId: moveParentId } },
            {
              onSuccess: () => {
                Toast.success('移动成功');
                // 移入的目标层级保持展开，落点立即可见
                if (moveParentId !== null) {
                  setExpandedKeys((keys) => (keys.includes(String(moveParentId)) ? keys : [...keys, String(moveParentId)]));
                }
                setMoveTarget(null);
              },
            },
          );
        }}
        okButtonProps={{ loading: moveMutation.isPending }}
      >
        <TreeSelect
          style={{ width: '100%' }}
          placeholder="选择目标父文档，留空则移动到根级"
          treeData={toMoveTreeData(treeQuery.data ?? [], moveTarget?.id ?? -1)}
          value={moveParentId ?? undefined}
          onChange={(v) => setMoveParentId(v === undefined ? null : Number(v))}
          showClear
          filterTreeNode
        />
      </AppModal>

      {/* 阅读确认名单弹窗 */}
      <AppModal
        title="阅读确认情况"
        visible={receiptsVisible}
        closeOnEsc
        width={520}
        footer={null}
        onCancel={() => setReceiptsVisible(false)}
      >
        <Spin spinning={receiptsQuery.isFetching}>
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            <Text strong>已确认（{receiptsQuery.data?.confirmed.length ?? 0}）</Text>
            <div style={{ margin: '8px 0 16px' }}>
              {(receiptsQuery.data?.confirmed ?? []).map((r) => (
                <div key={r.userId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <Text>{r.nickname}</Text>
                  <Text type="tertiary" size="small">{r.confirmedAt}</Text>
                </div>
              ))}
              {receiptsQuery.data?.confirmed.length === 0 ? <Text type="tertiary">还没有人确认</Text> : null}
            </div>
            <Text strong>未确认（{receiptsQuery.data?.unconfirmed.length ?? 0}）</Text>
            <div style={{ marginTop: 8 }}>
              {(receiptsQuery.data?.unconfirmed ?? []).map((r) => (
                <Tag key={r.userId} size="small" style={{ margin: '0 6px 6px 0' }}>{r.nickname}</Tag>
              ))}
              {receiptsQuery.data?.unconfirmed.length === 0 ? <Text type="tertiary">空间成员均已确认</Text> : null}
            </div>
          </div>
        </Spin>
      </AppModal>
    </div>
  );
}
