import { useState, useCallback } from 'react';
import { Button, Typography, Space, Dropdown, Tooltip } from '@douyinfe/semi-ui';
import { Plus, TerminalSquare, ChevronDown, X, PanelLeft } from 'lucide-react';
import TerminalTab, { type ShellType } from './TerminalTab';
import FileExplorer from './FileExplorer';

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
  bash: 'Git Bash',
};

interface Session {
  id: string;
  title: string;
  shell: ShellType;
}

let sessionCounter = 1;

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
  const [sessions, setSessions] = useState<Session[]>([
    { id: String(sessionCounter), title: SHELL_LABELS.powershell, shell: 'powershell' },
  ]);
  const [activeId, setActiveId] = useState(String(sessionCounter));
  const [showExplorer, setShowExplorer] = useState(false);

  const addSession = useCallback((shell: ShellType) => {
    sessionCounter += 1;
    const id = String(sessionCounter);
    setSessions((prev) => [...prev, { id, title: SHELL_LABELS[shell], shell }]);
    setActiveId(id);
  }, []);

  const removeSession = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        sessionCounter += 1;
        const newId = String(sessionCounter);
        setActiveId(newId);
        return [{ id: newId, title: SHELL_LABELS.powershell, shell: 'powershell' }];
      }
      return next;
    });
    setActiveId((prev) => {
      if (prev !== id) return prev;
      const idx = sessions.findIndex((s) => s.id === id);
      const remaining = sessions.filter((s) => s.id !== id);
      return remaining[Math.max(0, idx - 1)]?.id ?? remaining[0]?.id ?? prev;
    });
  };

  if (IS_DEMO) return <DemoNotice />;

  const shellMenu = (
    <Dropdown.Menu>
      {(Object.keys(SHELL_LABELS) as ShellType[]).map((sh) => (
        <Dropdown.Item key={sh} onClick={() => addSession(sh)}>
          {SHELL_LABELS[sh]}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  const tabBarRight = (
    <Space spacing={2} style={{ padding: '0 8px', borderLeft: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
      <Button
        icon={<Plus size={13} />}
        size="small"
        theme="borderless"
        type="tertiary"
        onClick={() => addSession('powershell')}
        title="新建终端（PowerShell）"
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
            style={{ margin: '0 4px', flexShrink: 0 }}
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
                onClick={() => setActiveId(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveId(s.id);
                  }
                }}
              >
                <span className="admin-tab-item__icon"><TerminalSquare size={13} /></span>
                <span className="admin-tab-item__text">{s.title}</span>
                {sessions.length > 1 && (
                  <button
                    className="admin-tab-item__close"
                    aria-label="关闭终端"
                    onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {tabBarRight}
      </div>

      {/* 内容区：左侧文件浏览器（可收起）+ 右侧终端 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {showExplorer && (
          <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)' }}>
            <FileExplorer active={showExplorer} />
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
              <TerminalTab sessionId={s.id} active={s.id === activeId} shell={s.shell} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
