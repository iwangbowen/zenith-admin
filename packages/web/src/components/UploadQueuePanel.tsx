/* eslint-disable react-refresh/only-export-components -- 纯展示面板与行状态辅助同文件（无缓存副作用），与 table-columns 同例 */
import { useState } from 'react';
import { Button, Progress, Tag, Typography } from '@douyinfe/semi-ui';
import { CheckCircle2, ChevronDown, ChevronUp, CircleX, Loader2, X, Zap } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import './UploadQueuePanel.css';

export type UploadQueueStatus =
  | 'pending'
  | 'hashing'
  | 'uploading'
  | 'done'
  | 'success'
  | 'skipped'
  | 'error'
  | 'cancelled';

/** 右下角浮动上传队列的行模型：网盘 / 文件列表 / 文件管理器各自把领域状态映射到它 */
export interface UploadQueueItem {
  readonly id: string;
  readonly name: string;
  readonly size?: number;
  readonly status: UploadQueueStatus;
  readonly percent: number;
  readonly error?: string;
  /** 秒传命中（网盘预检直接落定） */
  readonly instant?: boolean;
}

export interface UploadQueuePanelProps {
  readonly items: readonly UploadQueueItem[];
  /** 缺省按 pending / hashing / uploading 现算 */
  readonly activeCount?: number;
  readonly onCancel?: (id: string) => void;
  /** 清空已完成（进行中的保留）；不传则不渲染清空按钮 */
  readonly onClear?: () => void;
}

const ACTIVE_STATUSES: readonly UploadQueueStatus[] = ['pending', 'hashing', 'uploading'];

export function isUploadQueueActive(status: UploadQueueStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

function statusLabel(item: UploadQueueItem): string {
  switch (item.status) {
    case 'pending': return '等待中';
    case 'hashing': return '计算校验…';
    case 'uploading': return `${Math.round(item.percent)}%`;
    case 'done':
    case 'success': return item.instant ? '秒传' : '完成';
    case 'skipped': return '已跳过';
    case 'cancelled': return '已取消';
    case 'error': return item.error ?? '失败';
  }
}

/**
 * 右下角浮动上传队列：单行展示每个文件，进度 / 状态常驻，支持折叠与清空已完成。
 * 冲突询问、秒传预检等业务逻辑留在各域，面板只做纯展示。
 */
export function UploadQueuePanel({ items, activeCount: activeCountProp, onCancel, onClear }: UploadQueuePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  const activeCount = activeCountProp ?? items.filter((item) => isUploadQueueActive(item.status)).length;

  return (
    <div className="upload-queue" role="region" aria-label="上传队列">
      <div className="upload-queue__header">
        <Typography.Text strong>
          {activeCount > 0 ? `正在上传 ${activeCount} 个文件` : `上传完成（${items.length}）`}
        </Typography.Text>
        <div className="upload-queue__header-actions">
          <Button size="small" theme="borderless" type="tertiary" icon={collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            aria-label={collapsed ? '展开' : '收起'} onClick={() => setCollapsed((v) => !v)} />
          {onClear && (
            <Button size="small" theme="borderless" type="tertiary" icon={<X size={14} />} aria-label="清空已完成"
              onClick={onClear} disabled={activeCount > 0 && items.length === activeCount} />
          )}
        </div>
      </div>
      {!collapsed && (
        <ul className="upload-queue__list">
          {items.map((item) => (
            <li key={item.id} className={`upload-queue__item upload-queue__item--${item.status}`}>
              <div className="upload-queue__item-main">
                <Typography.Text ellipsis={{ showTooltip: true }} className="upload-queue__name">{item.name}</Typography.Text>
                {item.size != null && <span className="upload-queue__meta">{formatBytes(item.size)}</span>}
              </div>
              <div className="upload-queue__item-side">
                {item.status === 'uploading' && <Progress percent={Math.round(item.percent)} size="small" style={{ width: 72 }} aria-label="上传进度" />}
                {(item.status === 'pending' || item.status === 'hashing') && <Loader2 size={14} className="upload-queue__spin" />}
                {(item.status === 'done' || item.status === 'success') && (item.instant
                  ? <Tag color="green" size="small" prefixIcon={<Zap size={12} />}>秒传</Tag>
                  : <CheckCircle2 size={14} color="var(--semi-color-success)" />)}
                {(item.status === 'error' || item.status === 'cancelled' || item.status === 'skipped') && (
                  <Typography.Text type={item.status === 'error' ? 'danger' : 'tertiary'} size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{statusLabel(item)}</Typography.Text>
                )}
                {isUploadQueueActive(item.status) && onCancel && (
                  <Button size="small" theme="borderless" type="tertiary" icon={<CircleX size={14} />} aria-label="取消" onClick={() => onCancel(item.id)} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
