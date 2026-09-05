import { Button, Dropdown, Radio, RadioGroup, Select, Tooltip } from '@douyinfe/semi-ui';
import { AlignJustify, AlignLeft, Library, Settings, Sparkles, Swords, UserRoundPen } from 'lucide-react';
import type { AiConversation, AiPromptTemplate } from '@zenith/shared/ai';

export type DialogueMode = 'bubble' | 'noBubble' | 'userBubble';
export type DialogueAlign = 'leftRight' | 'leftAlign';

/** 挂载选择器只关心这三个字段（来自 aiKnowledgeBaseContract.all） */
interface KnowledgeBaseItem { id: number; name: string; documentCount: number }

interface ChatHeaderActionsProps {
  activeConv: AiConversation | undefined;
  promptTemplates: AiPromptTemplate[];
  onSelectTemplate: (t: AiPromptTemplate) => void;
  onApplyTemplate: (content: string | null) => Promise<void>;
  knowledgeBases: KnowledgeBaseItem[];
  onSetKb: (kbId: number | null) => Promise<void>;
  onOpenArena: () => void;
  onOpenPreference: () => void;
  mode: DialogueMode;
  onModeChange: (mode: DialogueMode) => void;
  align: DialogueAlign;
  onAlignChange: (align: DialogueAlign) => void;
  onOpenSettings: () => void;
}

/** 会话头部右侧工具条：角色模板 / 知识库挂载 / Arena / 个性化 / 气泡模式 / 对齐 / 我的 AI 配置 */
export function ChatHeaderActions({
  activeConv, promptTemplates, onSelectTemplate, onApplyTemplate, knowledgeBases, onSetKb,
  onOpenArena, onOpenPreference, mode, onModeChange, align, onAlignChange, onOpenSettings,
}: Readonly<ChatHeaderActionsProps>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Dropdown
        trigger="click"
        position="bottomLeft"
        clickToHide
        render={
          <Dropdown.Menu>
            {promptTemplates.length === 0 && <Dropdown.Item disabled>暂无可用角色模板</Dropdown.Item>}
            {promptTemplates.map((t) => (
              <Dropdown.Item
                key={t.id}
                active={activeConv?.systemPromptOverride === t.content}
                onClick={() => onSelectTemplate(t)}
              >
                {t.name}
              </Dropdown.Item>
            ))}
            {activeConv?.systemPromptOverride && (
              <>
                <Dropdown.Divider />
                <Dropdown.Item type="danger" onClick={() => void onApplyTemplate(null)}>清除角色</Dropdown.Item>
              </>
            )}
          </Dropdown.Menu>
        }
      >
        <span style={{ display: 'inline-flex' }}>
          <Tooltip content="选择角色 / 提示词模板（作用于当前对话）">
            <Button
              theme={activeConv?.systemPromptOverride ? 'light' : 'borderless'}
              type="primary"
              size="small"
              icon={<Sparkles size={14} />}
            >
              {activeConv?.systemPromptOverride
                ? (promptTemplates.find((t) => t.content === activeConv.systemPromptOverride)?.name ?? '自定义角色')
                : '角色'}
            </Button>
          </Tooltip>
        </span>
      </Dropdown>
      <Dropdown
        trigger="click"
        position="bottomLeft"
        clickToHide
        render={
          <Dropdown.Menu>
            {knowledgeBases.length === 0 && <Dropdown.Item disabled>暂无知识库，请先到「知识库」页创建</Dropdown.Item>}
            {knowledgeBases.map((kb) => (
              <Dropdown.Item
                key={kb.id}
                active={activeConv?.knowledgeBaseId === kb.id}
                onClick={() => void onSetKb(kb.id)}
              >
                {kb.name}（{kb.documentCount} 篇）
              </Dropdown.Item>
            ))}
            {activeConv?.knowledgeBaseId && (
              <>
                <Dropdown.Divider />
                <Dropdown.Item type="danger" onClick={() => void onSetKb(null)}>取消挂载</Dropdown.Item>
              </>
            )}
          </Dropdown.Menu>
        }
      >
        <span style={{ display: 'inline-flex' }}>
          <Tooltip content="挂载知识库（回答优先引用知识库内容）">
            <Button
              theme={activeConv?.knowledgeBaseId ? 'light' : 'borderless'}
              type="primary"
              size="small"
              icon={<Library size={14} />}
            >
              {activeConv?.knowledgeBaseId
                ? (knowledgeBases.find((kb) => kb.id === activeConv.knowledgeBaseId)?.name ?? '知识库')
                : '知识库'}
            </Button>
          </Tooltip>
        </span>
      </Dropdown>
      <Tooltip content="模型对比（Arena）">
        <Button
          theme="borderless"
          size="small"
          icon={<Swords size={14} />}
          onClick={onOpenArena}
        />
      </Tooltip>
      <Tooltip content="AI 个性化设置（个人指令 / AI 记忆）">
        <Button
          theme="borderless"
          size="small"
          icon={<UserRoundPen size={14} />}
          onClick={onOpenPreference}
        />
      </Tooltip>
      <Select
        value={mode}
        onChange={(v) => onModeChange(v as DialogueMode)}
        size="small"
        placeholder="请选择模式"
        style={{ width: 110 }}
        optionList={[
          { value: 'bubble', label: '双侧气泡' },
          { value: 'noBubble', label: '无气泡' },
          { value: 'userBubble', label: '用户气泡' },
        ]}
      />
      <RadioGroup
        type="button"
        value={align}
        onChange={(e) => onAlignChange(e.target.value as DialogueAlign)}
        buttonSize="small"
      >
        <Radio value="leftRight"><AlignJustify size={12} /></Radio>
        <Radio value="leftAlign"><AlignLeft size={12} /></Radio>
      </RadioGroup>
      <Tooltip content="我的 AI 配置">
        <Button
          theme="borderless"
          size="small"
          icon={<Settings size={14} />}
          onClick={onOpenSettings}
        />
      </Tooltip>
    </div>
  );
}
