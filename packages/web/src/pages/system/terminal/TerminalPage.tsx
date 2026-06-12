import { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Typography, Space, Dropdown, Tooltip } from '@douyinfe/semi-ui';
import { Plus, TerminalSquare, ChevronDown, X, PanelLeft, Settings, FileCode } from 'lucide-react';
import TerminalTab from './TerminalTab';
import EditorTab from './EditorTab';
import FileExplorer from './FileExplorer';
import TerminalSettings from './TerminalSettings';
import { useTerminalPreferences } from './useTerminalPreferences';
import { request } from '@/utils/request';

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

interface ShellInfo {
  id: string;
  label: string;
  path: string;
}

type SessionType = 'terminal' | 'editor';

interface Session {
  id: string;
  title: string;
  type: SessionType;
  shell?: string;
  cwd?: string;
  filePath?: string;
}

let sessionCounter = 0;

function DemoNotice() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        color: 'var(--semi-color-text-2)',
      }}
    >
      <TerminalSquare size={48} strokeWidth={1.2} style={{ opacity: 0.4 }} />
      <Typography.Title heading={5} style={{ margin: 0 }}>Web 终端</Typography.Title>
      <Typography.Text type="tertiary">演示模式下终端功能不可用</Typography.Text>
    </div>
  );
}

