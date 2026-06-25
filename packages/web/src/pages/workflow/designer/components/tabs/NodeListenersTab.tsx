/**
 * 节点级事件监听器配置 Tab
 * 节点上配置 webhook 监听器，在 task.created / task.approved / task.rejected 时触发
 */
import { useState } from 'react';
import { Typography, Button, Select, Checkbox, Input, TextArea, Space, Popconfirm, Toast } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { NodeListenerConfig, NodeListenerEvent } from '@zenith/shared';

interface NodeListenersTabProps {
  value: NodeListenerConfig[] | undefined;
  onChange: (next: NodeListenerConfig[]) => void;
}

const EVENT_OPTIONS: Array<{ label: string; value: NodeListenerEvent }> = [
  { label: '任务创建（onCreate）', value: 'onCreate' },
  { label: '任务通过（onApprove）', value: 'onApprove' },
  { label: '任务驳回（onReject）', value: 'onReject' },
];

const METHOD_OPTIONS = [
  { label: 'POST', value: 'POST' },
  { label: 'GET', value: 'GET' },
];

function parseHeaders(raw: string): Record<string, string> | null {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, vv] of Object.entries(v)) {
      if (typeof vv !== 'string') return null;
      out[k] = vv;
    }
    return out;
  } catch {
    return null;
  }
}

export default function NodeListenersTab({ value, onChange }: Readonly<NodeListenersTabProps>) {
  const list = value ?? [];
  const [headersText, setHeadersText] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    list.forEach((l, i) => { init[i] = l.headers ? JSON.stringify(l.headers, null, 2) : ''; });
    return init;
  });

  const update = (idx: number, patch: Partial<NodeListenerConfig>) => {
    const next = list.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    onChange(next);
  };

  const addItem = () => {
    onChange([...list, { type: 'webhook', url: '', method: 'POST', events: ['onCreate'] }]);
  };

  const removeItem = (idx: number) => {
    onChange(list.filter((_, i) => i !== idx));
    setHeadersText((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < idx) next[ki] = v;
        else if (ki > idx) next[ki - 1] = v;
      });
      return next;
    });
  };

  return (
    <div style={{ padding: 4 }}>
      <Typography.Paragraph type="tertiary" style={{ marginBottom: 12 }}>
        节点监听器在指定事件触发时向配置的 URL 发送 HTTP 请求；与流程定义级的事件订阅独立，不持久化、不重试。
      </Typography.Paragraph>

      <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
        {list.map((l, idx) => (
          <div
            key={`listener-${idx}`}
            style={{
              border: '1px solid var(--semi-color-border)',
              borderRadius: 6,
              padding: 12,
              width: '100%',
              background: 'var(--semi-color-fill-0)',
            }}
          >
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
              <Typography.Text strong>监听器 #{idx + 1}</Typography.Text>
              <Popconfirm title="确定删除该监听器？" onConfirm={() => removeItem(idx)}>
                <Button icon={<Trash2 size={14} />} theme="borderless" type="danger" size="small">删除</Button>
              </Popconfirm>
            </Space>

            <div style={{ marginBottom: 8 }}>
              <Typography.Text size="small">URL</Typography.Text>
              <Input
                value={l.url}
                placeholder="https://example.com/webhook"
                onChange={(v) => update(idx, { url: v })}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <Typography.Text size="small">请求方法</Typography.Text>
              <Select
                value={l.method ?? 'POST'}
                optionList={METHOD_OPTIONS}
                style={{ width: 120 }}
                onChange={(v) => update(idx, { method: v as 'GET' | 'POST' })}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <Typography.Text size="small">触发事件</Typography.Text>
              <Checkbox.Group
                value={l.events}
                onChange={(v) => update(idx, { events: v as NodeListenerEvent[] })}
                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                {EVENT_OPTIONS.map((opt) => (
                  <Checkbox key={opt.value} value={opt.value}>{opt.label}</Checkbox>
                ))}
              </Checkbox.Group>
            </div>

            <div>
              <Typography.Text size="small">自定义请求头（JSON，可选）</Typography.Text>
              <TextArea
                value={headersText[idx] ?? ''}
                placeholder='{"X-Custom": "value"}'
                autosize={{ minRows: 2, maxRows: 6 }}
                onChange={(v) => setHeadersText((prev) => ({ ...prev, [idx]: v }))}
                onBlur={() => {
                  const parsed = parseHeaders(headersText[idx] ?? '');
                  if (parsed === null) {
                    Toast.error('请求头必须是字符串键值的 JSON 对象');
                    return;
                  }
                  update(idx, { headers: Object.keys(parsed).length > 0 ? parsed : undefined });
                }}
              />
            </div>
          </div>
        ))}

        <Button icon={<Plus size={14} />} onClick={addItem}>添加监听器</Button>
      </Space>
    </div>
  );
}
