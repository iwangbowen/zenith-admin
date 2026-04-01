import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  type NodeProps,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Drawer, Form, Modal, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import {
  ArrowLeft, Save, Plus, Users, FilePen, Forward, GitBranch,
  Columns2, CircleDot, Clock, Shuffle, Zap, Layers, X, Trash2,
} from 'lucide-react';
import type {
  DingFlowNode, DingFlowSimpleNode, DingFlowGateway, DingFlowBranch,
  DingNodeType, DingGatewayType, WorkflowDefinition,
} from '@zenith/shared';
import { request } from '@/utils/request';

// ─── Layout constants ──────────────────────────────────────────────────────────
const NODE_W = 220;
const NODE_H = 88;
const ADD_BTN_D = 32;
const V_GAP = 14;
const GW_H = 32;
const GW_W = 128;
const BRANCH_GAP = 20;
const BRANCH_CARD_H = 88;

// ─── Types ────────────────────────────────────────────────────────────────────
interface LayoutElement {
  id: string;
  kind: 'card' | 'branchCard' | 'gateway' | 'addBtn';
  x: number; y: number; w: number; h: number;
  node?: DingFlowSimpleNode;
  branch?: DingFlowBranch & { gatewayId: string };
  gatewayNode?: DingFlowGateway;
  insertAfterNodeId?: string;
  insertAfterGatewayId?: string;
  insertInBranchId?: string;
}
interface LayoutLine { id: string; x1: number; y1: number; x2: number; y2: number; }
interface LayoutResult { elements: LayoutElement[]; lines: LayoutLine[]; width: number; bottomY: number; }
interface UserOption { id: number; nickname: string; }

// ─── Layout algorithm ─────────────────────────────────────────────────────────
function layoutNode(node: DingFlowNode, cx: number, y: number): LayoutResult {
  return (node as DingFlowGateway).type === 'gateway'
    ? layoutGateway(node as DingFlowGateway, cx, y)
    : layoutSimpleNode(node as DingFlowSimpleNode, cx, y);
}

function layoutSimpleNode(node: DingFlowSimpleNode, cx: number, y: number): LayoutResult {
  const elements: LayoutElement[] = [];
  const lines: LayoutLine[] = [];
  elements.push({ id: node.id, kind: 'card', x: cx - NODE_W / 2, y, w: NODE_W, h: NODE_H, node });
  let curY = y + NODE_H;
  lines.push({ id: `l1-${node.id}`, x1: cx, y1: curY, x2: cx, y2: curY + V_GAP });
  curY += V_GAP;
  const addId = `add-after-${node.id}`;
  elements.push({ id: addId, kind: 'addBtn', x: cx - ADD_BTN_D / 2, y: curY, w: ADD_BTN_D, h: ADD_BTN_D, insertAfterNodeId: node.id });
  curY += ADD_BTN_D;
  if (node.next) {
    lines.push({ id: `l2-${node.id}`, x1: cx, y1: curY, x2: cx, y2: curY + V_GAP });
    curY += V_GAP;
    const next = layoutNode(node.next, cx, curY);
    elements.push(...next.elements);
    lines.push(...next.lines);
    curY = next.bottomY;
  }
  return { elements, lines, width: NODE_W, bottomY: curY };
}

function layoutBranch(branch: DingFlowBranch, gatewayId: string, cx: number, y: number): LayoutResult {
  const elements: LayoutElement[] = [];
  const lines: LayoutLine[] = [];
  elements.push({
    id: `bc-${branch.id}`, kind: 'branchCard',
    x: cx - NODE_W / 2, y, w: NODE_W, h: BRANCH_CARD_H,
    branch: { ...branch, gatewayId },
  });
  let curY = y + BRANCH_CARD_H;
  lines.push({ id: `lbc1-${branch.id}`, x1: cx, y1: curY, x2: cx, y2: curY + V_GAP });
  curY += V_GAP;
  const addId = `add-in-${branch.id}`;
  elements.push({ id: addId, kind: 'addBtn', x: cx - ADD_BTN_D / 2, y: curY, w: ADD_BTN_D, h: ADD_BTN_D, insertInBranchId: branch.id });
  curY += ADD_BTN_D;
  if (branch.head) {
    lines.push({ id: `lbc2-${branch.id}`, x1: cx, y1: curY, x2: cx, y2: curY + V_GAP });
    curY += V_GAP;
    const inner = layoutNode(branch.head, cx, curY);
    elements.push(...inner.elements);
    lines.push(...inner.lines);
    curY = inner.bottomY;
  }
  return { elements, lines, width: NODE_W, bottomY: curY };
}

