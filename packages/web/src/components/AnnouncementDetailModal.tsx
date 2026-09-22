import { EntityContextView } from '@/components/entity-relations/EntityRelationButton';
import { usePermission } from '@/hooks/usePermission';
import DOMPurify from 'dompurify';
import { Button, Tag, Space, Typography, Divider, Spin } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { BookOpen, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Announcement, AnnouncementAttachment } from '@zenith/shared/messaging';
import DateTimeText from '@/components/DateTimeText';
import FileAttachment from '@/components/FileAttachment';
import { useDictItems } from '@/hooks/useDictItems';

const { Text } = Typography;

type AnnouncementWithRead = Announcement & { isRead?: boolean; attachments?: AnnouncementAttachment[] };

interface AnnouncementDetailModalProps {
  visible: boolean;
  announcement: AnnouncementWithRead | null;
  onClose: () => void;
  /** 加载状态 */
  loading?: boolean;
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
  loading = false,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  indexLabel,
}: Readonly<AnnouncementDetailModalProps>) {
  const { hasPermission } = usePermission();
  const {
    getLabel: getTypeLabel,
    getColor: getTypeColor,
  } = useDictItems('announcement_type');
  const {
    getLabel: getPriorityLabel,
    getColor: getPriorityColor,
  } = useDictItems('announcement_priority');
  const hasNav = onPrev !== undefined && onNext !== undefined;

  const typeInfo = announcement
    ? {
        label: getTypeLabel(announcement.type),
        color: (getTypeColor(announcement.type) as TagColor | undefined) ?? 'blue',
      }
    : null;
  const priorityInfo = announcement
    ? {
        label: getPriorityLabel(announcement.priority),
        color: (getPriorityColor(announcement.priority) as TagColor | undefined) ?? 'grey',
      }
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
    <AppModal
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
      maskClosable={!loading}
    >
      <Spin spinning={loading} tip="加载中..." size="small">
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
                <DateTimeText value={announcement.publishTime ?? announcement.createdAt} />
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
          {hasPermission('system:announcement:list') && <EntityContextView entityType="messaging.announcement" entityKey={String(announcement.id)} />}
        </div>
        )}
      </Spin>
    </AppModal>
  );
}
