import { useState, useCallback } from 'react';
import { Modal, Input, Button, Switch, DatePicker, Toast, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ChatVoteData, ChatVoteOption } from '@zenith/shared';
import { formatDateTimeForApi } from '@/utils/date';

const { Text } = Typography;

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function VotePollModal({
  visible,
  onClose,
  onConfirm,
}: Readonly<{
  visible: boolean;
  onClose: () => void;
  onConfirm: (voteData: ChatVoteData, question: string) => Promise<void>;
}>) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<ChatVoteOption[]>([
    { id: generateId(), label: '' },
    { id: generateId(), label: '' },
  ]);
  const [isMultiple, setIsMultiple] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expireAt, setExpireAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setQuestion('');
    setOptions([{ id: generateId(), label: '' }, { id: generateId(), label: '' }]);
    setIsMultiple(false);
    setIsAnonymous(false);
    setExpireAt(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleAddOption = useCallback(() => {
    if (options.length >= 10) {
      Toast.warning('最多添加 10 个选项');
      return;
    }
    setOptions((prev) => [...prev, { id: generateId(), label: '' }]);
  }, [options.length]);

  const handleRemoveOption = useCallback((id: string) => {
    setOptions((prev) => {
      if (prev.length <= 2) { Toast.warning('至少需要 2 个选项'); return prev; }
      return prev.filter((o) => o.id !== id);
    });
  }, []);

  const handleOptionChange = useCallback((id: string, value: string) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, label: value } : o)));
  }, []);

  const handleConfirm = useCallback(async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) { Toast.error('请输入投票问题'); return; }

    const validOptions = options.filter((o) => o.label.trim());
    if (validOptions.length < 2) { Toast.error('至少需要 2 个有效选项'); return; }

    const voteData: ChatVoteData = {
      question: trimmedQuestion,
      options: validOptions.map((o) => ({ id: o.id, label: o.label.trim() })),
      isMultiple,
      isAnonymous,
      expireAt: expireAt ? formatDateTimeForApi(expireAt) : null,
      votes: [],
      isClosed: false,
    };

    setSubmitting(true);
    try {
      await onConfirm(voteData, trimmedQuestion);
      resetForm();
    } finally {
      setSubmitting(false);
    }
  }, [expireAt, isAnonymous, isMultiple, onConfirm, options, question, resetForm]);

  return (
    <Modal
      title="发起投票"
      visible={visible}
      onCancel={handleClose}
      footer={null}
      width={480}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 问题 */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>投票问题 <span style={{ color: 'var(--semi-color-danger)' }}>*</span></Text>
          <Input
            placeholder="请输入投票问题…"
            value={question}
            onChange={setQuestion}
            maxLength={200}
            showClear
          />
        </div>

        {/* 选项 */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>
            投票选项（{options.length}/10）<span style={{ color: 'var(--semi-color-danger)' }}>*</span>
          </Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.map((opt, idx) => (
              <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text type="tertiary" style={{ fontSize: 12, width: 20, flexShrink: 0 }}>{idx + 1}.</Text>
                <Input
                  placeholder={`选项 ${idx + 1}`}
                  value={opt.label}
                  onChange={(v) => handleOptionChange(opt.id, v)}
                  maxLength={100}
                  style={{ flex: 1 }}
                />
                <Button
                  theme="borderless"
                  type="danger"
                  size="small"
                  icon={<Trash2 size={14} />}
                  onClick={() => handleRemoveOption(opt.id)}
                  disabled={options.length <= 2}
                />
              </div>
            ))}
          </div>
          {options.length < 10 && (
            <Button
              theme="borderless"
              type="primary"
              size="small"
              icon={<Plus size={14} />}
              onClick={handleAddOption}
              style={{ marginTop: 8 }}
            >
              添加选项
            </Button>
          )}
        </div>

        {/* 设置 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text>多选投票</Text>
            <Switch size="small" checked={isMultiple} onChange={setIsMultiple} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text>匿名投票</Text>
            <Switch size="small" checked={isAnonymous} onChange={setIsAnonymous} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text>截止时间（可选）</Text>
            <DatePicker
              type="dateTime"
              placeholder="选择截止时间"
              value={expireAt ?? undefined}
              onChange={(v) => setExpireAt(v ? new Date(v as string) : null)}
              disabledDate={(date) => Boolean(date && date < new Date(Date.now() - 86400000))}
              style={{ width: 200 }}
            />
          </div>
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid var(--semi-color-border)' }}>
          <Button onClick={handleClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={() => { void handleConfirm(); }}>
            发送投票
          </Button>
        </div>
      </div>
    </Modal>
  );
}
