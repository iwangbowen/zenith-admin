import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button, Input, Tag, Space, Modal, Toast, Spin, Typography, Dropdown } from '@douyinfe/semi-ui';
import { buildSearchMatchMap, findMatchRanges } from './logFilesSearch';
import { RefreshCw, FileText, Activity, StopCircle, Download, Trash2, Search, ListOrdered, MoreHorizontal } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { formatFileSize } from '@/utils/file-utils';
import { usePermission } from '@/hooks/usePermission';
import { config } from '@/config';
import { TOKEN_KEY } from '@zenith/shared';

interface LogFile {
  name: string;
  size: number;
  modifiedAt: string;
  isGzip: boolean;
}

export default function LogFilesPage() {
  const { hasPermission } = usePermission();
  const [files, setFiles] = useState<LogFile[]>([]);
  const [keyword, setKeyword] = useState('');
  const [contentKeyword, setContentKeyword] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [selected, setSelected] = useState<LogFile | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [tailing, setTailing] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const tailAbortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const lineRefs = useRef<Array<HTMLSpanElement | null>>([]);

  const fetchFiles = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await request.get<LogFile[]>('/api/log-files');
      if (res.code === 0) setFiles(res.data ?? []);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const filteredFiles = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return files;
    return files.filter((file) => file.name.toLowerCase().includes(normalizedKeyword));
  }, [files, keyword]);

  // 自动滚动到底部
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines]);

  const loadContent = useCallback(async (file: LogFile) => {
    setLines([]);
    setContentLoading(true);
    try {
      const query = new URLSearchParams({ lines: '5000' });
      const res = await request.get<{ lines: string[] }>(`/api/log-files/${encodeURIComponent(file.name)}/content?${query.toString()}`);
      if (res.code === 0) setLines(res.data.lines ?? []);
    } finally {
      setContentLoading(false);
    }
  }, []);

  const stopTail = useCallback(() => {
    tailAbortRef.current?.abort();
    tailAbortRef.current = null;
    setTailing(false);
  }, []);

  const selectFile = (file: LogFile) => {
    if (selected?.name === file.name) return;
    stopTail();
    setSelected(file);
    setContentKeyword('');
    setActiveMatchIndex(0);
    void loadContent(file);
  };

  const normalizedContentKeyword = contentKeyword.trim();
  const hasContentSearch = normalizedContentKeyword.length > 0;
  const searchMatches = useMemo(() => buildSearchMatchMap(lines, normalizedContentKeyword), [lines, normalizedContentKeyword]);
  const lineNumberDigits = Math.max(2, String(lines.length).length);

  const jumpToMatch = useCallback((direction: -1 | 1) => {
    if (searchMatches.length === 0) return;

    setActiveMatchIndex((prev) => (prev + direction + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveMatchIndex(0);
      return;
    }

    const currentMatchIndex = activeMatchIndex >= searchMatches.length ? 0 : activeMatchIndex;
    const activeMatch = searchMatches[currentMatchIndex];
    const targetLine = lineRefs.current[activeMatch.lineIndex];
    if (targetLine) {
      targetLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeMatchIndex, searchMatches]);

  const handleContentSearch = useCallback(() => {
    if (!searchMatches.length) return;
    setActiveMatchIndex(0);
  }, [searchMatches.length]);

  const handleContentSearchReset = useCallback(() => {
    setContentKeyword('');
    setActiveMatchIndex(0);
    stopTail();
    if (selected) {
      void loadContent(selected);
    }
  }, [loadContent, selected, stopTail]);

  const toggleTail = async () => {
    if (tailing) { stopTail(); return; }
    if (!selected) return;

    const ctrl = new AbortController();
    tailAbortRef.current = ctrl;
    setTailing(true);
    setLines([]);

    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`${config.apiBaseUrl}/api/log-files/${encodeURIComponent(selected.name)}/tail`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) { setTailing(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (part.startsWith('data:')) {
            const line = part.slice(5).trimStart();
            if (line) setLines(prev => [...prev.slice(-999), line]);
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      Toast.error('实时追踪连接失败');
    } finally {
      setTailing(false);
    }
  };

  const handleDownload = async (file: LogFile) => {
    try {
      await request.download(`/api/log-files/${encodeURIComponent(file.name)}/download`, file.name);
    } catch {
      Toast.error('下载失败');
    }
  };

  const renderHighlightedLine = (line: string) => {
    const matches = findMatchRanges(line, normalizedContentKeyword);
    if (matches.length === 0) return line;

    const parts: React.ReactNode[] = [];
    let cursor = 0;

    matches.forEach((match, index) => {
      if (match.start > cursor) {
        parts.push(line.slice(cursor, match.start));
      }

      parts.push(
        <mark
          key={`${line}-${index}-${match.start}`}
          style={{
            backgroundColor: 'var(--semi-color-warning-light-default)',
            color: 'inherit',
            borderRadius: 3,
            padding: '0 1px',
            fontWeight: 600,
          }}
        >
          {line.slice(match.start, match.end)}
        </mark>,
      );

      cursor = match.end;
    });

    if (cursor < line.length) {
      parts.push(line.slice(cursor));
    }

    return parts;
  };

  const handleDelete = (file: LogFile) => {
    Modal.confirm({
      title: `确定要删除 ${file.name} 吗？`,
      content: '删除后无法恢复，请谨慎操作。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/log-files/${encodeURIComponent(file.name)}`);
        if (res.code === 0) {
          Toast.success('删除成功');
          if (selected?.name === file.name) {
            setSelected(null);
            setLines([]);
            stopTail();
          }
          void fetchFiles();
        }
      },
    });
  };

  return (
    <MasterDetailLayout
      defaultSize={260}
      minSize={200}
      maxSize={480}
      persistKey="log-files"
      showDetail={selected !== null}
      onBack={() => setSelected(null)}
      master={(
          <NavListPanel
            title="日志文件"
            headerExtra={
              <Button
                icon={<RefreshCw size={13} />}
                size="small"
                theme="borderless"
                loading={listLoading}
                onClick={() => void fetchFiles()}
              />
            }
            search={{
              value: keyword,
              onChange: (value) => setKeyword(value),
              placeholder: '搜索文件名',
            }}
            loading={listLoading}
            emptyText={files.length === 0 ? '暂无日志文件' : '未找到匹配的日志文件'}
            dataSource={filteredFiles}
            renderItem={(file) => {
              const active = selected?.name === file.name;
              return (
                <NavListItem
                  key={file.name}
                  active={active}
                  onClick={() => selectFile(file)}
                  icon={<FileText size={13} />}
                  primary={file.name}
                  meta={
                    <>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 4px',
                        borderRadius: 3,
                        lineHeight: '14px',
                        background: file.isGzip ? 'var(--semi-color-fill-2)' : 'var(--semi-color-primary-light-default)',
                        color: file.isGzip ? 'var(--semi-color-text-2)' : 'var(--semi-color-primary)',
                      }}>
                        {file.isGzip ? 'gz' : 'log'}
                      </span>
                      <span>{formatFileSize(file.size)}</span>
                      <span>{formatDateTime(file.modifiedAt)}</span>
                    </>
                  }
                  extra={
                    <Dropdown
                      trigger="click"
                      position="bottomRight"
                      clickToHide
                      render={
                        <Dropdown.Menu>
                          {hasPermission('system:log:files:download') && (
                            <Dropdown.Item onClick={() => void handleDownload(file)}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Download size={14} /> 下载
                              </span>
                            </Dropdown.Item>
                          )}
                          {hasPermission('system:log:files:delete') && (
                            <Dropdown.Item
                              type="danger"
                              onClick={() => handleDelete(file)}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Trash2 size={14} /> 删除
                              </span>
                            </Dropdown.Item>
                          )}
                        </Dropdown.Menu>
                      }
                    >
                      <Button
                        theme="borderless"
                        size="small"
                        icon={<MoreHorizontal size={14} />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  }
                />
              );
            }}
          />
      )}
      detail={(
        <>
          {selected ? (
            <>
            {/* 顶部工具栏 */}
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--semi-color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
              <FileText size={14} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />
              <Typography.Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                {selected.name}
              </Typography.Text>
              {tailing && (
                <Tag color="green" size="small">
                  <Activity size={10} style={{ marginRight: 4 }} />实时追踪中
                </Tag>
              )}
              {hasContentSearch && (
                <Tag color="purple" size="small">内容搜索：{normalizedContentKeyword}</Tag>
              )}
              {searchMatches.length > 0 && (
                <Tag color="blue" size="small">{activeMatchIndex + 1}/{searchMatches.length} 匹配</Tag>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Input
                  prefix={<Search size={14} />}
                  placeholder="实时高亮搜索日志内容"
                  value={contentKeyword}
                  onChange={(value) => {
                    setContentKeyword(value);
                    setActiveMatchIndex(0);
                  }}
                  onEnterPress={handleContentSearch}
                  showClear
                  size="small"
                  style={{ width: 260 }}
                />
                <Space>
                  {!selected.isGzip && hasPermission('system:log:files') && (
                    <Button
                      size="small"
                      icon={tailing ? <StopCircle size={13} /> : <Activity size={13} />}
                      type={tailing ? 'danger' : 'primary'}
                      theme="light"
                      disabled={hasContentSearch}
                      onClick={() => void toggleTail()}
                    >
                      {tailing ? '停止追踪' : '实时追踪'}
                    </Button>
                  )}
                  <Button size="small" theme="borderless" disabled={!hasContentSearch || searchMatches.length === 0} onClick={() => jumpToMatch(-1)}>
                    上一个
                  </Button>
                  <Button size="small" theme="borderless" disabled={!hasContentSearch || searchMatches.length === 0} onClick={() => jumpToMatch(1)}>
                    下一个
                  </Button>
                  <Button size="small" type="primary" theme="solid" icon={<Search size={13} />} onClick={handleContentSearch} disabled={!hasContentSearch || searchMatches.length === 0}>
                    定位首个
                  </Button>
                  <Button size="small" theme="borderless" onClick={handleContentSearchReset}>
                    重置
                  </Button>
                  <Button
                    size="small"
                    theme={showLineNumbers ? 'light' : 'borderless'}
                    type={showLineNumbers ? 'primary' : 'tertiary'}
                    icon={<ListOrdered size={13} />}
                    onClick={() => setShowLineNumbers((v) => !v)}
                  >
                    行号
                  </Button>
                  {hasPermission('system:log:files') && (
                    <Button size="small" theme="borderless" icon={<RefreshCw size={13} />}
                      onClick={() => void loadContent(selected)}>刷新</Button>
                  )}
                  {hasPermission('system:log:files:download') && (
                    <Button size="small" theme="borderless" icon={<Download size={13} />}
                      onClick={() => void handleDownload(selected)}>下载</Button>
                  )}
                  {hasPermission('system:log:files:delete') && (
                    <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />}
                      onClick={() => handleDelete(selected)}>删除</Button>
                  )}
                </Space>
              </div>
            </div>

            {/* 日志内容 */}
            {contentLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" />
              </div>
            ) : (
              <pre
                ref={preRef}
                style={{
                  flex: 1,
                  margin: 0,
                  padding: '12px 16px',
                  fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 1.6,
                  backgroundColor: 'var(--semi-color-fill-0)',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'var(--semi-color-text-1)',
                }}
              >
                {lines.length === 0 ? (
                  <Typography.Text type="tertiary" style={{ fontFamily: 'inherit' }}>{hasContentSearch ? '（未找到匹配日志内容）' : '（文件为空）'}</Typography.Text>
                ) : (
                  lines.map((line, index) => {
                    const isActiveMatchLine = searchMatches.some((match) => match.lineIndex === index) && searchMatches[activeMatchIndex]?.lineIndex === index;
                    return (
                      <span
                        key={`${selected.name}-${index}`}
                        ref={(node) => {
                          lineRefs.current[index] = node;
                        }}
                        style={{
                          display: 'flex',
                          background: isActiveMatchLine ? 'var(--semi-color-primary-light-default)' : 'transparent',
                          borderLeft: isActiveMatchLine ? '3px solid var(--semi-color-primary)' : '3px solid transparent',
                          paddingLeft: isActiveMatchLine ? 6 : 0,
                          borderRadius: 4,
                        }}
                      >
                        {showLineNumbers && (
                          <span
                            aria-hidden="true"
                            style={{
                              flexShrink: 0,
                              width: `${lineNumberDigits}ch`,
                              marginRight: 12,
                              textAlign: 'right',
                              color: 'var(--semi-color-text-2)',
                              userSelect: 'none',
                              whiteSpace: 'pre',
                            }}
                          >
                            {index + 1}
                          </span>
                        )}
                        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {renderHighlightedLine(line)}
                        </span>
                      </span>
                    );
                  })
                )}
              </pre>
            )}
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <FileText size={40} style={{ color: 'var(--semi-color-text-3)' }} />
              <Typography.Text type="tertiary">请从左侧选择一个日志文件查看</Typography.Text>
            </div>
          )}
        </>
      )}
    />
  );
}
