import { useState, useCallback, useEffect } from 'react';
import { Input, Button, Select, Toast, SplitButtonGroup, Dropdown, Modal, Typography, Tag, Card } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Trash2, ChevronDown, AlertCircle, AlertTriangle, Zap, MessageSquare } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { usePageTracker } from '@/hooks/usePageTracker';
import type { FrontendError, PaginatedResponse } from '@zenith/shared';

const { Text } = Typography;

interface ErrorStats {
  totalDistinct: number;
  totalOccurrences: number;
  byType: { errorType: string; count: number; occurrences: number }[];
}

const ERROR_TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  js_error:            { label: 'JS 错误',     color: 'red',    icon: <AlertCircle size={14} /> },
  promise_rejection:   { label: 'Promise 异常', color: 'orange', icon: <AlertTriangle size={14} /> },
  resource_error:      { label: '资源错误',     color: 'yellow', icon: <Zap size={14} /> },
  console_error:       { label: 'Console 错误', color: 'grey',   icon: <MessageSquare size={14} /> },
};

const CLEAR_OPTIONS = [
  { days: 7,   label: '清除 7 天前的数据' },
  { days: 30,  label: '清除 30 天前的数据' },
  { days: 90,  label: '清除 90 天前的数据' },
];

interface SearchParams {
  errorType: string;
  username: string;
  message: string;
}

const defaultSearchParams: SearchParams = { errorType: '', username: '', message: '' };

