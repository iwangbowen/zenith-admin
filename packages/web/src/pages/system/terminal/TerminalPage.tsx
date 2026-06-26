import { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Typography, Space, Dropdown, Tooltip, Modal } from '@douyinfe/semi-ui';
import { Plus, TerminalSquare, ChevronDown, ChevronLeft, ChevronRight, X, PanelLeft, Settings, Server, Package } from 'lucide-react';
import { Icon } from '@iconify/react';
import FileExplorer from './FileExplorer';
import TerminalSettings from './TerminalSettings';
import PaneTreeView from './PaneTreeView';
import SshProfilesManager, { type SshProfile } from './SshProfilesManager';
import SftpExplorer from './SftpExplorer';
import DockerExplorer from './DockerExplorer';
import { useTerminalPreferences } from './useTerminalPreferences';
import { request } from '@/utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import { getFileIcon, getShellIcon } from './fileIcons';
import { terminalSessionStore } from './terminalSessionStore';
import {
  closePane,
  collectLeaves,
  collectAllIds,
  createLeaf,
  ensurePaneCounterFloor,
  findLeaf,
  firstLeaf,
  splitPane,
  updateLeafTitle,
  type PaneLeaf,
  type PaneNode,
  type SplitDirection,
} from './paneTree';

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

interface ShellInfo {
  id: string;
  label: string;
  path: string;
}

interface Session {
  id: string;
  root: PaneNode;
  activePaneId: string;
}

let tabCounter = 0;
function nextTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

// ─── 刷新恢复：将 Tab/分屏布局持久化到 localStorage ──────────────────────────────

const LAYOUT_STORAGE_KEY = 'zenith_terminal_layout';

interface PersistedLayout {
  sessions: Session[];
  activeId: string;
}

/** 按当前登录用户隔离布局存储，避免共享浏览器时跨用户串台 */
function layoutStorageKey(): string {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1])) as { userId?: number };
      if (payload?.userId) return `${LAYOUT_STORAGE_KEY}:${payload.userId}`;
    }
  } catch { /* ignore */ }
  return LAYOUT_STORAGE_KEY;
}

