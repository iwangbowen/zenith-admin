import { useRef, useState } from 'react';
import { Button, MarkdownRender, Select, Space, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { Send, Square, Trophy } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import type { AiChatModel } from '@zenith/shared';
import { submitArenaVote } from '@/hooks/queries/ai-extras';

const { Text } = Typography;

interface ArenaModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly models: AiChatModel[];
}

interface PanelState {
  content: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
}

const EMPTY_PANEL: PanelState = { content: '', status: 'idle' };

/** 双模型对比（Arena）：同一提问并行发给两个模型，流式对比 + 投票 */
export default function ArenaModal({ visible, onClose, models }: ArenaModalProps) {
  const [question, setQuestion] = useState('');
  const [modelA, setModelA] = useState<string>('');
  const [modelB, setModelB] = useState<string>('');
  const [panelA, setPanelA] = useState<PanelState>(EMPTY_PANEL);
  const [panelB, setPanelB] = useState<PanelState>(EMPTY_PANEL);
  const [running, setRunning] = useState(false);
  const [voted, setVoted] = useState(false);
  const [lastQuestion, setLastQuestion] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const options = models.map((m) => ({ value: `${m.id}:${m.model}`, label: `${m.name} (${m.model})` }));

  const runOne = async (
    selection: string,
    setPanel: (updater: (prev: PanelState) => PanelState) => void,
    signal: AbortSignal,
  ) => {
    const [configIdStr, ...modelParts] = selection.split(':');
    const token = localStorage.getItem(TOKEN_KEY);
    setPanel(() => ({ content: '', status: 'running' }));
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/ai/arena/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: question, configId: Number(configIdStr), model: modelParts.join(':') || undefined }),
        signal,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(err?.message || `HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      let eventType = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr) as { content?: string; message?: string };
              if (eventType === 'delta' && parsed.content) {
                setPanel((prev) => ({ ...prev, content: prev.content + parsed.content }));
              } else if (eventType === 'error') {
                setPanel((prev) => ({ ...prev, status: 'error', error: parsed.message }));
              } else if (eventType === 'done') {
                setPanel((prev) => ({ ...prev, status: 'done' }));
              }
            } catch { /* ignore */ }
          }
        }
      }
      setPanel((prev) => (prev.status === 'running' ? { ...prev, status: 'done' } : prev));
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setPanel((prev) => ({ ...prev, status: 'error', error: (err as Error)?.message || '请求失败' }));
      }
    }
  };

  const handleRun = async () => {
    if (!question.trim() || !modelA || !modelB) {
      Toast.warning('请填写问题并选择两个模型');
      return;
    }
    if (modelA === modelB) {
      Toast.warning('请选择两个不同的模型');
      return;
    }
    setRunning(true);
    setVoted(false);
    setLastQuestion(question);
    const ac = new AbortController();
    abortRef.current = ac;
    await Promise.all([
      runOne(modelA, setPanelA, ac.signal),
      runOne(modelB, setPanelB, ac.signal),
    ]);
    setRunning(false);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const handleVote = async (winner: 'a' | 'b' | 'tie') => {
    const nameOf = (sel: string) => sel.split(':').slice(1).join(':') || sel;
    await submitArenaVote({ question: lastQuestion, modelA: nameOf(modelA), modelB: nameOf(modelB), winner });
    setVoted(true);
    Toast.success('感谢投票');
  };

  const renderPanel = (label: string, selection: string, panel: PanelState) => (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-large)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--semi-color-border)', background: 'var(--semi-color-fill-0)', fontSize: 13, fontWeight: 600 }}>
        {label}：{selection ? (options.find((o) => o.value === selection)?.label ?? selection) : '未选择'}
        {panel.status === 'running' && <Text type="tertiary" size="small" style={{ marginLeft: 8 }}>生成中…</Text>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, fontSize: 13, minHeight: 220, maxHeight: 340 }}>
        {panel.status === 'error' ? (
          <Text type="danger">{panel.error ?? '生成失败'}</Text>
        ) : panel.content ? (
          <MarkdownRender raw={panel.content} format="md" />
        ) : (
          <Text type="tertiary">回答将显示在这里</Text>
        )}
      </div>
    </div>
  );

  const bothDone = panelA.status === 'done' && panelB.status === 'done';

  return (
    <AppModal
      title="模型对比（Arena）"
      visible={visible}
      onCancel={() => { handleStop(); onClose(); }}
      footer={null}
      width={900}
      closeOnEsc
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Space>
          <Select placeholder="模型 A" value={modelA || undefined} onChange={(v) => setModelA(String(v))} optionList={options} style={{ width: 260 }} filter />
          <Text type="tertiary">VS</Text>
          <Select placeholder="模型 B" value={modelB || undefined} onChange={(v) => setModelB(String(v))} optionList={options} style={{ width: 260 }} filter />
        </Space>
        <div style={{ display: 'flex', gap: 8 }}>
          <TextArea
            value={question}
            onChange={(v) => setQuestion(v)}
            placeholder="输入同一个问题，同时发给两个模型对比效果"
            autosize={{ minRows: 2, maxRows: 4 }}
            style={{ flex: 1 }}
          />
          {running ? (
            <Button icon={<Square size={14} />} type="danger" onClick={handleStop}>停止</Button>
          ) : (
            <Button icon={<Send size={14} />} type="primary" onClick={() => void handleRun()}>开始对比</Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {renderPanel('A', modelA, panelA)}
          {renderPanel('B', modelB, panelB)}
        </div>
        {bothDone && !voted && (
          <Space style={{ justifyContent: 'center', width: '100%' }}>
            <Text type="tertiary" size="small"><Trophy size={13} style={{ verticalAlign: -2, marginRight: 4 }} />哪个回答更好？</Text>
            <Button size="small" onClick={() => void handleVote('a')}>A 更好</Button>
            <Button size="small" onClick={() => void handleVote('b')}>B 更好</Button>
            <Button size="small" type="tertiary" onClick={() => void handleVote('tie')}>不相上下</Button>
          </Space>
        )}
        {voted && <Text type="tertiary" size="small" style={{ textAlign: 'center' }}>已记录投票结果</Text>}
      </div>
    </AppModal>
  );
}