function layoutGateway(node: DingFlowGateway, cx: number, y: number): LayoutResult {
  const elements: LayoutElement[] = [];
  const lines: LayoutLine[] = [];

  // Pass 1: measure branch widths
  const dummy = node.branches.map(b => layoutBranch(b, node.id, 0, 0));
  const bWidths = dummy.map(d => Math.max(d.width, NODE_W));
  const totalBW = bWidths.reduce((s, w) => s + w, 0) + (bWidths.length - 1) * BRANCH_GAP;
  const totalW = Math.max(totalBW, GW_W);

  // Gateway pill
  elements.push({ id: `gw-${node.id}`, kind: 'gateway', x: cx - GW_W / 2, y, w: GW_W, h: GW_H, gatewayNode: node });
  let curY = y + GW_H;

  const startX = cx - totalBW / 2;
  const leftCX = startX + bWidths[0] / 2;
  const rightCX = startX + totalBW - bWidths[bWidths.length - 1] / 2;

  if (node.branches.length > 1) {
    lines.push({ id: `ltop-${node.id}`, x1: leftCX, y1: curY, x2: rightCX, y2: curY });
  }

  const branchTopY = curY + V_GAP;
  let bX = startX;
  const bResults: LayoutResult[] = [];
  for (let i = 0; i < node.branches.length; i++) {
    const b = node.branches[i];
    const bw = bWidths[i];
    const bCX = bX + bw / 2;
    lines.push({ id: `lvtop-${b.id}`, x1: bCX, y1: curY, x2: bCX, y2: branchTopY });
    const r = layoutBranch(b, node.id, bCX, branchTopY);
    elements.push(...r.elements);
    lines.push(...r.lines);
    bResults.push(r);
    bX += bw + BRANCH_GAP;
  }

  const maxBottom = Math.max(...bResults.map(r => r.bottomY));
  bX = startX;
  for (let i = 0; i < node.branches.length; i++) {
    const bw = bWidths[i];
    const bCX = bX + bw / 2;
    if (bResults[i].bottomY < maxBottom) {
      lines.push({ id: `lext-${node.branches[i].id}`, x1: bCX, y1: bResults[i].bottomY, x2: bCX, y2: maxBottom });
    }
    bX += bw + BRANCH_GAP;
  }
  if (node.branches.length > 1) {
    lines.push({ id: `lbot-${node.id}`, x1: leftCX, y1: maxBottom, x2: rightCX, y2: maxBottom });
  }

  curY = maxBottom;
  lines.push({ id: `lconv-${node.id}`, x1: cx, y1: curY, x2: cx, y2: curY + V_GAP });
  curY += V_GAP;
  const afterId = `add-after-gw-${node.id}`;
  elements.push({ id: afterId, kind: 'addBtn', x: cx - ADD_BTN_D / 2, y: curY, w: ADD_BTN_D, h: ADD_BTN_D, insertAfterGatewayId: node.id });
  curY += ADD_BTN_D;
  if (node.next) {
    lines.push({ id: `lgwnext-${node.id}`, x1: cx, y1: curY, x2: cx, y2: curY + V_GAP });
    curY += V_GAP;
    const next = layoutNode(node.next, cx, curY);
    elements.push(...next.elements);
    lines.push(...next.lines);
    curY = next.bottomY;
  }
  return { elements, lines, width: totalW, bottomY: curY };
}

function computeLayout(tree: DingFlowNode) {
  const r = layoutNode(tree, 0, 0);
  const xs = r.elements.map(e => e.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...r.elements.map(e => e.x + e.w));
  const totalW = maxX - minX + 80;
  const totalH = r.bottomY + 80;
  const offsetX = -minX + 40;
  const offsetY = 40;
  const elements = r.elements.map(e => ({ ...e, x: e.x + offsetX, y: e.y + offsetY }));
  const lines = r.lines.map(l => ({ ...l, x1: l.x1 + offsetX, y1: l.y1 + offsetY, x2: l.x2 + offsetX, y2: l.y2 + offsetY }));
  return { elements, lines, totalW, totalH };
}

// ─── Tree mutations ────────────────────────────────────────────────────────────
let _idCounter = 1000;
const genId = () => `n${++_idCounter}`;
const genBranchId = () => `b${++_idCounter}`;

