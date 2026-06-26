import { type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Tooltip } from '@douyinfe/semi-ui';
import { PanelRight, PanelBottom, X } from 'lucide-react';
import TerminalTab from './TerminalTab';
import EditorTab from './EditorTab';
import { collectLeaves, type PaneLeaf, type PaneNode, type SplitDirection } from './paneTree';
import './terminal-split.css';

interface PaneTreeViewProps {
  /** 当前 tab 的分屏树根 */
  readonly root: PaneNode;
  /** 所属 tab 是否处于激活态（用于 TerminalTab/EditorTab 的 active） */
  readonly sessionActive: boolean;
  /** 当前聚焦的叶子 id */
  readonly activePaneId: string;
  /** 编辑器脏标记集合（按 pane id） */
  readonly dirtyIds: ReadonlySet<string>;
  readonly onFocusPane: (id: string) => void;
  readonly onSplitPane: (id: string, direction: SplitDirection) => void;
  readonly onClosePane: (id: string) => void;
  readonly onDirtyChange: (id: string, dirty: boolean) => void;
  readonly onTitleChange?: (paneId: string, newTitle: string) => void;
  readonly onOpenTerminalAt?: (cwd: string) => void;
}

export default function PaneTreeView({
  root,
  sessionActive,
  activePaneId,
  onFocusPane,
  onSplitPane,
  onClosePane,
  onDirtyChange,
  onTitleChange,
  onOpenTerminalAt,
}: PaneTreeViewProps) {
  const leafCount = collectLeaves(root).length;
  const showFocus = leafCount > 1;

  const renderLeaf = (leaf: PaneLeaf): ReactNode => {
    const focused = leaf.id === activePaneId;
    return (
      <div
        className="terminal-pane"
        data-kind={leaf.kind}
        data-closeable={leafCount > 1 ? 'true' : 'false'}
        data-focused={showFocus && focused ? 'true' : 'false'}
        onMouseDownCapture={() => onFocusPane(leaf.id)}
      >
        <div className="terminal-pane__toolbar">
          <Tooltip content="向右拆分">
            <button
              type="button"
              className="terminal-pane__btn"
              aria-label="向右拆分"
              onClick={() => onSplitPane(leaf.id, 'horizontal')}
            >
              <PanelRight size={13} />
            </button>
          </Tooltip>
          <Tooltip content="向下拆分">
            <button
              type="button"
              className="terminal-pane__btn"
              aria-label="向下拆分"
              onClick={() => onSplitPane(leaf.id, 'vertical')}
            >
              <PanelBottom size={13} />
            </button>
          </Tooltip>
          {leafCount > 1 && (
            <Tooltip content="关闭面板">
              <button
                type="button"
                className="terminal-pane__btn"
                aria-label="关闭面板"
                onClick={() => onClosePane(leaf.id)}
              >
                <X size={13} />
              </button>
            </Tooltip>
          )}
        </div>
        <div className="terminal-pane__body">
          {leaf.kind === 'terminal' ? (
            <TerminalTab
              sessionId={leaf.stableSessionId}
              active={sessionActive}
              shell={leaf.shell ?? ''}
              label={leaf.title}
              cwd={leaf.cwd}
              onTitleChange={onTitleChange ? (t) => onTitleChange(leaf.id, t) : undefined}
              onOpenTerminalAt={onOpenTerminalAt}
            />
          ) : (
            <EditorTab
              filePath={leaf.filePath ?? ''}
              active={sessionActive}
              onDirtyChange={(d) => onDirtyChange(leaf.id, d)}
            />
          )}
        </div>
      </div>
    );
  };

  const renderNode = (node: PaneNode): ReactNode => {
    if (node.type === 'leaf') return renderLeaf(node);
    return (
      <PanelGroup direction={node.direction} className="terminal-panel-group">
        {node.children.flatMap((child, i) => {
          const panel = (
            <Panel key={child.id} id={child.id} order={i} minSize={8} className="terminal-panel">
              {renderNode(child)}
            </Panel>
          );
          if (i === 0) return [panel];
          const handle = (
            <PanelResizeHandle
              key={`handle-${child.id}`}
              className={`terminal-resize-handle terminal-resize-handle--${node.direction}`}
            />
          );
          return [handle, panel];
        })}
      </PanelGroup>
    );
  };

  return (
    <div className="terminal-pane-tree">
      {root.type === 'leaf' ? (
        // 单面板：始终包裹在 PanelGroup+Panel 中，保证分屏关闭后 Panel key 不变，
        // TerminalTab 不重建， WebSocket 不断线。
        <PanelGroup direction="horizontal" className="terminal-panel-group">
          <Panel key={root.id} id={root.id} order={0} minSize={8} className="terminal-panel">
            {renderLeaf(root)}
          </Panel>
        </PanelGroup>
      ) : (
        renderNode(root)
      )}
    </div>
  );
}
