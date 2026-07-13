import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Tag, Space, Tabs, TabPane, Toast, Empty, Badge,
} from '@douyinfe/semi-ui';
import { usePagination } from '@/hooks/usePagination';
import { IllustrationIdle, IllustrationIdleDark } from '@douyinfe/semi-illustrations';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck } from 'lucide-react';
import { formatDateTime } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import {
  announcementKeys,
  type MyAnnouncement,
  useMarkAllMyAnnouncementsRead,
  useMarkMyAnnouncementRead,
  useMyAnnouncementDetail,
  useMyAnnouncementList,
} from '@/hooks/queries/announcements';

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
  const [activeTab, setActiveTab] = useState<AnnouncementTab>('all');

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
      void queryClient.invalidateQueries({ queryKey: announcementKeys.myLists });
    };
    globalThis.addEventListener('announcement:refresh', handler);
    return () => globalThis.removeEventListener('announcement:refresh', handler);
  }, [queryClient]);

  const openNotice = async (item: AnnouncementWithRead, index: number) => {
    if (!item.isRead) {
      await markReadMutation.mutateAsync(item.id);
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
    await markAllReadMutation.mutateAsync();
    Toast.success('已全部标记为已读');
    setPage(1);
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key as AnnouncementTab);
    setPage(1);
  };

  const unreadCount = list.filter((n) => !n.isRead).length;

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, record: AnnouncementWithRead, index: number) => (
        <Button
          theme="borderless"
          size="small"
          style={{ fontWeight: record.isRead ? 400 : 600, padding: 0 }}
          onClick={() => void openNotice(record, index)}
        >
          {!record.isRead && (
            <Badge dot style={{ marginRight: 6, verticalAlign: 'middle' }} />
          )}
          {v}
        </Button>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (v: string) => <Tag size="small">{TYPE_LABEL[v] ?? v}</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v: string) => (
        <Tag color={PRIORITY_COLOR[v] ?? 'blue'} size="small">
          {PRIORITY_LABEL[v] ?? v}
        </Tag>
      ),
    },
    {
      title: '发布时间',
      dataIndex: 'publishTime',
      width: 200,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'isRead',
      width: 80,
      render: (v: boolean) => (
        <Tag color={v ? 'grey' : 'blue'} size="small">
          {v ? '已读' : '未读'}
        </Tag>
      ),
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: AnnouncementWithRead, index: number) => (
        <Button
          theme="borderless"
          size="small"
          onClick={() => void openNotice(record, index)}
        >
          查看
        </Button>
      ),
    },
  ];

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

    return (
      <>
        {markAllReadButton && (
          <SearchToolbar>
            {markAllReadButton}
          </SearchToolbar>
        )}

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
          <ConfigurableTable
            bordered
            loading={loading}
            onRefresh={() => void listQuery.refetch()}
            refreshLoading={loading}
            dataSource={list}
            rowKey="id"
            columns={columns}
            pagination={buildPagination(total)}
            onRow={(record) => ({
              style: { opacity: (record as AnnouncementWithRead).isRead ? 0.7 : 1 },
            })}
          />
        )}
      </>
    );
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={handleTabChange} type="line" lazyRender keepDOM={false}>
        <TabPane tab="全部公告" itemKey="all">
          {renderAnnouncementsContent('all')}
        </TabPane>
        <TabPane
          tab={
            <Space spacing={4}>
              <span>未读公告</span>
              {activeTab === 'all' && unreadCount > 0 && (
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