function maxNumericSuffix(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const m = /-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** 读取并校验持久化布局；同时把 id 计数器抬高到已恢复 id 之上，防止新建节点 id 冲突 */
function loadPersistedLayout(): PersistedLayout | null {
  if (IS_DEMO) return null;
  try {
    const raw = localStorage.getItem(layoutStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLayout;
    if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return null;
    // 简单结构校验
    for (const s of parsed.sessions) {
      if (!s || typeof s.id !== 'string' || !s.root) return null;
    }
    const tabIds = parsed.sessions.map((s) => s.id);
    const paneIds = parsed.sessions.flatMap((s) => collectAllIds(s.root));
    tabCounter = Math.max(tabCounter, maxNumericSuffix(tabIds));
    ensurePaneCounterFloor(maxNumericSuffix(paneIds));
    return parsed;
  } catch {
    return null;
  }
}

/** 取 tab 当前聚焦的叶子（兜底取第一个叶子） */
function activeLeafOf(session: Session): PaneLeaf {
  return findLeaf(session.root, session.activePaneId) ?? firstLeaf(session.root);
}

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
  const { terminal, setTerminalPref } = useTerminalPreferences();
  const tabPosition = terminal.tabPosition ?? 'top';
  const tabCollapsed = terminal.tabCollapsed ?? false;
  // 刷新恢复：首次渲染时从 localStorage 还原布局（并抬高 id 计数器）
  const restoredRef = useRef<PersistedLayout | null>(null);
  const [restoreDone] = useState(() => {
    restoredRef.current = loadPersistedLayout();
    return true;
  });
  void restoreDone;
  const [sessions, setSessions] = useState<Session[]>(() => restoredRef.current?.sessions ?? []);
  const [activeId, setActiveId] = useState<string>(() => {
    const r = restoredRef.current;
    if (!r) return '';
    return r.sessions.some((s) => s.id === r.activeId) ? r.activeId : (r.sessions[0]?.id ?? '');
  });
  const [showExplorer, setShowExplorer] = useState(false);
  const [showSshProfiles, setShowSshProfiles] = useState(false);
  const [showDocker, setShowDocker] = useState(false);
  const [showSftp, setShowSftp] = useState(false);
  const [sftpProfile, setSftpProfile] = useState<SshProfile | null>(null);
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
      const baseLabel = shells.find((s) => s.id === id)?.label ?? id;
      const title = cwd ? `${baseLabel}: ${cwd.split(/[\\/]/).findLast(Boolean) ?? cwd}` : baseLabel;
      const leaf = createLeaf({ kind: 'terminal', shell: id, cwd, title });
      const tabId = nextTabId();
      setSessions((prev) => [...prev, { id: tabId, root: leaf, activePaneId: leaf.id }]);
      setActiveId(tabId);
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

  // 持久化 Tab/分屏布局，刷新后可恢复（终端面板由 stableSessionId 重连存活的 PTY）
  useEffect(() => {
    if (IS_DEMO) return;
    try {
      if (sessions.length === 0) {
        localStorage.removeItem(layoutStorageKey());
      } else {
        localStorage.setItem(layoutStorageKey(), JSON.stringify({ sessions, activeId }));
      }
    } catch { /* 配额不足等忽略 */ }
  }, [sessions, activeId]);

  const openEditor = useCallback((filePath: string) => {
    setSessions((prev) => {
      // 去重：若任意 tab 的某个面板已打开该文件，则聚焦之
      for (const s of prev) {
        const leaf = collectLeaves(s.root).find((l) => l.kind === 'editor' && l.filePath === filePath);
        if (leaf) {
          setActiveId(s.id);
          return prev.map((x) => (x.id === s.id ? { ...x, activePaneId: leaf.id } : x));
        }
      }
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      const leaf = createLeaf({ kind: 'editor', filePath, title: name });
      const tabId = nextTabId();
      setActiveId(tabId);
      return [...prev, { id: tabId, root: leaf, activePaneId: leaf.id }];
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

  const confirmClosingDirtyEditors = (leaves: PaneLeaf[], onConfirm: () => void) => {
    const dirtyEditors = leaves.filter((l) => l.kind === 'editor' && dirtyIds.has(l.id));
    if (dirtyEditors.length === 0) {
      onConfirm();
      return;
    }

    const fileNames = dirtyEditors.map((l) => l.filePath ?? l.title);
    const preview = fileNames.slice(0, 3).join('、');
    const content =
      dirtyEditors.length === 1
        ? `文件「${preview}」有未保存修改，关闭后未保存内容将丢失。`
        : `以下 ${dirtyEditors.length} 个文件有未保存修改：${preview}${dirtyEditors.length > 3 ? ' 等' : ''}。关闭后未保存内容将丢失。`;

    Modal.confirm({
      title: '关闭未保存文件？',
      content,
      okText: '仍然关闭',
      cancelText: '取消',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: onConfirm,
    });
  };

  const removeSessionNow = (id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (target) {
      const leaves = collectLeaves(target.root);
      // 标记所有终端 session 待销毁
      leaves.forEach((l) => {
        if (l.kind === 'terminal') terminalSessionStore.markForDestruction(l.stableSessionId);
      });
      setDirtyIds((prev) => {
        const n = new Set(prev);
        leaves.forEach((l) => n.delete(l.id));
        return n;
      });
    }
    const idx = sessions.findIndex((s) => s.id === id);
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    if (activeId === id) setActiveId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? '');
  };

  const removeSession = (id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (!target) {
      removeSessionNow(id);
      return;
    }
    confirmClosingDirtyEditors(collectLeaves(target.root), () => removeSessionNow(id));
  };

  const handleFocusPane = (tabId: string, paneId: string) => {
    setSessions((prev) => prev.map((s) => (s.id === tabId ? { ...s, activePaneId: paneId } : s)));
  };

  const handleTitleChange = (tabId: string, paneId: string, newTitle: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === tabId ? { ...s, root: updateLeafTitle(s.root, paneId, newTitle) } : s)),
    );
  };

  const handleSshConnect = (profile: SshProfile) => {
    const shellId = `ssh:${profile.id}`;
    const title = `SSH: ${profile.name}`;
    const leaf = createLeaf({ kind: 'terminal', shell: shellId, title });
    const tabId = nextTabId();
    setSessions((prev) => [...prev, { id: tabId, root: leaf, activePaneId: leaf.id }]);
    setActiveId(tabId);
    setShowSshProfiles(false);
  };

  /** 打开远程 SFTP 文件面板（替换左侧其他面板） */
  const openSftp = (profile: SshProfile) => {
    setSftpProfile(profile);
    setShowSftp(true);
    setShowExplorer(false);
    setShowDocker(false);
    setShowSshProfiles(false);
  };

  const handleDockerAttach = (shellId: string, title: string) => {
    const leaf = createLeaf({ kind: 'terminal', shell: shellId, title });
    const tabId = nextTabId();
    setSessions((prev) => [...prev, { id: tabId, root: leaf, activePaneId: leaf.id }]);
    setActiveId(tabId);
  };

  const handleSplitPane = (tabId: string, paneId: string, direction: SplitDirection) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== tabId) return s;
        const target = findLeaf(s.root, paneId);
        if (!target) return s;
        const newLeaf =
          target.kind === 'terminal'
            ? createLeaf({ kind: 'terminal', shell: target.shell, cwd: target.cwd, title: target.title })
            : createLeaf({ kind: 'editor', filePath: target.filePath, title: target.title });
        return { ...s, root: splitPane(s.root, paneId, direction, newLeaf), activePaneId: newLeaf.id };
      }),
    );
  };

  const handleClosePaneNow = (tabId: string, paneId: string) => {
    const target = sessions.find((s) => s.id === tabId);
    if (!target) return;
    // 明确关闭前，先标记该面板的 session 待销毁
    const closedLeaf = findLeaf(target.root, paneId);
    if (closedLeaf?.kind === 'terminal') {
      terminalSessionStore.markForDestruction(closedLeaf.stableSessionId);
    }
    const result = closePane(target.root, paneId);
    setDirtyIds((prev) => {
      const n = new Set(prev);
      n.delete(paneId);
      // 若折叠导致叶子 id 被重命名，同步更新脏标记集合
      if (result.renamedPaneId && n.has(result.renamedPaneId.from)) {
        n.delete(result.renamedPaneId.from);
        n.add(result.renamedPaneId.to);
      }
      return n;
    });
    if (result.root === null) {
      removeSessionNow(tabId);
      return;
    }
    const nextRoot = result.root;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== tabId) return s;
        let newActivePaneId = s.activePaneId;
        if (s.activePaneId === paneId) {
          // 关闭了当前激活面板 → 移至邻近面板
          newActivePaneId = result.nextActiveId ?? s.activePaneId;
        } else if (result.renamedPaneId?.from === s.activePaneId) {
          // 当前激活面板的 id 被重命名 → 更新为新 id
          newActivePaneId = result.renamedPaneId.to;
        }
        return { ...s, root: nextRoot, activePaneId: newActivePaneId };
      }),
    );
  };

  const handleClosePane = (tabId: string, paneId: string) => {
    const target = sessions.find((s) => s.id === tabId);
    if (!target) return;
    const closedLeaf = findLeaf(target.root, paneId);
    confirmClosingDirtyEditors(closedLeaf ? [closedLeaf] : [], () => handleClosePaneNow(tabId, paneId));
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

  const closeOthersNow = (id: string) => {
    const kept = sessions.find((s) => s.id === id);
    const keptSessionIds = new Set(
      kept ? collectLeaves(kept.root).filter((l) => l.kind === 'terminal').map((l) => l.stableSessionId) : [],
    );
    // 标记将被关闭的其他 tab 中的 session 待销毁
    sessions
      .filter((s) => s.id !== id)
      .forEach((s) =>
        collectLeaves(s.root).forEach((l) => {
          if (l.kind === 'terminal' && !keptSessionIds.has(l.stableSessionId))
            terminalSessionStore.markForDestruction(l.stableSessionId);
        }),
      );
    const keptLeafIds = kept ? collectLeaves(kept.root).map((l) => l.id) : [];
    setSessions((prev) => prev.filter((s) => s.id === id));
    setActiveId(id);
    setDirtyIds((prev) => {
      const n = new Set<string>();
      keptLeafIds.forEach((lid) => {
        if (prev.has(lid)) n.add(lid);
      });
      return n;
    });
  };

  const closeOthers = (id: string) => {
    const closingLeaves = sessions.filter((s) => s.id !== id).flatMap((s) => collectLeaves(s.root));
    confirmClosingDirtyEditors(closingLeaves, () => closeOthersNow(id));
  };

  const closeRightNow = (id: string) => {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const kept = sessions.slice(0, idx + 1);
    const keptSessionIds = new Set(
      kept.flatMap((s) => collectLeaves(s.root).filter((l) => l.kind === 'terminal').map((l) => l.stableSessionId)),
    );
    // 标记将被关闭的 tab 的 session 待销毁
    sessions
      .slice(idx + 1)
      .forEach((s) =>
        collectLeaves(s.root).forEach((l) => {
          if (l.kind === 'terminal' && !keptSessionIds.has(l.stableSessionId))
            terminalSessionStore.markForDestruction(l.stableSessionId);
        }),
      );
    const keptLeafIds = kept.flatMap((s) => collectLeaves(s.root).map((l) => l.id));
    setSessions(kept);
    if (!kept.some((s) => s.id === activeId)) setActiveId(id);
    setDirtyIds((prev) => {
      const n = new Set<string>();
      keptLeafIds.forEach((lid) => {
        if (prev.has(lid)) n.add(lid);
      });
      return n;
    });
  };

  const closeRight = (id: string) => {
    const idx = sessions.findIndex((s) => s.id === id);
    const closingLeaves = idx >= 0 ? sessions.slice(idx + 1).flatMap((s) => collectLeaves(s.root)) : [];
    confirmClosingDirtyEditors(closingLeaves, () => closeRightNow(id));
  };

  const closeAllNow = () => {
    // 标记所有 session 待销毁
    sessions.forEach((s) =>
      collectLeaves(s.root).forEach((l) => {
        if (l.kind === 'terminal') terminalSessionStore.markForDestruction(l.stableSessionId);
      }),
    );
    setSessions([]);
    setActiveId('');
    setDirtyIds(new Set());
  };

  const closeAll = () => {
    const closingLeaves = sessions.flatMap((s) => collectLeaves(s.root));
    confirmClosingDirtyEditors(closingLeaves, closeAllNow);
  };

  if (IS_DEMO) return <DemoNotice />;

  const shellMenu = (
    <Dropdown.Menu>
      {shells.length === 0 ? (
        <Dropdown.Item disabled>无可用 Shell</Dropdown.Item>
      ) : (
        shells.map((sh) => (
          <Dropdown.Item
            key={sh.id}
            icon={<Icon icon={getShellIcon(sh.id)} width={14} height={14} />}
            onClick={() => addTerminal(sh.id)}
          >
            {sh.label}
          </Dropdown.Item>
        ))
      )}
    </Dropdown.Menu>
  );

  /** 渲染单个 tab 的图标+标题+脏标记 */
  const renderTabInfo = (s: Session) => {
    const leaf = activeLeafOf(s);
    const tabDirty = collectLeaves(s.root).some((l) => dirtyIds.has(l.id));
    return { leaf, tabDirty };
  };

  /** 横向标签栏（top / bottom） */
  const horizontalTabBar = (
    <div
      className="admin-tabs-bar"
      data-tab-style="line"
      style={{
        borderBottom: tabPosition === 'top' ? '1px solid var(--semi-color-border)' : undefined,
        borderTop: tabPosition === 'bottom' ? '1px solid var(--semi-color-border)' : undefined,
      }}
    >
      <Tooltip content={showExplorer ? '隐藏文件浏览器' : '显示文件浏览器'}>
        <Button
          icon={<PanelLeft size={14} />}
          size="small"
          theme="borderless"
          type={showExplorer ? 'primary' : 'tertiary'}
          onClick={() => { setShowExplorer((v) => !v); setShowSshProfiles(false); setShowDocker(false); setShowSftp(false); }}
          style={{ margin: '0 2px 0 4px', flexShrink: 0, alignSelf: 'center' }}
        />
      </Tooltip>
      <Tooltip content={showSshProfiles ? '隐藏 SSH 连接' : '管理 SSH 连接'}>
        <Button
          icon={<Server size={14} />}
          size="small"
          theme="borderless"
          type={showSshProfiles ? 'primary' : 'tertiary'}
          onClick={() => { setShowSshProfiles((v) => !v); setShowExplorer(false); setShowDocker(false); setShowSftp(false); }}
          style={{ marginRight: 2, flexShrink: 0, alignSelf: 'center' }}
        />
      </Tooltip>
      <Tooltip content={showDocker ? '隐藏 Docker 容器' : '浏览 Docker 容器'}>
        <Button
          icon={<Package size={14} />}
          size="small"
          theme="borderless"
          type={showDocker ? 'primary' : 'tertiary'}
          onClick={() => { setShowDocker((v) => !v); setShowExplorer(false); setShowSshProfiles(false); setShowSftp(false); }}
          style={{ marginRight: 4, flexShrink: 0, alignSelf: 'center' }}
        />
      </Tooltip>
      <div className="admin-tabs-bar__scroll">
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          const { leaf, tabDirty } = renderTabInfo(s);
          return (
            <div
              key={s.id}
              className={`admin-tab-item ${isActive ? 'admin-tab-item--active' : ''}`}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              draggable
              onDragStart={() => { dragIdRef.current = s.id; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { reorderSessions(dragIdRef.current ?? '', s.id); dragIdRef.current = null; }}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: s.id, x: e.clientX, y: e.clientY }); }}
              onClick={() => setActiveId(s.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveId(s.id); } }}
            >
              <span className="admin-tab-item__icon">
                {leaf.kind === 'editor' ? (
                  <Icon icon={getFileIcon(leaf.title)} width={13} height={13} />
                ) : (
                  <Icon icon={getShellIcon(leaf.shell)} width={13} height={13} />
                )}
              </span>
              <span className="admin-tab-item__text">
                {tabDirty ? '● ' : ''}
                {leaf.title}
              </span>
              <button
                className="admin-tab-item__close"
                aria-label="关闭标签"
                onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {/* 右侧操作按钮 */}
      <Space spacing={2} style={{ padding: '0 8px', borderLeft: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
        <Button icon={<Plus size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => addTerminal()} title="新建终端" />
        <Dropdown trigger="click" position="bottomRight" render={shellMenu}>
          <Button icon={<ChevronDown size={13} />} size="small" theme="borderless" type="tertiary" title="选择 Shell 类型" />
        </Dropdown>
        <Tooltip content="终端设置">
          <Button icon={<Settings size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => setShowSettings(true)} />
        </Tooltip>
      </Space>
    </div>
  );

  /** 右侧 / 左侧竖向标签栏 */
  const isLeft = tabPosition === 'left';
  const verticalSidebar = (
    <div
      className={`terminal-sidebar ${isLeft ? 'terminal-sidebar--left' : ''} ${tabCollapsed ? 'terminal-sidebar--collapsed' : 'terminal-sidebar--expanded'}`}
      style={{ width: tabCollapsed ? 44 : 200 }}
    >
      {/* 工具行 */}
      <div className="terminal-sidebar__tools">
        {tabCollapsed ? (
          /* 折叠态：折叠按鈕 */
          <Tooltip content="展开标签栏" position={isLeft ? 'right' : 'left'}>
            <Button
              icon={isLeft ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
              size="small"
              theme="borderless"
              type="tertiary"
              onClick={() => setTerminalPref({ tabCollapsed: false })}
            />
          </Tooltip>
        ) : (
          /* 展开态：横排按钮 */
          <>
            <Tooltip content={showExplorer ? '隐藏文件浏览器' : '显示文件浏览器'}>
              <Button
                icon={<PanelLeft size={14} />}
                size="small"
                theme="borderless"
                type={showExplorer ? 'primary' : 'tertiary'}
                onClick={() => { setShowExplorer((v) => !v); setShowSshProfiles(false); setShowDocker(false); setShowSftp(false); }}
              />
            </Tooltip>
            <Tooltip content={showSshProfiles ? '隐藏 SSH 连接' : '管理 SSH 连接'}>
              <Button
                icon={<Server size={14} />}
                size="small"
                theme="borderless"
                type={showSshProfiles ? 'primary' : 'tertiary'}
                onClick={() => { setShowSshProfiles((v) => !v); setShowExplorer(false); setShowDocker(false); setShowSftp(false); }}
              />
            </Tooltip>
            <Tooltip content={showDocker ? '隐藏 Docker 容器' : '浏览 Docker 容器'}>
              <Button
                icon={<Package size={14} />}
                size="small"
                theme="borderless"
                type={showDocker ? 'primary' : 'tertiary'}
                onClick={() => { setShowDocker((v) => !v); setShowExplorer(false); setShowSshProfiles(false); setShowSftp(false); }}
              />
            </Tooltip>
            <div style={{ flex: 1 }} />
            <Button icon={<Plus size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => addTerminal()} title="新建终端" />
            <Dropdown trigger="click" position="bottomLeft" render={shellMenu}>
              <Button icon={<ChevronDown size={13} />} size="small" theme="borderless" type="tertiary" title="选择 Shell 类型" />
            </Dropdown>
            <Tooltip content="终端设置">
              <Button icon={<Settings size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => setShowSettings(true)} />
            </Tooltip>
            <Tooltip content="折叠标签栏">
              <Button
                icon={isLeft ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                size="small"
                theme="borderless"
                type="tertiary"
                onClick={() => setTerminalPref({ tabCollapsed: true })}
              />
            </Tooltip>
          </>
        )}
      </div>

      {/* 标签列表 */}
      <div className="terminal-sidebar__list">
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          const { leaf, tabDirty } = renderTabInfo(s);
          const title = `${tabDirty ? '● ' : ''}${leaf.title}`;
          return (
            <Tooltip key={s.id} content={tabCollapsed ? title : undefined} position={isLeft ? 'right' : 'left'}>
              <div
                className={`terminal-sidebar__item ${isActive ? 'terminal-sidebar__item--active' : ''}`}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                onClick={() => setActiveId(s.id)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: s.id, x: e.clientX, y: e.clientY }); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveId(s.id); } }}
              >
                <span className="terminal-sidebar__item__icon">
                  {leaf.kind === 'editor' ? (
                    <Icon icon={getFileIcon(leaf.title)} width={14} height={14} />
                  ) : (
                    <Icon icon={getShellIcon(leaf.shell)} width={14} height={14} />
                  )}
                </span>
                {!tabCollapsed && (
                  <>
                    <span className="terminal-sidebar__item__text">{title}</span>
                    <button
                      className="terminal-sidebar__item__close"
                      aria-label="关闭标签"
                      onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                    >
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
            </Tooltip>
          );
        })}
      </div>

        {(tabCollapsed && !isLeft) && (
          <div style={{ padding: '4px 0', borderTop: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Tooltip content={showExplorer ? '隐藏文件浏览器' : '显示文件浏览器'} position="left">
              <Button icon={<PanelLeft size={14} />} size="small" theme="borderless" type={showExplorer ? 'primary' : 'tertiary'} onClick={() => setShowExplorer((v) => !v)} />
            </Tooltip>
            <Tooltip content="新建终端" position="left">
              <Button icon={<Plus size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => addTerminal()} />
            </Tooltip>
            <Tooltip content="终端设置" position="left">
              <Button icon={<Settings size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => setShowSettings(true)} />
            </Tooltip>
          </div>
        )}
        {(tabCollapsed && isLeft) && (
          <div style={{ padding: '4px 0', borderTop: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Tooltip content={showExplorer ? '隐藏文件浏览器' : '显示文件浏览器'} position="right">
              <Button icon={<PanelLeft size={14} />} size="small" theme="borderless" type={showExplorer ? 'primary' : 'tertiary'} onClick={() => setShowExplorer((v) => !v)} />
            </Tooltip>
            <Tooltip content="新建终端" position="right">
              <Button icon={<Plus size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => addTerminal()} />
            </Tooltip>
            <Tooltip content="终端设置" position="right">
              <Button icon={<Settings size={13} />} size="small" theme="borderless" type="tertiary" onClick={() => setShowSettings(true)} />
            </Tooltip>
          </div>
        )}
    </div>
  );

  /** 内容区：文件浏览器 + SSH 面板 + 终端面板 */
  const contentArea = (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
      {showExplorer && (
        <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)' }}>
          <FileExplorer active={showExplorer} onOpenFile={openEditor} onOpenTerminalAt={openTerminalAt} />
        </div>
      )}
      {showSshProfiles && (
        <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SshProfilesManager onConnect={handleSshConnect} onBrowseSftp={openSftp} />
        </div>
      )}
      {showSftp && sftpProfile && (
        <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SftpExplorer key={sftpProfile.id} profile={sftpProfile} onOpenFile={openEditor} />
        </div>
      )}
      {showDocker && (
        <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DockerExplorer active={showDocker} onOpenFile={openEditor} onAttachShell={handleDockerAttach} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              position: 'absolute',
              inset: 0,
              visibility: s.id === activeId ? 'visible' : 'hidden',
              zIndex: s.id === activeId ? 1 : 0,
              padding: '8px 4px 4px',
            }}
          >
            <PaneTreeView
              root={s.root}
              sessionActive={s.id === activeId}
              activePaneId={s.activePaneId}
              dirtyIds={dirtyIds}
              onFocusPane={(pid) => handleFocusPane(s.id, pid)}
              onSplitPane={(pid, dir) => handleSplitPane(s.id, pid, dir)}
              onClosePane={(pid) => handleClosePane(s.id, pid)}
              onDirtyChange={setDirty}
              onTitleChange={(pid, title) => handleTitleChange(s.id, pid, title)}
              onOpenTerminalAt={openTerminalAt}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: (tabPosition === 'right' || tabPosition === 'left') ? 'row' : 'column',
        background: 'var(--color-layout-bg)',
        overflow: 'hidden',
      }}
    >
      {tabPosition === 'top' && horizontalTabBar}

      {tabPosition === 'left' && (
        <>
          {verticalSidebar}
          {contentArea}
        </>
      )}
      {tabPosition === 'right' && (
        <>
          {contentArea}
          {verticalSidebar}
        </>
      )}
      {(tabPosition === 'top' || tabPosition === 'bottom') && contentArea}

      {tabPosition === 'bottom' && horizontalTabBar}

      <TerminalSettings visible={showSettings} onClose={() => setShowSettings(false)} shells={shells} />

      {ctxMenu && (
        <Dropdown
          trigger="click"
          visible
          clickToHide
          position="bottomLeft"
          onVisibleChange={(v) => { if (!v) setCtxMenu(null); }}
          render={(
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => { removeSession(ctxMenu.id); setCtxMenu(null); }}>关闭</Dropdown.Item>
              <Dropdown.Item onClick={() => { closeOthers(ctxMenu.id); setCtxMenu(null); }}>关闭其他</Dropdown.Item>
              <Dropdown.Item onClick={() => { closeRight(ctxMenu.id); setCtxMenu(null); }}>关闭右侧</Dropdown.Item>
              <Dropdown.Item onClick={() => { closeAll(); setCtxMenu(null); }}>全部关闭</Dropdown.Item>
            </Dropdown.Menu>
          )}
        >
          <span style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, width: 1, height: 1 }} />
        </Dropdown>
      )}
    </div>
  );
}