export default function FrontendErrorsPage() {
  usePageTracker('前端错误监控');

  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [data, setData] = useState<FrontendError[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [detailItem, setDetailItem] = useState<FrontendError | null>(null);

  const fetchData = useCallback(async (p = page, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
        ...(params.errorType ? { errorType: params.errorType } : {}),
        ...(params.username ? { username: params.username } : {}),
        ...(params.message ? { message: params.message } : {}),
      });
      const res = await request.get<PaginatedResponse<FrontendError>>(`/api/frontend-errors?${query}`);
      if (res.code === 0 && res.data) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  const fetchStats = useCallback(async () => {
    const res = await request.get<ErrorStats>('/api/frontend-errors/stats?days=30', { silent: true });
    if (res.code === 0 && res.data) setStats(res.data);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => { void fetchStats(); }, [fetchStats]);

  const handleSearch = () => { setPage(1); void fetchData(1); };
  const handleReset = () => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, defaultSearchParams); };

  const handleClear = (days: number) => {
    Modal.confirm({
      title: days === 0 ? '清除全部错误数据' : `清除 ${days} 天前的错误数据`,
      content: days === 0
        ? '此操作将删除全部前端错误记录，不可恢复！'
        : `此操作将删除 ${days} 天前的前端错误记录，不可恢复！`,
      okText: '确认清除',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        setClearLoading(true);
        try {
          const res = await request.delete(`/api/frontend-errors/clean?days=${days}`);
          if (res.code === 0) {
            Toast.success(res.message || '清除成功');
            setPage(1);
            void fetchData(1);
            void fetchStats();
          }
        } finally {
          setClearLoading(false);
        }
      },
    });
  };

  const columns = [
    {
      title: '类型',
      dataIndex: 'errorType',
      key: 'errorType',
      width: 120,
      render: (v: string) => {
        const cfg = ERROR_TYPE_CONFIG[v] ?? { label: v, color: 'grey', icon: null };
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: `var(--semi-color-${cfg.color})` }}>{cfg.icon}</span>
            <Text size="small">{cfg.label}</Text>
          </div>
        );
      },
    },
    {
      title: '错误信息',
      dataIndex: 'message',
      key: 'message',
      render: (v: string, record: FrontendError) => (
        <button
          type="button"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}
          onClick={() => setDetailItem(record)}
        >
          <Text style={{ fontFamily: 'monospace', fontSize: 13 }}>{v.slice(0, 120)}{v.length > 120 ? '…' : ''}</Text>
          {record.sourceUrl && (
            <div><Text type="tertiary" size="small" style={{ fontFamily: 'monospace' }}>{record.sourceUrl}{record.lineNo ? `:${record.lineNo}` : ''}</Text></div>
          )}
        </button>
      ),
    },
    {
      title: '触发次数',
      dataIndex: 'count',
      key: 'count',
      width: 90,
      render: (v: number) => {
        let color = 'grey';
        if (v >= 10) color = 'red';
        else if (v >= 3) color = 'orange';
        return <Tag color={color} size="small">{v}</Tag>;
      },
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      width: 110,
      render: (v: string | null) => v ? <Text size="small">{v}</Text> : <Text type="tertiary" size="small">–</Text>,
    },
    {
      title: '首次出现',
      dataIndex: 'firstSeenAt',
      key: 'firstSeenAt',
      width: 160,
      render: (v: string) => <Text size="small" type="tertiary">{v}</Text>,
    },
    {
      title: '最近出现',
      dataIndex: 'lastSeenAt',
      key: 'lastSeenAt',
      width: 160,
      render: (v: string) => <Text size="small" type="tertiary">{v}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 70,
      fixed: 'right' as const,
      render: (_: unknown, record: FrontendError) => (
        <Button theme="borderless" size="small" onClick={() => setDetailItem(record)}>详情</Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      {/* Summary cards */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <Card style={{ flex: '0 0 160px' }} bodyStyle={{ padding: '12px 16px' }}>
            <Text type="tertiary" size="small">近 30 天错误种类</Text>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--semi-color-danger)' }}>{stats.totalDistinct.toLocaleString()}</div>
          </Card>
          <Card style={{ flex: '0 0 160px' }} bodyStyle={{ padding: '12px 16px' }}>
            <Text type="tertiary" size="small">总触发次数</Text>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--semi-color-warning)' }}>{stats.totalOccurrences.toLocaleString()}</div>
          </Card>
          {stats.byType.map((t) => {
            const cfg = ERROR_TYPE_CONFIG[t.errorType];
            return (
              <Card key={t.errorType} style={{ flex: '0 0 auto' }} bodyStyle={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: `var(--semi-color-${cfg?.color ?? 'grey'})` }}>{cfg?.icon}</span>
                  <Text type="tertiary" size="small">{cfg?.label ?? t.errorType}</Text>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{t.count}<Text type="tertiary" size="small" style={{ fontWeight: 400, marginLeft: 4 }}>种 / {t.occurrences} 次</Text></div>
              </Card>
            );
          })}
        </div>
      )}

      <SearchToolbar>
        <Select
          placeholder="错误类型"
          value={searchParams.errorType || undefined}
          onChange={(v) => setSearchParams({ ...searchParams, errorType: v as string ?? '' })}
          style={{ width: 140 }}
          showClear
        >
          {Object.entries(ERROR_TYPE_CONFIG).map(([k, { label }]) => (
            <Select.Option key={k} value={k}>{label}</Select.Option>
          ))}
        </Select>
        <Input
          prefix={<Search size={14} />}
          placeholder="用户名"
          value={searchParams.username}
          onChange={(v) => setSearchParams({ ...searchParams, username: v })}
          onEnterPress={handleSearch}
          style={{ width: 130 }}
          showClear
        />
        <Input
          prefix={<Search size={14} />}
          placeholder="错误信息关键词"
          value={searchParams.message}
          onChange={(v) => setSearchParams({ ...searchParams, message: v })}
          onEnterPress={handleSearch}
          style={{ width: 200 }}
          showClear
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <SplitButtonGroup>
          <Button
            type="danger"
            theme="light"
            icon={<Trash2 size={14} />}
            loading={clearLoading}
            onClick={() => handleClear(30)}
          >
            清除数据
          </Button>
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                {CLEAR_OPTIONS.map(({ days, label }) => (
                  <Dropdown.Item key={days} onClick={() => handleClear(days)}>{label}</Dropdown.Item>
                ))}
                <Dropdown.Divider />
                <Dropdown.Item type="danger" onClick={() => handleClear(0)}>清除全部数据</Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <Button type="danger" theme="light" icon={<ChevronDown size={14} />} loading={clearLoading} />
          </Dropdown>
        </SplitButtonGroup>
      </SearchToolbar>

      <ConfigurableTable
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        bordered
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onChange: (p) => { setPage(p); void fetchData(p); },
        }}
      />

      {/* Error detail modal */}
      <Modal
        visible={detailItem !== null}
        title="错误详情"
        onCancel={() => setDetailItem(null)}
        footer={null}
        width={720}
        closeOnEsc
      >
        {detailItem && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Tag color={ERROR_TYPE_CONFIG[detailItem.errorType]?.color ?? 'grey'}>
                {ERROR_TYPE_CONFIG[detailItem.errorType]?.label ?? detailItem.errorType}
              </Tag>
              <Text style={{ marginLeft: 8 }} strong>触发 {detailItem.count} 次</Text>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text type="tertiary" size="small">错误信息</Text>
              <div style={{ background: 'var(--semi-color-fill-0)', padding: '8px 12px', borderRadius: 4, fontFamily: 'monospace', fontSize: 13, marginTop: 4, wordBreak: 'break-all' }}>
                {detailItem.message}
              </div>
            </div>
            {detailItem.stack && (
              <div style={{ marginBottom: 8 }}>
                <Text type="tertiary" size="small">堆栈信息</Text>
                <pre style={{ background: 'var(--semi-color-fill-0)', padding: '8px 12px', borderRadius: 4, fontSize: 12, overflow: 'auto', maxHeight: 280, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {detailItem.stack}
                </pre>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {detailItem.sourceUrl && (
                <div>
                  <Text type="tertiary" size="small">来源文件</Text>
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{detailItem.sourceUrl}{detailItem.lineNo ? `:${detailItem.lineNo}:${detailItem.colNo ?? ''}` : ''}</div>
                </div>
              )}
              {detailItem.pageUrl && (
                <div>
                  <Text type="tertiary" size="small">发生页面</Text>
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{detailItem.pageUrl}</div>
                </div>
              )}
              {detailItem.username && (
                <div><Text type="tertiary" size="small">用户</Text><div>{detailItem.username}</div></div>
              )}
              <div>
                <Text type="tertiary" size="small">首次 / 最近出现</Text>
                <div style={{ fontSize: 12 }}>{detailItem.firstSeenAt} / {detailItem.lastSeenAt}</div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
