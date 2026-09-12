import { useState, type ReactNode } from 'react';
import { Collapsible, MarkdownRender, Typography } from '@douyinfe/semi-ui';
import { ChevronDown } from 'lucide-react';
import type { DialogueContentItemRendererMap } from '@douyinfe/semi-ui/lib/es/aiChatDialogue/interface';
import type { KbRefDisplay } from './message-adapters';

const { Text } = Typography;

/**
 * AIChatDialogue 内容项自定义渲染器（聊天页与审计/反馈回放共用）。
 * 覆盖 Semi 内置的 function_call 单行原始 JSON 展示：
 * - updateWorkingMemory（Mastra 记忆更新）→ 语义化「已更新 AI 记忆」卡片，画像 markdown 渲染
 * - 其他工具调用 → 折叠卡片 + 格式化参数/结果
 * - kb_references（知识库引用）→ 引用列表块
 */

/** JSON 字符串美化；解析失败时原样返回 */
function tryFormatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** 从 updateWorkingMemory 的 arguments 中提取画像 markdown */
function extractMemoryMarkdown(args: string): string | null {
  try {
    const parsed = JSON.parse(args) as { memory?: unknown };
    return typeof parsed.memory === 'string' ? parsed.memory : null;
  } catch {
    return null;
  }
}

/** 画像 markdown 中的标题在小卡片里降级为小号加粗文本 */
const compactHeading = (props: Record<string, unknown>) => (
  <div style={{ fontSize: 13, fontWeight: 600, margin: '6px 0 4px', color: 'var(--semi-color-text-0)' }}>
    {props.children as ReactNode}
  </div>
);
const MEMORY_MD_COMPONENTS = { h1: compactHeading, h2: compactHeading, h3: compactHeading };

function CollapsibleCard({ icon, title, extra, defaultOpen = false, children }: {
  readonly icon: string;
  readonly title: string;
  readonly extra?: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ margin: '8px 0', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)', fontSize: 12 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span aria-hidden>{icon}</span>
        <span style={{ fontWeight: 600, color: 'var(--semi-color-text-1)' }}>{title}</span>
        {extra}
        <ChevronDown
          size={14}
          style={{ marginLeft: 'auto', color: 'var(--semi-color-text-2)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}
        />
      </div>
      <Collapsible isOpen={open}>
        <div style={{ padding: '0 12px 10px' }}>{children}</div>
      </Collapsible>
    </div>
  );
}

/** 等宽预格式块（工具参数 / 结果） */
function CodeBlock({ label, text }: { readonly label: string; readonly text: string }) {
  if (!text) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <Text type="tertiary" size="small">{label}</Text>
      <pre style={{
        margin: '4px 0 0', padding: '6px 8px', borderRadius: 'var(--semi-border-radius-small)',
        background: 'var(--semi-color-fill-1)', color: 'var(--semi-color-text-1)',
        fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflowY: 'auto',
      }}
      >{text}</pre>
    </div>
  );
}

/** updateWorkingMemory → 「已更新 AI 记忆」语义化卡片 */
function MemoryUpdateCard({ args, onManageMemory }: { readonly args: string; readonly onManageMemory?: () => void }) {
  const memory = extractMemoryMarkdown(args);
  return (
    <CollapsibleCard
      icon="🧠"
      title="已更新 AI 记忆"
      extra={onManageMemory && (
        <Text
          link
          size="small"
          style={{ fontWeight: 'normal' }}
          onClick={(e) => { e.stopPropagation(); onManageMemory(); }}
        >
          管理记忆
        </Text>
      )}
    >
      {memory ? (
        <MarkdownRender raw={memory} format="md" components={MEMORY_MD_COMPONENTS as never} />
      ) : (
        <CodeBlock label="更新内容" text={tryFormatJson(args)} />
      )}
    </CollapsibleCard>
  );
}

/** 通用工具调用 → 折叠卡片 + 格式化参数/结果 */
function ToolCallCard({ name, args, output }: { readonly name: string; readonly args: string; readonly output: string }) {
  return (
    <CollapsibleCard icon="🔧" title={`调用工具 ${name}`}>
      <CodeBlock label="参数" text={tryFormatJson(args)} />
      <CodeBlock label="结果" text={tryFormatJson(output)} />
    </CollapsibleCard>
  );
}

function KbReferencesBlock({ refs }: { readonly refs: KbRefDisplay[] }) {
  if (refs.length === 0) return null;
  return (
    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)', fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--semi-color-text-1)' }}>📚 知识库引用</div>
      {refs.map((r, i) => (
        <div key={`${r.docName}-${i}`} style={{ color: 'var(--semi-color-text-2)', marginTop: 2 }}>
          【{i + 1}】《{r.docName}》（相关度 {r.score}）：{r.content}…
        </div>
      ))}
    </div>
  );
}

export interface ContentRendererOptions {
  /** 「管理记忆」入口回调（打开 AI 个性化设置的记忆 Tab）；只读回放场景不传 */
  onManageMemory?: () => void;
}

/** 构建 AIChatDialogue 的 renderDialogueContentItem 渲染 map */
export function buildContentItemRenderers(options: ContentRendererOptions = {}): DialogueContentItemRendererMap {
  return {
    kb_references: (item: Record<string, unknown>) => (
      <KbReferencesBlock refs={(item.refs as KbRefDisplay[] | undefined) ?? []} />
    ),
    function_call: (item: Record<string, unknown>) => {
      const name = (item.name as string) ?? '';
      const args = (item.arguments as string) ?? '';
      if (name === 'updateWorkingMemory') {
        return <MemoryUpdateCard args={args} onManageMemory={options.onManageMemory} />;
      }
      return <ToolCallCard name={name} args={args} output={(item.output as string) ?? ''} />;
    },
  };
}
