import { useCallback, useEffect, useState } from 'react';
import { Button, Table, Modal, Tag, Toast, Typography, Popconfirm, Empty } from '@douyinfe/semi-ui';
import { Play, Trash2, RotateCcw } from 'lucide-react';
import { request } from '@/utils/request';
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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [playRec, setPlayRec] = useState<RecordingDetail | null>(null);
  const [playLoading, setPlayLoading] = useState(false);

  const fetchList = useCallback(async (p = page) => {
    setLoading(true);
    const res = await request.get<{ list: Recording[]; total: number; page: number; pageSize: number }>(
      `/api/terminal-recordings?page=${p}&pageSize=20`,
    );
    setLoading(false);
    if (res.code === 0 && res.data) {
      setList(res.data.list);
      setTotal(res.data.total);
    }
  }, [page]);

  useEffect(() => {
    void fetchList();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlay = async (id: number) => {
    setPlayLoading(true);
    const res = await request.get<RecordingDetail>(`/api/terminal-recordings/${id}`);
    setPlayLoading(false);
    if (res.code === 0 && res.data) {
      setPlayRec(res.data);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/terminal-recordings/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchList();
    }
  };

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}>
          {v || '（无标题）'}
        </Typography.Text>
      ),
    },
    {
      title: 'Shell',
      dataIndex: 'shell',
      width: 120,
      render: (v: string | null) => v ? <Tag color="blue" size="small">{v}</Tag> : <Typography.Text type="tertiary">-</Typography.Text>,
    },
    {
      title: '尺寸',
      width: 100,
      render: (_: unknown, r: Recording) => (
        <Typography.Text type="tertiary" size="small">{r.cols}×{r.rows}</Typography.Text>
      ),
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
      render: (v: string) => <Typography.Text size="small">{v || '-'}</Typography.Text>,
    },
    {
      title: '录制时间',
      dataIndex: 'createdAt',
      width: 200,
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right' as const,
      render: (_: unknown, r: Recording) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size="small"
            theme="borderless"
            icon={<Play size={14} />}
            loading={playLoading}
            onClick={() => void handlePlay(r.id)}
          >
            播放
          </Button>
          <Popconfirm
            title="确定删除这条录屏吗？"
            okType="danger"
            onConfirm={() => void handleDelete(r.id)}
          >
            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '16px 24px', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }} />
        <Button icon={<RotateCcw size={14} />} theme="borderless" size="small" onClick={() => void fetchList()}>
          刷新
        </Button>
      </div>

      {list.length === 0 && !loading ? (
        <Empty
          description="暂无录屏记录，使用 Web 终端后会自动保存"
          style={{ paddingTop: 60 }}
        />
      ) : (
        <Table
          dataSource={list}
          columns={columns}
          loading={loading}
          rowKey="id"
          pagination={{
            total,
            currentPage: page,
            pageSize: 20,
            onChange: (p) => {
              setPage(p);
              void fetchList(p);
            },
          }}
          size="small"
          bordered
        />
      )}

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
