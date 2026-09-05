import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Tag, Space, Tabs, TabPane, Toast, Empty, Badge, List, Typography,
} from '@douyinfe/semi-ui';
import { usePagination } from '@/hooks/usePagination';
import { IllustrationIdle, IllustrationIdleDark } from '@douyinfe/semi-illustrations';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck } from 'lucide-react';
import { formatDateTime } from '@/utils/date';
import { RefreshButton } from '@/components/toolbar-controls';
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ListPagination } from '@/components/ListPagination';
import {
  announcementKeys,
  type MyAnnouncement,
  useMarkAllMyAnnouncementsRead,
  useMarkMyAnnouncementRead,
  useMyAnnouncementDetail,
  useMyAnnouncementList,
  useMyAnnouncementUnreadCount,
} from '@/hooks/queries/announcements';

import { useUrlTabState } from '@/hooks/useUrlTabState';
type AnnouncementWithRead = MyAnnouncement;
type AnnouncementTab = 'all' | 'unread' | 'read';

const TYPE_LABEL: Record<string, string> = {
  notice: '通知',
  announcement: '公告',
  alert: '警告',
};

const PRIORITY_COLOR: Record<string, TagColor> = {
  low: 'cyan',
  medium: 'orange',
  high: 'red',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: '普通',
  medium: '重要',
  high: '紧急',
};

export default function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [activeTab, setActiveTab] = useUrlTabState(['all', 'unread', 'read'] as const, 'all');

  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<AnnouncementWithRead | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  let isRead: string | undefined;
  if (activeTab === 'unread') isRead = 'false';
  else if (activeTab === 'read') isRead = 'true';

  const listQuery = useMyAnnouncementList({ page, pageSize, isRead });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useMyAnnouncementDetail(selected?.id, modalVisible);
  const selectedAnnouncement = selected ? (detailQuery.data ? { ...detailQuery.data, isRead: true } : selected) : null;
  const markReadMutation = useMarkMyAnnouncementRead();
  const markAllReadMutation = useMarkAllMyAnnouncementsRead();
  const loading = listQuery.isFetching;
  const detailLoading = detailQuery.isFetching;
  const markAllLoading = markAllReadMutation.isPending;

  useEffect(() => {
    const handler = () => {
      // WS 公告事件影响列表、未读数与铃铛气泡，整个 my 前缀一起失效
      void queryClient.invalidateQueries({ queryKey: announcementKeys.my });
    };
    globalThis.addEventListener('announcement:refresh', handler);
    return () => globalThis.removeEventListener('announcement:refresh', handler);
  }, [queryClient]);

  const openNotice = async (item: AnnouncementWithRead, index: number) => {
    if (!item.isRead) {
      await markReadMutation.mutateAsync({ params: { id: item.id } });
    }

    setSelectedIndex(index);
    setModalVisible(true);
    setSelected({ ...item, isRead: true });
  };

  const handlePrev = () => {
    if (selectedIndex > 0) void openNotice(list[selectedIndex - 1], selectedIndex - 1);
  };

  const handleNext = () => {
    if (selectedIndex < list.length - 1) void openNotice(list[selectedIndex + 1], selectedIndex + 1);
  };

  const handleMarkAllRead = async () => {
    await markAllReadMutation.mutateAsync({});
    Toast.success('已全部标记为已读');
    setPage(1);
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key as AnnouncementTab);
    setPage(1);
  };

  const unreadCount = useMyAnnouncementUnreadCount().data ?? 0;

  const renderMarkAllReadButton = (tab: AnnouncementTab) => {
    if (tab === 'read') return null;

    return (
      <Button
        type="primary"
        icon={<CheckCheck size={14} />}
        loading={markAllLoading}
        onClick={handleMarkAllRead}
      >
        全部标记为已读
      </Button>
    );
  };

  const renderAnnouncementsContent = (tab: AnnouncementTab) => {
    const markAllReadButton = renderMarkAllReadButton(tab);
    const pagination = buildPagination(total);

    return (
      <>
        <SearchToolbar>
          {markAllReadButton}
          <RefreshButton onClick={() => void listQuery.refetch()} loading={loading} />
        </SearchToolbar>

        {list.length === 0 && !loading ? (
          <Empty
            image={<IllustrationIdle style={{ width: 120, height: 120 }} />}
            darkModeImage={<IllustrationIdleDark style={{ width: 120, height: 120 }} />}
            description={(() => {
              if (tab === 'unread') return '暂无未读公告';
              if (tab === 'read') return '暂无已读公告';
              return '暂无公告';
            })()}
            style={{ padding: '48px 0' }}
          />
        ) : (
          <>
            <List
              size="small"
              loading={loading}
              dataSource={list}
              renderItem={(item: AnnouncementWithRead, index: number) => {
                const preview = item.content.replace(/<[^>]*>/g, '');
                return (
                  <List.Item
                    key={item.id}
                    style={{ cursor: 'pointer', opacity: item.isRead ? 0.7 : 1 }}
                    onClick={() => void openNotice(item, index)}
                  >
                    <div style={{ width: '100%', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        {!item.isRead && <Badge dot style={{ flexShrink: 0 }} />}
                        <Typography.Text strong={!item.isRead} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.title}
                        </Typography.Text>
                        <Tag size="small" style={{ flexShrink: 0 }}>{TYPE_LABEL[item.type] ?? item.type}</Tag>
                        <Tag color={PRIORITY_COLOR[item.priority] ?? 'blue'} size="small" style={{ flexShrink: 0 }}>
                          {PRIORITY_LABEL[item.priority] ?? item.priority}
                        </Tag>
                        <Typography.Text style={{ fontSize: 12, color: 'var(--semi-color-text-3)', marginLeft: 'auto', flexShrink: 0 }}>
                          发布于 {formatDateTime(item.publishTime ?? item.createdAt)}
                        </Typography.Text>
                      </div>
                      {preview && (
                        <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {preview}
                        </div>
                      )}
                    </div>
                  </List.Item>
                );
              }}
            />
            <ListPagination pagination={pagination} />
          </>
        )}
      </>
    );
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={handleTabChange} type="line" lazyRender keepDOM={false}>
        <TabPane tab="全部公告" itemKey="all">
          {renderAnnouncementsContent('all')}
        </TabPane>
        <TabPane
          tab={
            <Space spacing={4}>
              <span>未读公告</span>
              {unreadCount > 0 && (
                <Tag color="red" size="small">{unreadCount}</Tag>
              )}
            </Space>
          }
          itemKey="unread"
        >
          {renderAnnouncementsContent('unread')}
        </TabPane>
        <TabPane tab="已读公告" itemKey="read">
          {renderAnnouncementsContent('read')}
        </TabPane>
      </Tabs>

      <AnnouncementDetailModal
        visible={modalVisible}
        announcement={selectedAnnouncement}
        loading={detailLoading}
        onClose={() => setModalVisible(false)}
        onPrev={handlePrev}
        onNext={handleNext}
        hasPrev={selectedIndex > 0}
        hasNext={selectedIndex < list.length - 1}
        indexLabel={selectedAnnouncement ? `${selectedIndex + 1} / ${list.length}` : undefined}
      />
    </div>
  );
}
