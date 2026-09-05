import { useState } from 'react';
import { Button, TextArea } from '@douyinfe/semi-ui';

interface MessageEditWidgetProps {
  readonly msgId: string;
  readonly defaultText: string;
  readonly onSubmit: (msgId: string, newText: string) => void;
  readonly onCancel: (msgId: string) => void;
}

/** 用户消息就地编辑：Ctrl/⌘ + Enter 或点击「重新发送」以编辑后文本重发（生成新的兄弟分支） */
export function MessageEditWidget({ msgId, defaultText, onSubmit, onCancel }: MessageEditWidgetProps) {
  const [editText, setEditText] = useState(defaultText);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <TextArea
        autosize
        value={editText}
        onChange={setEditText}
        style={{ fontSize: 14 }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            onSubmit(msgId, editText);
          }
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="small" type="tertiary" onClick={() => onCancel(msgId)}>取消</Button>
        <Button
          size="small"
          type="primary"
          disabled={!editText.trim() || editText.trim() === defaultText.trim()}
          onClick={() => onSubmit(msgId, editText)}
        >
          重新发送
        </Button>
      </div>
    </div>
  );
}
