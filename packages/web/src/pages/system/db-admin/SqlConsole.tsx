import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import {
  Banner, Button, Dropdown, Empty, Form, List, Popconfirm, SideSheet,
  Space, Spin, Tag, Toast, Tooltip, Typography,
} from '@douyinfe/semi-ui';
import {
  Play, Eye, Download, Plus, X, Bookmark, BookmarkPlus, ArrowRight, Pencil, Trash2,
  Sparkles, Copy, Code,
} from 'lucide-react';
import type { editor as MonacoEditor, KeyMod as KeyModT, KeyCode as KeyCodeT, Position } from 'monaco-editor';
import Editor from '@monaco-editor/react';
import { format as formatSql } from 'sql-formatter';
import { TOKEN_KEY } from '@zenith/shared';
import type { DbQueryFavorite } from '@zenith/shared';
import { config } from '@/config';
import { request } from '@/utils/request';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { ExplainView } from './ExplainView';
import { rowsToJson, rowsToMarkdown } from './result-format';
import { copyToClipboard } from './sql-format';

const { Text } = Typography;

interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

interface ConsoleTableRef {
  schema: string;
  name: string;
  kind?: string;
  sizeText?: string;
  comment?: string | null;
}

interface ConsoleTab {
  id: number;
  title: string;
  sql: string;
  result: QueryResult | null;
  error: string | null;
}

export interface SqlConsoleHandle {
  loadSql: (sql: string, opts?: { newTab?: boolean }) => void;
}

interface SqlConsoleProps {
  tables: ConsoleTableRef[];
  structureColumnsCache: React.RefObject<Map<string, string[]>>;
  canQuery: boolean;
  canExport: boolean;
  monacoTheme: string;
}

const DEFAULT_SQL = '-- 只读模式：仅允许 SELECT / EXPLAIN 等查询语句\nSELECT * FROM users LIMIT 50;';

// ─── Monaco SQL 自动补全（全局注册一次，读模块级最新数据，避免重复注册） ──────────
let completionTables: ConsoleTableRef[] = [];
let completionColumns: Map<string, string[]> = new Map();
let completionDisposable: { dispose: () => void } | null = null;

function renderResultCell(v: unknown): React.ReactNode {
  if (v == null) return <Text type="quaternary">NULL</Text>;
  if (typeof v === 'object') return <Text code>{JSON.stringify(v)}</Text>;
  let str: string;
  if (typeof v === 'string') str = v;
  else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') str = v.toString();
  else str = JSON.stringify(v);
  if (str.length > 80) {
    return <Tooltip content={<div style={{ maxWidth: 400, wordBreak: 'break-all' }}>{str}</div>}>{str.slice(0, 80) + '…'}</Tooltip>;
  }
  return str;
}

