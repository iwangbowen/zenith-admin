import React, { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AIChatInput, Button, Input, Tag, Tooltip } from '@douyinfe/semi-ui';
import { ImagePlus, Mic, MicOff, X } from 'lucide-react';
import { REASONING_OPTIONS, type ModelOption } from '../chat-utils';

const { Configure } = AIChatInput;

interface ChatComposerProps {
  generating: boolean;
  modelOptions: ModelOption[];
  /** 当前模型支持图片理解时开放选图 / 粘贴截图 */
  visionEnabled: boolean;
  /** 待发送图片（vision，data URL） */
  pendingImages: string[];
  setPendingImages: Dispatch<SetStateAction<string[]>>;
  recording: boolean;
  sttDraft: string;
  onSttDraftChange: (value: string) => void;
  onToggleRecording: () => void;
  /** 语音草稿条「发送」 */
  onSendText: (text: string) => void;
  onMessageSend: (content: { inputContents?: { type: string; text?: string }[]; text?: string }) => void;
  onStopGenerate: () => void;
  onConfigureChange: (values: Record<string, unknown>) => void;
}

/** 输入区：语音识别草稿条、vision 待发图片条、麦克风 / 选图按钮与带模型配置区的 AIChatInput */
export function ChatComposer({
  generating, modelOptions, visionEnabled, pendingImages, setPendingImages,
  recording, sttDraft, onSttDraftChange, onToggleRecording, onSendText,
  onMessageSend, onStopGenerate, onConfigureChange,
}: Readonly<ChatComposerProps>) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  /** 选择 vision 图片（转 data URL，数量与大小不限） */
  const handlePickImages = (files: FileList | File[] | null) => {
    if (!files) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        setPendingImages((prev) => [...prev, url]);
      };
      reader.readAsDataURL(file);
    }
  };

  /** 粘贴截图：剪贴板中的图片文件直接进入待发图片条（仅 vision 模型） */
  const handleInputPaste = (e: React.ClipboardEvent) => {
    if (!visionEnabled) return;
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault(); // 阻止编辑器插入图片节点/文件名文本
    handlePickImages(files);
  };

  return (
    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--semi-color-border)', background: 'var(--surface-card)', flexShrink: 0 }}>
      {/* STT 语音识别草稿条 */}
      {(recording || sttDraft) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)' }}>
          {recording && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--semi-color-danger)', flexShrink: 0, animation: 'pulse 1.2s infinite' }} />}
          <Input
            value={sttDraft}
            onChange={onSttDraftChange}
            placeholder={recording ? '正在聆听…' : '语音识别结果'}
            style={{ flex: 1 }}
            size="small"
          />
          <Button
            size="small"
            type="primary"
            disabled={!sttDraft.trim() || generating}
            onClick={() => {
              const text = sttDraft.trim();
              onSttDraftChange('');
              if (recording) onToggleRecording();
              onSendText(text);
            }}
          >发送</Button>
          <Button size="small" type="tertiary" onClick={() => { onSttDraftChange(''); if (recording) onToggleRecording(); }}>清除</Button>
        </div>
      )}
      {/* vision 待发送图片缩略图条 */}
      {pendingImages.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {pendingImages.map((url, i) => (
            <div key={`img-${i}`} style={{ position: 'relative', width: 56, height: 56 }}>
              <img src={url} alt={`待发送图片 ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--semi-border-radius-medium)', border: '1px solid var(--semi-color-border)' }} />
              <Button
                theme="solid"
                type="tertiary"
                size="small"
                icon={<X size={10} />}
                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, minWidth: 18, borderRadius: '50%', padding: 0 }}
                onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
              />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }} onPaste={handleInputPaste}>
        <Tooltip content={recording ? '停止语音输入' : '语音输入（识别结果可编辑后发送）'}>
          <Button
            theme="borderless"
            type={recording ? 'danger' : 'tertiary'}
            icon={recording ? <MicOff size={16} /> : <Mic size={16} />}
            style={{ marginBottom: 8 }}
            onClick={onToggleRecording}
          />
        </Tooltip>
        {visionEnabled && (
          <>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handlePickImages(e.target.files); e.target.value = ''; }}
            />
            <Tooltip content="添加图片（当前模型支持图片理解）">
              <Button
                theme="borderless"
                icon={<ImagePlus size={16} />}
                style={{ marginBottom: 8 }}
                onClick={() => imageInputRef.current?.click()}
              />
            </Tooltip>
          </>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <AIChatInput
            placeholder="向 AI 提问，Enter 发送..."
            generating={generating}
            showUploadButton={false}
            onMessageSend={(c) => onMessageSend(c)}
            onStopGenerate={onStopGenerate}
            onConfigureChange={(value) => onConfigureChange(value)}
            // 注意:AIChatInput 内部已渲染 Configure 容器(带值收集 onChange),
            // 此处只能返回 Configure.Select 等子项;再包一层 <Configure> 会形成
            // 内层 Context 拦截取值,外层 onConfigureChange 永不触发
            renderConfigureArea={() => (
              <>
                <Configure.Select
                  key={modelOptions[0]?.value ?? 'default'}
                  field="model"
                  initValue={modelOptions[0]?.value ?? ''}
                  optionList={modelOptions}
                  style={{ minWidth: 160 }}
                  placeholder="选择模型"
                  renderOptionItem={(renderProps: {
                    value: string;
                    label: React.ReactNode;
                    style?: React.CSSProperties;
                    className?: string;
                    onMouseEnter?: React.MouseEventHandler;
                    onClick?: React.MouseEventHandler;
                  }) => {
                    const isUser = String(renderProps.value).startsWith('user-');
                    return (
                      <div
                        role="menuitem"
                        tabIndex={0}
                        style={{ ...renderProps.style, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
                        className={renderProps.className}
                        onMouseEnter={renderProps.onMouseEnter}
                        onClick={renderProps.onClick}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') renderProps.onClick?.(e as unknown as React.MouseEvent); }}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{renderProps.label}</span>
                        <Tag color={isUser ? 'violet' : 'blue'} size="small" style={{ flexShrink: 0 }}>
                          {isUser ? '我的' : '系统'}
                        </Tag>
                      </div>
                    );
                  }}
                />
                <Configure.Select
                  field="reasoning"
                  initValue=""
                  optionList={REASONING_OPTIONS}
                  style={{ minWidth: 128 }}
                  placeholder="推理力度"
                />
              </>
            )}
            style={{ borderRadius: 'var(--semi-border-radius-large)' }}
          />
        </div>
      </div>
    </div>
  );
}
