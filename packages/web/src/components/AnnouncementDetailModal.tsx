import DOMPurify from 'dompurify';
import { Button, Tag, Space, Modal, Typography, Divider } from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { BookOpen, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Announcement, AnnouncementAttachment } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import FileAttachment from '@/components/FileAttachment';

const { Text } = Typography;

type AnnouncementWithRead = Announcement & { isRead?: boolean; attachments?: AnnouncementAttachment[] };

const TYPE_MAP: Record<string, { label: string; color: TagColor }> = {
  notice: { label: '通知', color: 'blue' },
  announcement: { label: '公告', color: 'cyan' },
  warning: { label: '预警', color: 'orange' },
};

const PRIORITY_MAP: Record<string, { label: string; color: TagColor }> = {
  high: { label: '紧急', color: 'red' },
  medium: { label: '重要', color: 'orange' },
  low: { label: '普通', color: 'cyan' },
};

interface AnnouncementDetailModalProps {
  visible: boolean;
  announcement: AnnouncementWithRead | null;
  onClose: () => void;
  /** 上一条回调，传入时显示导航按钮 */
  onPrev?: () => void;
  /** 下一条回调，传入时显示导航按钮*/
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** 分页文字，如 "2 / 10" */
  indexLabel?: string;
}

export default function AnnouncementDetailModal({
  visible,
  announcement,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  indexLabel,
}: Readonly<AnnouncementDetailModalProps>) {
  const hasNav = onPrev !== undefined && onNext !== undefined;

  const typeInfo = announcement
    ? (TYPE_MAP[announcement.type] ?? { label: announcement.type, color: 'blue' })
    : null;
  const priorityInfo = announcement
    ? (PRIORITY_MAP[announcement.priority] ?? { label: announcement.priority, color: 'grey' })
    : null;

  const footer = hasNav ? (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Space>
        <Button
          icon={<ChevronLeft size={14} />}
          disabled={!hasPrev}
          onClick={onPrev}
        >上一条</Button>
        <Button
          icon={<ChevronRight size={14} />}
          iconPosition="right"
          disabled={!hasNext}
          onClick={onNext}
        >下一条</Button>
      </Space>
      <Space>
        {indexLabel && <Text type="tertiary" size="small">{indexLabel}</Text>}
        <Button onClick={onClose}>关闭</Button>
      </Space>
    </div>
  ) : (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Button onClick={onClose}>关闭</Button>
    </div>
  );

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      width={640}
      title={
        <Space spacing={8}>
          <BookOpen size={16} strokeWidth={1.5} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />
          <span>{announcement?.title ?? ''}</span>
        </Space>
      }
      footer={footer}
      closeOnEsc
    >
      {announcement && (
        <div>
          {/* 元信息区 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: '1px solid var(--semi-color-border)',
          }}>
            {typeInfo && <Tag size="small" color={typeInfo.color}>{typeInfo.label}</Tag>}
            {priorityInfo && <Tag size="small" color={priorityInfo.color}>{priorityInfo.label}</Tag>}
            <Divider layout="vertical" style={{ height: 12, margin: '0 2px' }} />
            <Space spacing={4}>
              <Clock size={12} strokeWidth={1.5} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
              <Text type="tertiary" size="small">
                {formatDateTime(announcement.publishTime ?? announcement.createdAt)}
              </Text>
            </Space>
            {announcement.isRead !== undefined && (
              <div style={{ marginLeft: 'auto' }}>
                <Tag color={announcement.isRead ? 'grey' : 'blue'} size="small">
                  {announcement.isRead ? '已读' : '未读'}
                </Tag>
              </div>
            )}
          </div>
          {/* 正文区 */}
          <div
            style={{
              lineHeight: 1.9,
              color: 'var(--semi-color-text-0)',
              minHeight: 80,
              fontSize: 14,
              padding: '0 2px',
            }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(announcement.content) }}
          />
          {/* 附件区 */}
          <FileAttachment value={announcement?.attachments} mode="view" showTitle={false} />
        </div>
      )}
    </Modal>
  );
}
