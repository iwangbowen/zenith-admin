import { useState, useCallback, useEffect } from 'react';
import { Button, Input, Modal, Tag, Toast, Popconfirm } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import RecordingPlayer from './RecordingPlayer';

type RecordingEvent = [number, 'o' | 'i', string];

interface Recording {
  id: number;
  title: string;
  username: string;
  shell: string | null;
  cols: number;
  rows: number;
  duration: number;
  createdAt: string;
}

interface RecordingDetail extends Recording {
  events: RecordingEvent[];
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function TerminalRecordingsPage() {
  const [list, setList] = useState<Recording[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [playRec, setPlayRec] = useState<RecordingDetail | null>(null);
  const [playLoading, setPlayLoading] = useState(false);

  const { page, pageSize, resetPage, buildPagination } = usePagination();

  const fetchList = useCallback(async (p: number, ps: number, kw = searchKeyword) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
    if (kw) params.set('keyword', kw);
    const res = await request.get<{ list: Recording[]; total: number; page: number; pageSize: number }>(
      `/api/terminal-recordings?${params.toString()}`,
    );
    setLoading(false);
    if (res.code === 0 && res.data) {
      setList(res.data.list);
      setTotal(res.data.total);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始加载
  useEffect(() => { void fetchList(1, pageSize, ''); }, [fetchList, pageSize]);

  const handleSearch = () => {
    setSearchKeyword(keyword);
    resetPage();
    void fetchList(1, pageSize, keyword);
  };

  const handleReset = () => {
    setKeyword('');
    setSearchKeyword('');
    resetPage();
    void fetchList(1, pageSize, '');
  };

  const handlePlay = async (id: number) => {
    setPlayLoading(true);
    const res = await request.get<RecordingDetail>(`/api/terminal-recordings/${id}`);
    setPlayLoading(false);
    if (res.code === 0 && res.data) setPlayRec(res.data);
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/terminal-recordings/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchList(page, pageSize, searchKeyword);
    }
  };

  const columns: ColumnProps<Recording>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string) => v || '（无标题）',
    },
    {
      title: 'Shell',
      dataIndex: 'shell',
      width: 120,
      render: (v: string | null) => (v ? <Tag color="blue" size="small">{v}</Tag> : '-'),
    },
    {
      title: '尺寸',
      width: 100,
      render: (_: unknown, r: Recording) => `${r.cols}×${r.rows}`,
    },
    {
      title: '时长',
      dataIndex: 'duration',
      width: 90,
      render: (v: number) => formatDuration(v),
    },
    {
      title: '操作人',
      dataIndex: 'username',
      width: 110,
      render: (v: string) => v || '-',
    },
    {
      title: '录制时间',
      dataIndex: 'createdAt',
      width: 200,
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right' as const,
      render: (_: unknown, r: Recording) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button size="small" theme="borderless" loading={playLoading} onClick={() => void handlePlay(r.id)}>
            播放
          </Button>
          <Popconfirm title="确定删除这条录屏吗？" okType="danger" onConfirm={() => void handleDelete(r.id)}>
            <Button size="small" theme="borderless" type="danger">删除</Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索标题"
          value={keyword}
          onChange={setKeyword}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 220 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered
        rowKey="id"
        dataSource={list}
        columns={columns}
        loading={loading}
        pagination={buildPagination(total, fetchList)}
        onRefresh={() => void fetchList(page, pageSize, searchKeyword)}
        refreshLoading={loading}
        empty="暂无录屏记录，使用 Web 终端后会自动保存"
      />

      <Modal
        title={playRec?.title || '播放录屏'}
        visible={!!playRec}
        onCancel={() => setPlayRec(null)}
        footer={null}
        closeOnEsc
        width={900}
        style={{ top: '5vh' }}
        bodyStyle={{ height: '65vh', display: 'flex', flexDirection: 'column' }}
      >
        {playRec && (
          <RecordingPlayer
            cols={playRec.cols}
            rows={playRec.rows}
            duration={playRec.duration}
            events={playRec.events}
          />
        )}
      </Modal>
    </div>
  );
}