export default function TerminalPage() {
  const { terminal } = useTerminalPreferences();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState('');
  const [showExplorer, setShowExplorer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [serverDefaultShell, setServerDefaultShell] = useState('');
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragIdRef = useRef<string | null>(null);

  // 拉取当前平台可用 shell 列表
  useEffect(() => {
    if (IS_DEMO) return;
    void request
      .get<{ platform: string; shells: ShellInfo[]; defaultShell: string }>('/api/terminal-files/shells', { silent: true })
      .then((res) => {
        if (res.code === 0 && res.data) {
          setShells(res.data.shells);
          setServerDefaultShell(res.data.defaultShell);
        }
      });
  }, []);

  const defaultShellId =
    terminal.defaultShell && shells.some((s) => s.id === terminal.defaultShell)
      ? terminal.defaultShell
      : serverDefaultShell;

  const addTerminal = useCallback(
    (shellId?: string, cwd?: string) => {
      const id = shellId && shells.some((s) => s.id === shellId) ? shellId : defaultShellId;
      if (!id) return;
      sessionCounter += 1;
      const sid = String(sessionCounter);
      const baseLabel = shells.find((s) => s.id === id)?.label ?? id;
      const title = cwd ? `${baseLabel}: ${cwd.split(/[\\/]/).findLast(Boolean) ?? cwd}` : baseLabel;
      setSessions((prev) => [...prev, { id: sid, title, type: 'terminal', shell: id, cwd }]);
      setActiveId(sid);
    },
    [shells, defaultShellId],
  );

  // shell 就绪后自动创建首个终端；关闭到空时也自动补一个
  useEffect(() => {
    if (!IS_DEMO && shells.length > 0 && sessions.length === 0) {
      addTerminal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shells.length, sessions.length]);

  const openEditor = useCallback((filePath: string) => {
    setSessions((prev) => {
      const existing = prev.find((s) => s.type === 'editor' && s.filePath === filePath);
      if (existing) {
        setActiveId(existing.id);
        return prev;
      }
      sessionCounter += 1;
      const sid = String(sessionCounter);
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      setActiveId(sid);
      return [...prev, { id: sid, title: name, type: 'editor', filePath }];
    });
  }, []);

  const openTerminalAt = useCallback((path: string) => addTerminal(undefined, path), [addTerminal]);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const removeSession = (id: string) => {
    setDirtyIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    const idx = sessions.findIndex((s) => s.id === id);
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    if (activeId === id) setActiveId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? '');
  };

  const reorderSessions = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return;
    setSessions((prev) => {
      const arr = [...prev];
      const fi = arr.findIndex((s) => s.id === fromId);
      const ti = arr.findIndex((s) => s.id === toId);
      if (fi < 0 || ti < 0) return prev;
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return arr;
    });
  };

  const closeOthers = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id === id));
    setActiveId(id);
    setDirtyIds((prev) => {
      const n = new Set<string>();
      if (prev.has(id)) n.add(id);
      return n;
    });
  };

  const closeRight = (id: string) => {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const kept = sessions.slice(0, idx + 1);
    setSessions(kept);
    if (!kept.some((s) => s.id === activeId)) setActiveId(id);
    setDirtyIds((prev) => {
      const n = new Set<string>();
      kept.forEach((s) => {
        if (prev.has(s.id)) n.add(s.id);
      });
      return n;
    });
  };

  const closeAll = () => {
    setSessions([]);
    setActiveId('');
    setDirtyIds(new Set());
  };

  if (IS_DEMO) return <DemoNotice />;

  const shellMenu = (
    <Dropdown.Menu>
      {shells.length === 0 ? (
        <Dropdown.Item disabled>无可用 Shell</Dropdown.Item>
      ) : (
        shells.map((sh) => (
          <Dropdown.Item key={sh.id} onClick={() => addTerminal(sh.id)}>
            {sh.label}
          </Dropdown.Item>
        ))
      )}
    </Dropdown.Menu>
  );

  const tabBarRight = (
    <Space spacing={2} style={{ padding: '0 8px', borderLeft: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
      <Button
        icon={<Plus size={13} />}
        size="small"
        theme="borderless"
        type="tertiary"
        onClick={() => addTerminal()}
        title="新建终端"
      />
      <Dropdown trigger="click" position="bottomRight" render={shellMenu}>
        <Button
          icon={<ChevronDown size={13} />}
          size="small"
          theme="borderless"
          type="tertiary"
          title="选择 Shell 类型"
        />
      </Dropdown>
      <Tooltip content="终端设置">
        <Button
          icon={<Settings size={13} />}
          size="small"
          theme="borderless"
          type="tertiary"
          onClick={() => setShowSettings(true)}
        />
      </Tooltip>
    </Space>
  );

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-layout-bg)',
        overflow: 'hidden',
      }}
    >
      {/* 自定义标签栏：复用应用顶部 .admin-tab-item 紧凑 line 风格 */}
      <div className="admin-tabs-bar" data-tab-style="line" style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
        <Tooltip content={showExplorer ? '隐藏文件浏览器' : '显示文件浏览器'}>
          <Button
            icon={<PanelLeft size={14} />}
            size="small"
            theme="borderless"
            type={showExplorer ? 'primary' : 'tertiary'}
            onClick={() => setShowExplorer((v) => !v)}
            style={{ margin: '0 4px', flexShrink: 0, alignSelf: 'center' }}
          />
        </Tooltip>
        <div className="admin-tabs-bar__scroll">
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            return (
              <div
                key={s.id}
                className={`admin-tab-item ${isActive ? 'admin-tab-item--active' : ''}`}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                draggable
                onDragStart={() => {
                  dragIdRef.current = s.id;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  reorderSessions(dragIdRef.current ?? '', s.id);
                  dragIdRef.current = null;
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ id: s.id, x: e.clientX, y: e.clientY });
                }}
                onClick={() => setActiveId(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveId(s.id);
                  }
                }}
              >
                <span className="admin-tab-item__icon">
                  {s.type === 'editor' ? <FileCode size={13} /> : <TerminalSquare size={13} />}
                </span>
                <span className="admin-tab-item__text">
                  {dirtyIds.has(s.id) ? '● ' : ''}
                  {s.title}
                </span>
                <button
                  className="admin-tab-item__close"
                  aria-label="关闭标签"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(s.id);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        {tabBarRight}
      </div>

      {/* 内容区：左侧文件浏览器（可收起）+ 右侧终端/编辑器 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {showExplorer && (
          <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)' }}>
            <FileExplorer active={showExplorer} onOpenFile={openEditor} onOpenTerminalAt={openTerminalAt} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                inset: 0,
                display: s.id === activeId ? 'block' : 'none',
                padding: '8px 4px 4px',
              }}
            >
              {s.type === 'terminal' ? (
                <TerminalTab sessionId={s.id} active={s.id === activeId} shell={s.shell ?? ''} cwd={s.cwd} />
              ) : (
                <EditorTab filePath={s.filePath ?? ''} active={s.id === activeId} onDirtyChange={(d) => setDirty(s.id, d)} />
              )}
            </div>
          ))}
        </div>
      </div>

      <TerminalSettings visible={showSettings} onClose={() => setShowSettings(false)} shells={shells} />

      {ctxMenu && (
        <>
          <button
            type="button"
            aria-label="关闭菜单"
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'transparent', border: 'none', padding: 0, cursor: 'default' }}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 1001,
              minWidth: 140,
              background: 'var(--semi-color-bg-3)',
              border: '1px solid var(--semi-color-border)',
              borderRadius: 6,
              boxShadow: 'var(--semi-shadow-elevated)',
              padding: '4px 0',
            }}
          >
            {[
              { label: '关闭', fn: () => removeSession(ctxMenu.id) },
              { label: '关闭其他', fn: () => closeOthers(ctxMenu.id) },
              { label: '关闭右侧', fn: () => closeRight(ctxMenu.id) },
              { label: '全部关闭', fn: () => closeAll() },
            ].map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  it.fn();
                  setCtxMenu(null);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--semi-color-text-0)',
                  font: 'inherit',
                  fontSize: 13,
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