function insertAfterInTree(tree: DingFlowNode | null | undefined, targetId: string, newNode: DingFlowNode): DingFlowNode | null {
  if (!tree) return null;
  if (tree.id === targetId) {
    const oldNext = (tree as DingFlowSimpleNode).next ?? (tree as DingFlowGateway).next ?? null;
    return { ...tree, next: { ...newNode, next: oldNext } } as DingFlowNode;
  }
  if ((tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    return {
      ...gw,
      branches: gw.branches.map(b => ({ ...b, head: insertAfterInTree(b.head ?? null, targetId, newNode) ?? undefined })),
      next: insertAfterInTree(gw.next ?? null, targetId, newNode) ?? undefined,
    };
  }
  const n = tree as DingFlowSimpleNode;
  return { ...n, next: insertAfterInTree(n.next ?? null, targetId, newNode) ?? undefined };
}

function insertInBranchTree(tree: DingFlowNode | null | undefined, branchId: string, newNode: DingFlowNode): DingFlowNode | null {
  if (!tree) return null;
  if ((tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    if (gw.branches.some(b => b.id === branchId)) {
      return {
        ...gw,
        branches: gw.branches.map(b => {
          if (b.id !== branchId) return b;
          return { ...b, head: { ...newNode, next: b.head ?? null } as DingFlowNode };
        }),
      };
    }
    return {
      ...gw,
      branches: gw.branches.map(b => ({ ...b, head: insertInBranchTree(b.head ?? null, branchId, newNode) ?? undefined })),
      next: insertInBranchTree(gw.next ?? null, branchId, newNode) ?? undefined,
    };
  }
  const n = tree as DingFlowSimpleNode;
  return { ...n, next: insertInBranchTree(n.next ?? null, branchId, newNode) ?? undefined };
}

function deleteNodeFromTree(tree: DingFlowNode | null | undefined, targetId: string): DingFlowNode | null {
  if (!tree) return null;
  if (tree.id === targetId) {
    const next = (tree as DingFlowSimpleNode).next ?? (tree as DingFlowGateway).next ?? null;
    return next ?? null;
  }
  if ((tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    return {
      ...gw,
      branches: gw.branches.map(b => ({ ...b, head: deleteNodeFromTree(b.head ?? null, targetId) ?? undefined })),
      next: deleteNodeFromTree(gw.next ?? null, targetId) ?? undefined,
    };
  }
  const n = tree as DingFlowSimpleNode;
  return { ...n, next: deleteNodeFromTree(n.next ?? null, targetId) ?? undefined };
}

function updateNodeInTree(tree: DingFlowNode | null | undefined, targetId: string, updates: Partial<DingFlowSimpleNode>): DingFlowNode | null {
  if (!tree) return null;
  if (tree.id === targetId) return { ...tree, ...updates } as DingFlowNode;
  if ((tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    return {
      ...gw,
      branches: gw.branches.map(b => ({ ...b, head: updateNodeInTree(b.head ?? null, targetId, updates) ?? undefined })),
      next: updateNodeInTree(gw.next ?? null, targetId, updates) ?? undefined,
    };
  }
  const n = tree as DingFlowSimpleNode;
  return { ...n, next: updateNodeInTree(n.next ?? null, targetId, updates) ?? undefined };
}

function updateBranchInTree(tree: DingFlowNode | null | undefined, branchId: string, updates: Partial<DingFlowBranch>): DingFlowNode | null {
  if (!tree) return null;
  if ((tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    return {
      ...gw,
      branches: gw.branches.map(b =>
        b.id === branchId
          ? { ...b, ...updates }
          : { ...b, head: updateBranchInTree(b.head ?? null, branchId, updates) ?? undefined }
      ),
      next: updateBranchInTree(gw.next ?? null, branchId, updates) ?? undefined,
    };
  }
  const n = tree as DingFlowSimpleNode;
  return { ...n, next: updateBranchInTree(n.next ?? null, branchId, updates) ?? undefined };
}

function addBranchInTree(tree: DingFlowNode | null | undefined, gatewayId: string, newBranch: DingFlowBranch): DingFlowNode | null {
  if (!tree) return null;
  if (tree.id === gatewayId && (tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    const branches = [...gw.branches];
    branches.splice(branches.length - 1, 0, newBranch);
    return { ...gw, branches };
  }
  if ((tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    return {
      ...gw,
      branches: gw.branches.map(b => ({ ...b, head: addBranchInTree(b.head ?? null, gatewayId, newBranch) ?? undefined })),
      next: addBranchInTree(gw.next ?? null, gatewayId, newBranch) ?? undefined,
    };
  }
  const n = tree as DingFlowSimpleNode;
  return { ...n, next: addBranchInTree(n.next ?? null, gatewayId, newBranch) ?? undefined };
}

function deleteBranchInTree(tree: DingFlowNode | null | undefined, gatewayId: string, branchId: string): DingFlowNode | null {
  if (!tree) return null;
  if (tree.id === gatewayId && (tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    const remaining = gw.branches.filter(b => b.id !== branchId);
    if (remaining.length < 2) return tree; // keep at least 2 branches
    return { ...gw, branches: remaining };
  }
  if ((tree as DingFlowGateway).type === 'gateway') {
    const gw = tree as DingFlowGateway;
    return {
      ...gw,
      branches: gw.branches.map(b => ({ ...b, head: deleteBranchInTree(b.head ?? null, gatewayId, branchId) ?? undefined })),
      next: deleteBranchInTree(gw.next ?? null, gatewayId, branchId) ?? undefined,
    };
  }
  const n = tree as DingFlowSimpleNode;
  return { ...n, next: deleteBranchInTree(n.next ?? null, gatewayId, branchId) ?? undefined };
}

// ─── Node meta ────────────────────────────────────────────────────────────────
interface NodeMeta { label: string; description: string; icon: React.ReactNode; color: string; }

const GATEWAY_COLORS: Record<DingGatewayType, { bg: string; text: string; border: string }> = {
  condition: { bg: '#e6fffb', text: '#13c2c2', border: '#87e8de' },
  parallel: { bg: '#f3e8ff', text: '#722ed1', border: '#d3adf7' },
  inclusive: { bg: '#fff7e6', text: '#d46b08', border: '#ffd591' },
  route: { bg: '#e6f4ff', text: '#1677ff', border: '#91caff' },
};

const GATEWAY_LABELS: Record<DingGatewayType, string> = {
  condition: '添加条件',
  parallel: '添加分支',
  inclusive: '包容分支',
  route: '路由分支',
};

const NODE_ACCENT = '#ff6b35';
const NODE_BORDER_DEFAULT = '#e0e0e0';

function getNodeMeta(type: DingNodeType): NodeMeta {
  const map: Record<DingNodeType, NodeMeta> = {
    start: { label: '发起人', description: '请设置发起人', icon: <Users size={16} color={NODE_ACCENT} />, color: NODE_ACCENT },
    approve: { label: '审批人', description: '请设置审批人', icon: <Users size={16} color={NODE_ACCENT} />, color: NODE_ACCENT },
    handler: { label: '办理人', description: '请设置办理人', icon: <FilePen size={16} color='#1677ff' />, color: '#1677ff' },
    cc: { label: '抄送', description: '请设置抄送人', icon: <Forward size={16} color='#13c2c2' />, color: '#13c2c2' },
    delay: { label: '延迟器', description: '请设置延迟时间', icon: <Clock size={16} color='#faad14' />, color: '#faad14' },
    trigger: { label: '触发器', description: '请设置触发条件', icon: <Zap size={16} color='#ff4d4f' />, color: '#ff4d4f' },
    subprocess: { label: '子流程', description: '请设置子流程', icon: <Layers size={16} color='#722ed1' />, color: '#722ed1' },
  };
  return map[type];
}

// ─── Add node panel ────────────────────────────────────────────────────────────
type InsertInfo =
  | { kind: 'afterNode'; afterId: string }
  | { kind: 'afterGateway'; gatewayId: string }
  | { kind: 'inBranch'; branchId: string };

interface AddPanelState { info: InsertInfo; screenX: number; screenY: number; }

const ADD_PANEL_OPTIONS: Array<{ type: DingNodeType | DingGatewayType; label: string; icon: React.ReactNode; color: string; isGateway?: boolean }> = [
  { type: 'approve', label: '审批人', icon: <Users size={20} />, color: '#ff6b35' },
  { type: 'handler', label: '办理人', icon: <FilePen size={20} />, color: '#1677ff' },
  { type: 'cc', label: '抄送', icon: <Forward size={20} />, color: '#13c2c2' },
  { type: 'condition', label: '条件分支', icon: <GitBranch size={20} />, color: '#13c2c2', isGateway: true },
  { type: 'parallel', label: '并行分支', icon: <Columns2 size={20} />, color: '#722ed1', isGateway: true },
  { type: 'inclusive', label: '包容分支', icon: <CircleDot size={20} />, color: '#d46b08', isGateway: true },
  { type: 'delay', label: '延迟器', icon: <Clock size={20} />, color: '#faad14' },
  { type: 'route', label: '路由分支', icon: <Shuffle size={20} />, color: '#1677ff', isGateway: true },
  { type: 'trigger', label: '触发器', icon: <Zap size={20} />, color: '#ff4d4f' },
  { type: 'subprocess', label: '子流程', icon: <Layers size={20} />, color: '#722ed1' },
];

function AddNodePanel({ state, onSelect, onClose }: { state: AddPanelState; onSelect: (type: DingNodeType | DingGatewayType, isGateway: boolean) => void; onClose: () => void }) {
  const PANEL_W = 280;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={onClose} />
      <div style={{
        position: 'fixed', zIndex: 1000,
        left: Math.min(state.screenX - 16, window.innerWidth - PANEL_W - 16),
        top: state.screenY + 8,
        width: PANEL_W,
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        padding: '16px 12px 12px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>选择节点类型</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#999', padding: 0 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {ADD_PANEL_OPTIONS.map(opt => (
            <button
              key={opt.type}
              onClick={() => { onSelect(opt.type, opt.isGateway ?? false); onClose(); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 4px',
                border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f7ff'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#91caff'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fafafa'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#f0f0f0'; }}
            >
              <span style={{ color: opt.color }}>{opt.icon}</span>
              <span style={{ fontSize: 11, color: '#555', lineHeight: 1.2 }}>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Flow canvas content (rendered inside xyflow root node) ──────────────────
interface FlowCallbacks {
  onAddButtonClick: (el: LayoutElement, e: React.MouseEvent) => void;
  onNodeClick: (node: DingFlowSimpleNode) => void;
  onBranchCardClick: (branch: DingFlowBranch & { gatewayId: string }) => void;
  onGatewayClick: (gw: DingFlowGateway) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteBranch: (gatewayId: string, branchId: string) => void;
  isEditable: boolean;
}

function FlowCard({ el, cbs }: { el: LayoutElement; cbs: FlowCallbacks }) {
  const node = el.node!;
  const meta = getNodeMeta(node.type);
  const [hovered, setHovered] = useState(false);
  const isStart = node.type === 'start';

  return (
    <div
      style={{
        position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h,
        background: '#fff',
        border: `2px solid ${isStart || hovered ? NODE_ACCENT : NODE_BORDER_DEFAULT}`,
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '10px 14px',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        ...(hovered ? { boxShadow: '0 4px 16px rgba(255,107,53,0.15)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => cbs.onNodeClick(node)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {meta.icon}
        <span style={{ fontWeight: 700, fontSize: 13, color: '#333', flex: 1 }}>{node.label}</span>
        {cbs.isEditable && !isStart && hovered && (
          <button
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#bbb', display: 'flex', alignItems: 'center' }}
            onClick={e => { e.stopPropagation(); cbs.onDeleteNode(node.id); }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#999', lineHeight: 1.4 }}>
        {node.description ?? meta.description}
      </div>
    </div>
  );
}

function BranchCardEl({ el, cbs }: { el: LayoutElement; cbs: FlowCallbacks }) {
  const branch = el.branch!;
  const [hovered, setHovered] = useState(false);
  const hasCondition = !branch.isDefault;
  const borderColor = hasCondition ? NODE_ACCENT : NODE_BORDER_DEFAULT;
  const titleColor = NODE_ACCENT;
  const priorityText = branch.isDefault
    ? `优先级${branch.priority ?? ''}`
    : `优先级${branch.priority ?? ''}`;

  return (
    <div
      style={{
        position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h,
        background: '#fff',
        border: `2px solid ${hovered ? NODE_ACCENT : borderColor}`,
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        padding: '10px 14px',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => cbs.onBranchCardClick(branch)}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: titleColor, flex: 1 }}>{branch.label}</span>
        <span style={{ fontSize: 11, color: '#999' }}>{priorityText}</span>
        {cbs.isEditable && !branch.isDefault && hovered && (
          <button
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '0 0 0 6px', color: '#bbb', display: 'flex', alignItems: 'center' }}
            onClick={e => { e.stopPropagation(); cbs.onDeleteBranch(branch.gatewayId, branch.id); }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#999', lineHeight: 1.4 }}>
        {branch.description ?? (branch.isDefault ? '未满足其它条件时，将进入此分支' : '请设置条件')}
      </div>
    </div>
  );
}

function GatewayEl({ el, cbs }: { el: LayoutElement; cbs: FlowCallbacks }) {
  const gw = el.gatewayNode!;
  const colors = GATEWAY_COLORS[gw.gatewayType];
  const label = GATEWAY_LABELS[gw.gatewayType];

  return (
    <div
      style={{
        position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: cbs.isEditable ? 'pointer' : 'default',
        fontSize: 12, fontWeight: 600, color: colors.text,
        userSelect: 'none',
      }}
      onClick={() => cbs.isEditable && cbs.onGatewayClick(gw)}
    >
      {label}
    </div>
  );
}

function AddBtnEl({ el, cbs }: { el: LayoutElement; cbs: FlowCallbacks }) {
  const [hovered, setHovered] = useState(false);
  if (!cbs.isEditable) return null;
  return (
    <div
      style={{
        position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h,
        borderRadius: '50%',
        background: hovered ? '#1554ad' : '#1677ff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(22,119,255,0.35)',
        transition: 'background 0.15s, transform 0.15s',
        transform: hovered ? 'scale(1.08)' : 'scale(1)',
        zIndex: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={e => cbs.onAddButtonClick(el, e)}
    >
      <Plus size={16} color="#fff" strokeWidth={2.5} />
    </div>
  );
}

function FlowContent({ tree, cbs }: { tree: DingFlowNode; cbs: FlowCallbacks }) {
  const { elements, lines, totalW, totalH } = computeLayout(tree);

  return (
    <div style={{ position: 'relative', width: totalW, height: totalH }}>
      <svg style={{ position: 'absolute', top: 0, left: 0, width: totalW, height: totalH, pointerEvents: 'none' }}>
        {lines.map(l => (
          <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#d9d9d9" strokeWidth={1.5} />
        ))}
      </svg>
      {elements.map(el => {
        if (el.kind === 'card') return <FlowCard key={el.id} el={el} cbs={cbs} />;
        if (el.kind === 'branchCard') return <BranchCardEl key={el.id} el={el} cbs={cbs} />;
        if (el.kind === 'gateway') return <GatewayEl key={el.id} el={el} cbs={cbs} />;
        if (el.kind === 'addBtn') return <AddBtnEl key={el.id} el={el} cbs={cbs} />;
        return null;
      })}
    </div>
  );
}

// ─── Single xyflow root node ───────────────────────────────────────────────────
function FlowRootNode({ data }: NodeProps) {
  const { tree, cbs, totalW, totalH } = data as unknown as { tree: DingFlowNode; cbs: FlowCallbacks; totalW: number; totalH: number };
  return (
    <div style={{ width: totalW, height: totalH, pointerEvents: 'all' }}>
      <FlowContent tree={tree} cbs={cbs} />
    </div>
  );
}
const nodeTypes = { flowRoot: FlowRootNode };

// ─── Default tree ──────────────────────────────────────────────────────────────
function makeDefaultTree(): DingFlowSimpleNode {
  return { id: 'node-start', type: 'start', label: '发起人', description: '请设置发起人', next: null };
}

// ─── Main designer with xyflow provider ───────────────────────────────────────
function WorkflowDesignerInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  const isNew = id === 'new';

  const [pageLoading, setPageLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [tree, setTree] = useState<DingFlowNode>(makeDefaultTree());
  const [users, setUsers] = useState<UserOption[]>([]);

  // UI state
  const [addPanel, setAddPanel] = useState<AddPanelState | null>(null);
  const [metaModal, setMetaModal] = useState(false);
  const [editNode, setEditNode] = useState<DingFlowSimpleNode | null>(null);
  const [editBranch, setEditBranch] = useState<(DingFlowBranch & { gatewayId: string }) | null>(null);
  const metaFormApi = useRef<FormApi | null>(null);
  const nodeFormApi = useRef<FormApi | null>(null);
  const branchFormApi = useRef<FormApi | null>(null);

  // xyflow nodes state (single root node wrapping all content)
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);

  const isEditable = definition?.status !== 'published';

  // Load definition
  useEffect(() => {
    if (!isNew && id) {
      setPageLoading(true);
      request.get<WorkflowDefinition>(`/api/workflows/definitions/${id}`)
        .then(res => {
          if (res.code === 0 && res.data) {
            setDefinition(res.data);
            const fd = res.data.flowData;
            if (fd?.tree) setTree(fd.tree as DingFlowNode);
          }
        })
        .finally(() => setPageLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // Load users
  useEffect(() => {
    request.get<{ list: UserOption[] }>('/api/users?page=1&pageSize=200').then(res => {
      if (res.code === 0 && res.data?.list) setUsers(res.data.list);
    });
  }, []);

  // Sync tree → xyflow node
  useEffect(() => {
    const { totalW, totalH } = computeLayout(tree);
    setRfNodes([{
      id: 'root',
      type: 'flowRoot',
      position: { x: 0, y: 0 },
      data: { tree, cbs, totalW, totalH } as unknown as Record<string, unknown>,
      style: { border: 'none', background: 'transparent', padding: 0 },
    }]);
    // fitView after a tick
    setTimeout(() => fitView({ padding: 0.1, duration: 200 }), 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, isEditable]);

  // ─── Callbacks ───────────────────────────────────────────────────────────────
  const handleAddButtonClick = useCallback((el: LayoutElement, e: React.MouseEvent) => {
    e.stopPropagation();
    let info: InsertInfo;
    if (el.insertAfterNodeId) info = { kind: 'afterNode', afterId: el.insertAfterNodeId };
    else if (el.insertAfterGatewayId) info = { kind: 'afterGateway', gatewayId: el.insertAfterGatewayId };
    else if (el.insertInBranchId) info = { kind: 'inBranch', branchId: el.insertInBranchId };
    else return;
    setAddPanel({ info, screenX: e.clientX, screenY: e.clientY });
  }, []);

  const handleSelectNodeType = useCallback((type: DingNodeType | DingGatewayType, isGateway: boolean, info: InsertInfo) => {
    if (isGateway) {
      const gatewayType = type as DingGatewayType;
      const newGateway: DingFlowGateway = {
        id: genId(), type: 'gateway', gatewayType,
        branches: [
          { id: genBranchId(), label: `${GATEWAY_LABELS[gatewayType].replace('添加', '')}1`, priority: 1, isDefault: false },
          { id: genBranchId(), label: '其它情况', priority: 2, isDefault: true },
        ],
        next: null,
      };
      setTree(prev => {
        if (info.kind === 'afterNode') return insertAfterInTree(prev, info.afterId, newGateway) ?? prev;
        if (info.kind === 'afterGateway') return insertAfterInTree(prev, info.gatewayId, newGateway) ?? prev;
        if (info.kind === 'inBranch') return insertInBranchTree(prev, info.branchId, newGateway) ?? prev;
        return prev;
      });
    } else {
      const nodeType = type as DingNodeType;
      const meta = getNodeMeta(nodeType);
      const newNode: DingFlowSimpleNode = { id: genId(), type: nodeType, label: meta.label, description: meta.description, next: null };
      setTree(prev => {
        if (info.kind === 'afterNode') return insertAfterInTree(prev, info.afterId, newNode) ?? prev;
        if (info.kind === 'afterGateway') return insertAfterInTree(prev, info.gatewayId, newNode) ?? prev;
        if (info.kind === 'inBranch') return insertInBranchTree(prev, info.branchId, newNode) ?? prev;
        return prev;
      });
    }
  }, []);

  const handleNodeClick = useCallback((node: DingFlowSimpleNode) => {
    setEditNode(node);
  }, []);

  const handleBranchCardClick = useCallback((branch: DingFlowBranch & { gatewayId: string }) => {
    setEditBranch(branch);
  }, []);

  const handleGatewayClick = useCallback((gw: DingFlowGateway) => {
    const newBranch: DingFlowBranch = {
      id: genBranchId(),
      label: `${GATEWAY_LABELS[gw.gatewayType].replace('添加', '')}${gw.branches.length}`,
      priority: gw.branches.length,
      isDefault: false,
    };
    setTree(prev => addBranchInTree(prev, gw.id, newBranch) ?? prev);
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setTree(prev => deleteNodeFromTree(prev, nodeId) ?? makeDefaultTree());
  }, []);

  const handleDeleteBranch = useCallback((gatewayId: string, branchId: string) => {
    setTree(prev => deleteBranchInTree(prev, gatewayId, branchId) ?? prev);
  }, []);

  const cbs: FlowCallbacks = {
    onAddButtonClick: handleAddButtonClick,
    onNodeClick: handleNodeClick,
    onBranchCardClick: handleBranchCardClick,
    onGatewayClick: handleGatewayClick,
    onDeleteNode: handleDeleteNode,
    onDeleteBranch: handleDeleteBranch,
    isEditable,
  };

  // Save
  const doSave = async (meta: { name: string; description?: string | null }) => {
    setSaving(true);
    try {
      const payload = { name: meta.name, description: meta.description ?? null, flowData: { tree } };
      const res = isNew
        ? await request.post<WorkflowDefinition>('/api/workflows/definitions', payload)
        : await request.put<WorkflowDefinition>(`/api/workflows/definitions/${id}`, payload);
      if (res.code === 0) {
        Toast.success('保存成功');
        if (isNew && res.data) navigate(`/workflow/designer/${res.data.id}`, { replace: true });
        setMetaModal(false);
        setDefinition(res.data ?? null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (isNew) { setMetaModal(true); return; }
    void doSave({ name: definition?.name ?? '未命名流程', description: definition?.description });
  };

  if (pageLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid var(--semi-color-border)',
        display: 'flex', alignItems: 'center', gap: 12, background: 'var(--semi-color-bg-1)',
      }}>
        <Button icon={<ArrowLeft size={14} />} type="tertiary" theme="borderless" onClick={() => navigate('/workflow/definitions')}>
          返回列表
        </Button>
        <Typography.Title heading={6} style={{ margin: 0, flex: 1 }}>
          {isNew ? '新建流程' : `设计流程：${definition?.name ?? ''}`}
          {definition?.status === 'published' && (
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--semi-color-success)', fontWeight: 400 }}>（已发布）</span>
          )}
        </Typography.Title>
        <Button icon={<Save size={14} />} type="primary" loading={saving} onClick={handleSave} disabled={!isEditable}>
          保存
        </Button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={rfNodes}
          edges={[]}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          minZoom={0.3}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e0e0e0" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Add node panel */}
      {addPanel && (
        <AddNodePanel
          state={addPanel}
          onSelect={(type, isGateway) => handleSelectNodeType(type, isGateway, addPanel.info)}
          onClose={() => setAddPanel(null)}
        />
      )}

      {/* Meta modal (new flow) */}
      <Modal
        title="填写流程信息" visible={metaModal} onCancel={() => setMetaModal(false)}
        okButtonProps={{ loading: saving }}
        onOk={() => { metaFormApi.current?.validate().then((v: Record<string, unknown>) => void doSave({ name: v.name as string, description: v.description as string })).catch(() => undefined); }}
      >
        <Form getFormApi={api => { metaFormApi.current = api; }}>
          <Form.Input field="name" label="流程名称" rules={[{ required: true, message: '请输入流程名称' }]} />
          <Form.TextArea field="description" label="描述" />
        </Form>
      </Modal>

      {/* Node edit drawer */}
      <Drawer
        title={`编辑节点：${editNode?.label ?? ''}`}
        visible={!!editNode}
        onClose={() => setEditNode(null)}
        width={400}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setEditNode(null)}>取消</Button>
            <Button type="primary" onClick={() => {
              nodeFormApi.current?.validate().then((values: Record<string, unknown>) => {
                if (!editNode) return;
                const assigneeId = (values.assigneeId as number | undefined) ?? null;
                const assigneeName = users.find(u => u.id === assigneeId)?.nickname ?? null;
                const assigneeIds = (values.assigneeIds as number[] | undefined) ?? [];
                const assigneeNames = assigneeIds.map(uid => users.find(u => u.id === uid)?.nickname ?? '').filter(Boolean);
                setTree(prev => updateNodeInTree(prev, editNode.id, {
                  label: values.label as string,
                  description: values.description as string | undefined,
                  config: { assigneeId, assigneeName, assigneeIds, assigneeNames },
                }) ?? prev);
                setEditNode(null);
              }).catch(() => undefined);
            }}>保存</Button>
          </div>
        }
      >
        {editNode && (
          <Form
            key={editNode.id}
            getFormApi={api => { nodeFormApi.current = api; }}
            initValues={{
              label: editNode.label,
              description: editNode.description ?? '',
              assigneeId: editNode.config?.assigneeId,
              assigneeIds: editNode.config?.assigneeIds ?? [],
            }}
          >
            <Form.Input field="label" label="节点名称" rules={[{ required: true, message: '请输入节点名称' }]} />
            <Form.Input field="description" label="描述" placeholder="请输入描述（选填）" />
            {(editNode.type === 'approve' || editNode.type === 'handler') && (
              <Form.Select
                field="assigneeId" label="指定人员"
                placeholder="请选择"
                optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
                showClear filter
              />
            )}
            {editNode.type === 'cc' && (
              <Form.Select
                field="assigneeIds" label="抄送人（可多选）"
                placeholder="请选择"
                optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
                multiple filter
              />
            )}
          </Form>
        )}
      </Drawer>

      {/* Branch edit drawer */}
      <Drawer
        title={`编辑分支：${editBranch?.label ?? ''}`}
        visible={!!editBranch}
        onClose={() => setEditBranch(null)}
        width={400}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setEditBranch(null)}>取消</Button>
            <Button type="primary" onClick={() => {
              branchFormApi.current?.validate().then((values: Record<string, unknown>) => {
                if (!editBranch) return;
                setTree(prev => updateBranchInTree(prev, editBranch.id, {
                  label: values.label as string,
                  description: values.description as string | undefined,
                }) ?? prev);
                setEditBranch(null);
              }).catch(() => undefined);
            }}>保存</Button>
          </div>
        }
      >
        {editBranch && (
          <Form
            key={editBranch.id}
            getFormApi={api => { branchFormApi.current = api; }}
            initValues={{ label: editBranch.label, description: editBranch.description ?? '' }}
          >
            <Form.Input field="label" label="分支名称" rules={[{ required: true, message: '请输入分支名称' }]} />
            <Form.TextArea field="description" label="分支描述" placeholder="请输入描述条件（选填）" />
          </Form>
        )}
      </Drawer>
    </div>
  );
}

export default function WorkflowDesignerPage() {
  return (
    <ReactFlowProvider>
      <WorkflowDesignerInner />
    </ReactFlowProvider>
  );
}