export const SqlConsole = forwardRef<SqlConsoleHandle, SqlConsoleProps>(function SqlConsole(props, ref) {
  const { tables, structureColumnsCache, canQuery, canExport, monacoTheme } = props;

  const [tabs, setTabs] = useState<ConsoleTab[]>([
    { id: 1, title: '查询 1', sql: DEFAULT_SQL, result: null, error: null },
  ]);
  const [activeId, setActiveId] = useState(1);
  const nextIdRef = useRef(2);

  const [queryLoading, setQueryLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [exportJsonLoading, setExportJsonLoading] = useState(false);

  // EXPLAIN
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainData, setExplainData] = useState<unknown>(null);
  const [explainAnalyzed, setExplainAnalyzed] = useState(false);
  const [explainDuration, setExplainDuration] = useState(0);

  // 收藏夹
  const [favOpen, setFavOpen] = useState(false);
  const [favorites, setFavorites] = useState<DbQueryFavorite[]>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [saveFavOpen, setSaveFavOpen] = useState(false);
  const [saveFavLoading, setSaveFavLoading] = useState(false);
  const [editFav, setEditFav] = useState<DbQueryFavorite | null>(null);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const runQueryRef = useRef<() => void>(() => undefined);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  useEffect(() => { completionTables = tables; }, [tables]);
  useEffect(() => { completionColumns = structureColumnsCache.current ?? new Map(); }, [structureColumnsCache, tables]);

  const patchActive = useCallback((patch: Partial<ConsoleTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, ...patch } : t)));
  }, [activeId]);

  const addTab = useCallback((sql = DEFAULT_SQL, title?: string) => {
    const id = nextIdRef.current++;
    setTabs((prev) => [...prev, { id, title: title ?? `查询 ${id}`, sql, result: null, error: null }]);
    setActiveId(id);
    return id;
  }, []);

  const closeTab = useCallback((id: number) => {
    setTabs((prev) => {
      if (prev.length === 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next[Math.max(0, idx - 1)];
        setActiveId(fallback.id);
      }
      return next;
    });
  }, [activeId]);

  useImperativeHandle(ref, () => ({
    loadSql: (sqlText: string, opts?: { newTab?: boolean }) => {
      if (opts?.newTab) {
        addTab(sqlText);
      } else {
        setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, sql: sqlText } : t)));
        editorRef.current?.setValue(sqlText);
      }
    },
  }), [activeId, addTab]);

  const runQuery = useCallback(async () => {
    const text = editorRef.current?.getValue() ?? activeTab.sql;
    if (!text.trim()) { Toast.warning('请输入 SQL'); return; }
    setQueryLoading(true);
    patchActive({ error: null, result: null });
    const res = await request.post<QueryResult>('/api/db-admin/query', { sql: text }, { silent: true });
    setQueryLoading(false);
    if (res.code === 0 && res.data) {
      patchActive({ result: res.data, error: null });
      if (res.data.truncated) Toast.warning('结果超出 5000 行已截断');
      else Toast.success(`返回 ${res.data.rowCount} 行 / ${res.data.durationMs}ms`);
    } else {
      patchActive({ error: res.message ?? '执行失败', result: null });
    }
  }, [activeTab.sql, patchActive]);

  useEffect(() => { runQueryRef.current = () => { void runQuery(); }; });

  const runExplain = useCallback(async (analyze: boolean) => {
    const text = editorRef.current?.getValue() ?? activeTab.sql;
    if (!text.trim()) { Toast.warning('请输入 SQL'); return; }
    setExplainLoading(true);
    setExplainOpen(true);
    const res = await request.post<{ plan: unknown; durationMs: number; analyzed: boolean }>(
      '/api/db-admin/explain', { sql: text, analyze }, { silent: true },
    );
    setExplainLoading(false);
    if (res.code === 0 && res.data) {
      setExplainData(res.data.plan);
      setExplainAnalyzed(res.data.analyzed);
      setExplainDuration(res.data.durationMs);
    } else {
      setExplainOpen(false);
      Toast.error(res.message ?? 'EXPLAIN 失败');
    }
  }, [activeTab.sql]);

  const formatCurrentSql = useCallback(() => {
    const text = editorRef.current?.getValue() ?? activeTab.sql;
    if (!text.trim()) return;
    try {
      const formatted = formatSql(text, { language: 'postgresql', keywordCase: 'upper', tabWidth: 2 });
      editorRef.current?.setValue(formatted);
      patchActive({ sql: formatted });
      Toast.success('已格式化');
    } catch {
      Toast.error('格式化失败：SQL 语法可能有误');
    }
  }, [activeTab.sql, patchActive]);

  const downloadStream = useCallback(async (path: string, filename: string, kind: 'csv' | 'json') => {
    const text = editorRef.current?.getValue() ?? activeTab.sql;
    if (!text.trim()) { Toast.warning('请输入 SQL'); return; }
    const token = localStorage.getItem(TOKEN_KEY);
    const setLoading = kind === 'csv' ? setExportCsvLoading : setExportJsonLoading;
    setLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ sql: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        Toast.error((err as { message?: string })?.message ?? '导出失败');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      Toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [activeTab.sql]);

  // ─── 结果集复制 ──────────────────────────────────────────────────────────────
  const copyResultAs = useCallback(async (fmt: 'json' | 'markdown') => {
    const r = activeTab.result;
    if (!r || r.rows.length === 0) { Toast.warning('无结果可复制'); return; }
    const text = fmt === 'json' ? rowsToJson(r.rows) : rowsToMarkdown(r.columns, r.rows);
    const ok = await copyToClipboard(text);
    if (ok) Toast.success(`已复制为 ${fmt === 'json' ? 'JSON' : 'Markdown'}`);
    else Toast.warning('复制失败');
  }, [activeTab.result]);

  // ─── 收藏夹 ─────────────────────────────────────────────────────────────────
  const loadFavorites = useCallback(async () => {
    setFavLoading(true);
    const res = await request.get<DbQueryFavorite[]>('/api/db-admin/query-favorites');
    if (res.code === 0) setFavorites(res.data ?? []);
    setFavLoading(false);
  }, []);

  const openFavorites = useCallback(() => { setFavOpen(true); void loadFavorites(); }, [loadFavorites]);

  const handleSaveFavorite = useCallback(async (values: { name: string; description?: string; tags?: string }) => {
    setSaveFavLoading(true);
    const tags = values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    if (editFav) {
      const res = await request.put<DbQueryFavorite>(`/api/db-admin/query-favorites/${editFav.id}`, {
        name: values.name, description: values.description, tags, sql: editFav.sql,
      });
      if (res.code === 0) { Toast.success('已更新'); setSaveFavOpen(false); setEditFav(null); void loadFavorites(); }
    } else {
      const res = await request.post<DbQueryFavorite>('/api/db-admin/query-favorites', {
        name: values.name, sql: editorRef.current?.getValue() ?? activeTab.sql, description: values.description, tags,
      });
      if (res.code === 0) { Toast.success('已收藏'); setSaveFavOpen(false); void loadFavorites(); }
    }
    setSaveFavLoading(false);
  }, [editFav, activeTab.sql, loadFavorites]);

  const handleDeleteFavorite = useCallback(async (id: number) => {
    const res = await request.delete(`/api/db-admin/query-favorites/${id}`);
    if (res.code === 0) { Toast.success('已删除'); void loadFavorites(); }
  }, [loadFavorites]);

  const loadFavoriteToEditor = useCallback((fav: DbQueryFavorite) => {
    addTab(fav.sql, fav.name.slice(0, 12));
    setFavOpen(false);
    Toast.success(`已加载「${fav.name}」`);
  }, [addTab]);

  const resultColumns = useMemo(() => {
    if (!activeTab.result) return [];
    return activeTab.result.columns.map((c) => ({
      title: (
        <Space spacing={4}>
          <Text>{c.name}</Text>
          {c.dataType && <Text type="tertiary" size="small">{c.dataType}</Text>}
        </Space>
      ),
      dataIndex: c.name,
      key: c.name,
      width: 180,
      ellipsis: { showTitle: false },
      render: renderResultCell,
    }));
  }, [activeTab.result]);

  const result = activeTab.result;
  const error = activeTab.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'auto' }}>
      {/* 标签页条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => setActiveId(t.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveId(t.id); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '4px 10px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--semi-color-border)',
                background: active ? 'var(--semi-color-primary-light-default)' : 'var(--semi-color-bg-1)',
                color: active ? 'var(--semi-color-primary)' : 'var(--semi-color-text-1)',
              }}
            >
              <Code size={13} />
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              {tabs.length > 1 && (
                <X
                  size={13}
                  onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                  style={{ opacity: 0.6 }}
                />
              )}
            </div>
          );
        })}
        <Tooltip content="新建查询标签">
          <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={() => addTab()} />
        </Tooltip>
      </div>

      <div style={{ width: '100%', border: '1px solid var(--semi-color-border)', borderRadius: 6, overflow: 'hidden' }}>
        <Editor
          key="db-admin-sql-editor"
          height="240px"
          defaultLanguage="sql"
          theme={monacoTheme}
          value={activeTab.sql}
          onChange={(v) => patchActive({ sql: v ?? '' })}
          onMount={(ed, monaco) => {
            editorRef.current = ed;
            const KeyMod = monaco.KeyMod as typeof KeyModT;
            const KeyCode = monaco.KeyCode as typeof KeyCodeT;
            ed.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => runQueryRef.current());
            ed.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF, () => formatCurrentSql());
            completionDisposable?.dispose();
            completionDisposable = monaco.languages.registerCompletionItemProvider('sql', {
              triggerCharacters: ['.', ' '],
              provideCompletionItems: (model: MonacoEditor.ITextModel, position: Position) => {
                const word = model.getWordUntilPosition(position);
                const range = {
                  startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                  startColumn: word.startColumn, endColumn: word.endColumn,
                };
                const lineUpToCursor = model.getValueInRange({
                  startLineNumber: position.lineNumber, startColumn: 1,
                  endLineNumber: position.lineNumber, endColumn: position.column,
                });
                const dotMatch = /([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\.$/.exec(lineUpToCursor);
                if (dotMatch) {
                  const refName = dotMatch[1];
                  const cache = completionColumns;
                  let cols: string[] | undefined;
                  if (refName.includes('.')) {
                    cols = cache.get(refName);
                  } else {
                    cols = cache.get(`public.${refName}`) ?? cache.get(refName);
                    if (!cols) {
                      for (const [k, v] of cache.entries()) {
                        if (k.endsWith(`.${refName}`)) { cols = v; break; }
                      }
                    }
                  }
                  if (cols && cols.length > 0) {
                    return {
                      suggestions: cols.map((col) => ({
                        label: col, kind: monaco.languages.CompletionItemKind.Field,
                        insertText: col, detail: `${refName} 字段`, range,
                      })),
                    };
                  }
                }
                const suggestions = completionTables.flatMap((t) => {
                  const full = `${t.schema}.${t.name}`;
                  const detail = t.comment ? `${t.sizeText ?? ''} · ${t.comment}` : (t.sizeText ?? '');
                  const items = [{
                    label: full, kind: monaco.languages.CompletionItemKind.Class,
                    insertText: full, detail, range,
                  }];
                  if (t.schema === 'public') {
                    items.push({
                      label: t.name, kind: monaco.languages.CompletionItemKind.Class,
                      insertText: t.name, detail, range,
                    });
                  }
                  return items;
                });
                return { suggestions };
              },
            });
          }}
          options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true, wordWrap: 'on' }}
        />
      </div>

      <Space wrap style={{ marginTop: 8 }}>
        <Tooltip content="只读模式，仅允许 SELECT / EXPLAIN 等查询语句">
          <Button type="primary" icon={<Play size={14} />} onClick={() => void runQuery()} loading={queryLoading} disabled={!canQuery}>执行</Button>
        </Tooltip>
        <Dropdown
          trigger="click"
          render={(
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => void runExplain(false)}>EXPLAIN（估算计划）</Dropdown.Item>
              <Dropdown.Item onClick={() => void runExplain(true)}>EXPLAIN ANALYZE（实际执行）</Dropdown.Item>
            </Dropdown.Menu>
          )}
        >
          <Button icon={<Eye size={14} />} disabled={!canQuery}>查询计划</Button>
        </Dropdown>
        <Tooltip content="格式化 SQL（Ctrl+Shift+F）">
          <Button icon={<Sparkles size={14} />} onClick={formatCurrentSql}>格式化</Button>
        </Tooltip>
        <Dropdown
          trigger="click"
          render={(
            <Dropdown.Menu>
              <Dropdown.Item icon={<Download size={14} />} onClick={() => void downloadStream('/api/db-admin/query/export.csv', `query_${Date.now()}.csv`, 'csv')}>导出 CSV</Dropdown.Item>
              <Dropdown.Item icon={<Download size={14} />} onClick={() => void downloadStream('/api/db-admin/query/export.json', `query_${Date.now()}.json`, 'json')}>导出 JSON</Dropdown.Item>
            </Dropdown.Menu>
          )}
        >
          <Button icon={<Download size={14} />} disabled={!canExport} loading={exportCsvLoading || exportJsonLoading}>导出</Button>
        </Dropdown>
        <Button icon={<BookmarkPlus size={14} />} onClick={() => { setEditFav(null); setSaveFavOpen(true); }} disabled={!canQuery}>收藏</Button>
        <Button icon={<Bookmark size={14} />} onClick={openFavorites}>收藏夹{favorites.length > 0 ? ` (${favorites.length})` : ''}</Button>
        <Text type="tertiary" size="small">Ctrl+Enter 执行 · Ctrl+Shift+F 格式化 · 硬上限 5000 行 / 60 秒</Text>
      </Space>

      {error && <Text type="danger" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{error}</Text>}

      {result && (
        <div style={{ width: '100%', marginTop: 8 }}>
          {result.truncated && (
            <Banner
              type="warning"
              fullMode={false}
              closeIcon={null}
              description={`结果已截断为前 ${result.rowCount} 行，请在 SQL 中加 LIMIT 或缩窄筛选条件以查看完整数据。`}
              style={{ marginBottom: 8 }}
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Space>
              <Tag color="blue">{result.rowCount} 行</Tag>
              <Tag color="grey">{result.durationMs}ms</Tag>
              {result.truncated && <Tag color="orange">已截断</Tag>}
            </Space>
            {result.rows.length > 0 && (
              <Dropdown
                trigger="click"
                position="bottomRight"
                render={(
                  <Dropdown.Menu>
                    <Dropdown.Item icon={<Copy size={14} />} onClick={() => void copyResultAs('json')}>复制为 JSON</Dropdown.Item>
                    <Dropdown.Item icon={<Copy size={14} />} onClick={() => void copyResultAs('markdown')}>复制为 Markdown 表格</Dropdown.Item>
                  </Dropdown.Menu>
                )}
              >
                <Button size="small" icon={<Copy size={14} />}>复制</Button>
              </Dropdown>
            )}
          </div>
          {result.rows.length === 0 ? <Empty title="无结果" /> : (
            <ConfigurableTable
              bordered
              columns={resultColumns}
              dataSource={result.rows.map((r, i) => ({ ...r, __key: i }))}
              rowKey="__key"
              pagination={{ pageSize: 20, pageSizeOpts: [20, 50, 100] }}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}
        </div>
      )}

      {/* EXPLAIN 结果 */}
      <AppModal
        title="查询计划 (EXPLAIN)"
        visible={explainOpen}
        onCancel={() => setExplainOpen(false)}
        footer={null}
        width={860}
      >
        {explainLoading
          ? <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
          : <ExplainView plan={explainData} analyzed={explainAnalyzed} durationMs={explainDuration} />}
      </AppModal>

      {/* 收藏夹面板 */}
      <SideSheet
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
            <Space><Bookmark size={16} /><span>SQL 收藏夹</span></Space>
            <Button type="primary" size="small" icon={<BookmarkPlus size={13} />} onClick={() => { setEditFav(null); setSaveFavOpen(true); }}>收藏当前 SQL</Button>
          </div>
        }
        visible={favOpen}
        onCancel={() => setFavOpen(false)}
        width={500}
      >
        <Spin spinning={favLoading}>
          {favorites.length === 0 && !favLoading && (
            <Empty title="暂无收藏" description="在控制台执行 SQL 后可点击「收藏」保存常用语句" />
          )}
          <List
            dataSource={favorites}
            renderItem={(fav) => (
              <List.Item
                key={fav.id}
                style={{ padding: '10px 4px', borderBottom: '1px solid var(--semi-color-border)' }}
                main={
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fav.name}</span>
                      {fav.tags.map((tag) => <Tag key={tag} size="small" color="blue">{tag}</Tag>)}
                    </div>
                    {fav.description && (
                      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 4 }}>{fav.description}</Typography.Text>
                    )}
                    <Typography.Text
                      ellipsis={{ rows: 2 }}
                      style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--semi-color-text-2)', whiteSpace: 'pre' }}
                    >{fav.sql}</Typography.Text>
                  </div>
                }
                extra={
                  <Space style={{ flexShrink: 0, marginLeft: 8 }}>
                    <Button size="small" type="primary" theme="borderless" icon={<ArrowRight size={14} />} onClick={() => loadFavoriteToEditor(fav)}>加载</Button>
                    <Button size="small" theme="borderless" icon={<Pencil size={14} />} onClick={() => { setEditFav(fav); setSaveFavOpen(true); }} />
                    <Popconfirm title="确定删除这条收藏？" onConfirm={() => void handleDeleteFavorite(fav.id)}>
                      <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} />
                    </Popconfirm>
                  </Space>
                }
              />
            )}
          />
        </Spin>
      </SideSheet>

      {/* 保存 / 编辑收藏 */}
      <AppModal
        title={editFav ? '编辑收藏' : '收藏 SQL'}
        visible={saveFavOpen}
        onCancel={() => { setSaveFavOpen(false); setEditFav(null); }}
        footer={null}
        width={480}
      >
        <Form
          onSubmit={(values) => void handleSaveFavorite(values as { name: string; description?: string; tags?: string })}
          layout="vertical"
          initValues={editFav
            ? { name: editFav.name, description: editFav.description ?? '', tags: editFav.tags.join(', ') }
            : { name: formatDateTime(new Date()) }}
        >
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} placeholder="为这条 SQL 起个名字" style={{ width: '100%' }} />
          <Form.TextArea field="description" label="备注" placeholder="可选，描述这条 SQL 的用途" style={{ width: '100%' }} />
          <Form.Input field="tags" label="标签" placeholder="多个标签用逗号分隔，如：报表, 监控" style={{ width: '100%' }} />
          {!editFav && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>将收藏当前编辑器中的 SQL 内容</Typography.Text>
          )}
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => { setSaveFavOpen(false); setEditFav(null); }}>取消</Button>
            <Button type="primary" htmlType="submit" loading={saveFavLoading}>保存</Button>
          </Space>
        </Form>
      </AppModal>
    </div>
  );
});

SqlConsole.displayName = 'SqlConsole';
