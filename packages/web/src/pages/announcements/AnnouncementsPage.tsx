import { useState, useEffect, useCallback } from 'react';
import {
  Button, Tag, Space, Tabs, TabPane, Toast, Empty, Badge,
} from '@douyinfe/semi-ui';
import { usePagination } from '@/hooks/usePagination';
import { IllustrationNoContent, IllustrationNoContentDark } from '@douyinfe/semi-illustrations';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { CheckCheck } from 'lucide-react';
import type { Announcement } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import ConfigurableTable from '@/components/ConfigurableTable';
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal';
import { SearchToolbar } from '@/components/SearchToolbar';

type AnnouncementWithRead = Announcement & { isRead: boolean };
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
  const [list, setList] = useState<AnnouncementWithRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const { page, setPage } = usePagination();
  const [activeTab, setActiveTab] = useState<AnnouncementTab>('all');
  const [markAllLoading, setMarkAllLoading] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<AnnouncementWithRead | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = useCallback(async (p = 1, tab = activeTab) => {
    setLoading(true);
    let isRead: string | undefined;
    if (tab === 'unread') isRead = 'false';
    else if (tab === 'read') isRead = 'true';
    const qs = new URLSearchParams({ page: String(p), pageSize: '10' });
    if (isRead !== undefined) qs.set('isRead', isRead);
    const res = await request.get<{ list: AnnouncementWithRead[]; total: number }>(
      `/api/announcements/inbox?${qs.toString()}`,
    );
    setLoading(false);
    if (res.code === 0 && res.data) {
      setList(res.data.list);
      setTotal(res.data.total);
      setPage(p);
    }
  }, [activeTab]);

  useEffect(() => {
    void fetchList(1, activeTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const handler = () => { void fetchList(page, activeTab); };
    globalThis.addEventListener('announcement:refresh', handler);
    return () => globalThis.removeEventListener('announcement:refresh', handler);
  }, [fetchList, page, activeTab]);

  const openNotice = async (item: AnnouncementWithRead, index: number) => {
    if (!item.isRead) {
      await request.post(`/api/announcements/${item.id}/read`, undefined, { silent: true });
    }

    // 显示弹窗并开始加载
    setSelectedIndex(index);
    setModalVisible(true);
    setDetailLoading(true);

    try {
      // 获取最新的公告详情（包含附件）
      const res = await request.get<Announcement>(`/api/announcements/${item.id}`);
      if (res.code === 0 && res.data) {
        setSelected({ ...res.data, isRead: true });
      } else {
        Toast.error(res.message || '获取公告详情失败');
        setSelected({ ...item, isRead: true }); // 降级使用列表数据
      }
    } catch {
      Toast.error('网络错误，获取公告详情失败');
      setSelected({ ...item, isRead: true }); // 降级使用列表数据
    } finally {
      setDetailLoading(false);
    }
  };

  const handlePrev = () => {
    if (selectedIndex > 0) void openNotice(list[selectedIndex - 1], selectedIndex - 1);
  };

  const handleNext = () => {
    if (selectedIndex < list.length - 1) void openNotice(list[selectedIndex + 1], selectedIndex + 1);
  };

  const handleMarkAllRead = async () => {
    setMarkAllLoading(true);
    const res = await request.post('/api/announcements/read-all', {});
    setMarkAllLoading(false);
    if (res.code === 0) {
      Toast.success('已全部标记为已读');
      void fetchList(1, activeTab);
    }
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
          image={<IllustrationNoContent style={{ width: 120, height: 120 }} />}
          darkModeImage={<IllustrationNoContentDark style={{ width: 120, height: 120 }} />}
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
          onRefresh={() => void fetchList(page)}
          refreshLoading={loading}
          dataSource={list}
          rowKey="id"
          columns={columns}
          pagination={{
            total,
            currentPage: page,
            pageSize: 10,
            showSizeChanger: false,
            onPageChange: (p) => void fetchList(p),
          }}
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
        announcement={selected}
        loading={detailLoading}
        onClose={() => setModalVisible(false)}
        onPrev={handlePrev}
        onNext={handleNext}
        hasPrev={selectedIndex > 0}
        hasNext={selectedIndex < list.length - 1}
        indexLabel={selected ? `${selectedIndex + 1} / ${list.length}` : undefined}
      />
    </div>
  );
}
