import { useState, useCallback, useEffect } from 'react';
import { Button, Input, Modal, Tag, Toast, Popconfirm, Dropdown, SplitButtonGroup, Typography, Space } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Trash2, ChevronDown, Copy, Terminal } from 'lucide-react';
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
  commandCount: number;
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

/** 从录屏事件中还原用户执行的命令列表（按行切割 'i' 输入事件，处理退格和 ANSI 转义序列）。 */
function extractCommands(events: RecordingEvent[]): Array<{ time: number; cmd: string }> {
  const commands: Array<{ time: number; cmd: string }> = [];
  let buf = '';
  let cmdStart = 0;
  // 简单 VT100 转义序列状态机：normal → esc → csi|ss3
  let escState: 'normal' | 'esc' | 'csi' | 'ss3' = 'normal';

  for (const [time, type, data] of events) {
    if (type !== 'i') continue;
    for (const ch of data) {
      const cp = ch.codePointAt(0) ?? 0;

      if (escState === 'esc') {
        if (ch === '[') { escState = 'csi'; }
        else if (ch === 'O') { escState = 'ss3'; }
        else { escState = 'normal'; }
        continue;
      }
      if (escState === 'csi') {
        // CSI 序列以 0x40–0x7E 的字母结束
        if (cp >= 0x40 && cp <= 0x7e) escState = 'normal';
        continue;
      }
      if (escState === 'ss3') {
        // SS3 序列 = ESC O + 单字节，忽略后立即回到 normal
        escState = 'normal';
        continue;
      }

      // normal 状态
      if (cp === 0x1b) {
        escState = 'esc';
      } else if (ch === '\r' || ch === '\n') {
        const cmd = buf.trim();
        if (cmd) commands.push({ time: cmdStart, cmd });
        buf = '';
        cmdStart = time;
      } else if (ch === '\x7f' || ch === '\b') {
        buf = buf.slice(0, -1);
      } else if (cp >= 0x20 || ch === '\t') {
        if (!buf) cmdStart = time;
        buf += ch;
      }
    }
  }
  const remaining = buf.trim();
  if (remaining) commands.push({ time: cmdStart, cmd: remaining });
  return commands;
}

function formatTimestamp(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TerminalRecordingsPage() {
  const [list, setList] = useState<Recording[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [playRec, setPlayRec] = useState<RecordingDetail | null>(null);
  const [playLoading, setPlayLoading] = useState(false);
  const [detailRec, setDetailRec] = useState<RecordingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

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

  const handleDetail = async (id: number) => {
    setDetailLoading(true);
    const res = await request.get<RecordingDetail>(`/api/terminal-recordings/${id}`);
    setDetailLoading(false);
    if (res.code === 0 && res.data) setDetailRec(res.data);
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/terminal-recordings/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchList(page, pageSize, searchKeyword);
    }
  };

  const clearLabels: Record<number, string> = { 0: '全部', 1: '一个月', 3: '三个月', 6: '六个月', 12: '一年' };

  const handleClear = (months: number) => {
    const label = months === 0 ? '全部录屏' : `${clearLabels[months]}前的录屏`;
    Modal.confirm({
      title: `确认清除${label}？`,
      content: `此操作将永久删除${label}，不可恢复。`,
      okType: 'danger',
      okText: '确认清除',
      cancelText: '取消',
      onOk: async () => {
        setClearLoading(true);
        const params = new URLSearchParams({ months: String(months) });
        const res = await request.delete(`/api/terminal-recordings/clean?${params.toString()}`);
        setClearLoading(false);
        if (res.code === 0) {
          Toast.success(res.message ?? '清除成功');
          resetPage();
          void fetchList(1, pageSize, searchKeyword);
        }
      },
    });
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
      title: '命令数',
      dataIndex: 'commandCount',
      width: 80,
      render: (v: number) => (v > 0 ? <Tag color="green" size="small">{v}</Tag> : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>),
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
      width: 200,
      fixed: 'right' as const,
      render: (_: unknown, r: Recording) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button size="small" theme="borderless" loading={playLoading} onClick={() => void handlePlay(r.id)}>
            播放
          </Button>
          <Button size="small" theme="borderless" loading={detailLoading} onClick={() => void handleDetail(r.id)}>
            详情
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
      <SearchToolbar
        primary={(
          <>
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
          </>
        )}
        actions={(
          <SplitButtonGroup>
            <Button
              type="danger"
              theme="light"
              icon={<Trash2 size={14} />}
              loading={clearLoading}
              onClick={() => handleClear(12)}
            >
              清除录屏
            </Button>
            <Dropdown
              trigger="click"
              position="bottomRight"
              clickToHide
              render={(
                <Dropdown.Menu>
                  {([12, 6, 3, 1] as const).map((m) => (
                    <Dropdown.Item key={m} onClick={() => handleClear(m)}>
                      清除{clearLabels[m]}前的录屏
                    </Dropdown.Item>
                  ))}
                  <Dropdown.Divider />
                  <Dropdown.Item type="danger" onClick={() => handleClear(0)}>清除全部录屏</Dropdown.Item>
                </Dropdown.Menu>
              )}
            >
              <Button type="danger" theme="light" icon={<ChevronDown size={14} />} />
            </Dropdown>
          </SplitButtonGroup>
        )}
        mobilePrimary={(
          <>
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
          </>
        )}
        mobileActions={(
          <>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {([12, 6, 3, 1] as const).map((m) => (
              <Button
                key={m}
                type="danger"
                theme="light"
                icon={<Trash2 size={14} />}
                loading={clearLoading}
                onClick={() => handleClear(m)}
              >
                清除{clearLabels[m]}前的录屏
              </Button>
            ))}
            <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={clearLoading} onClick={() => handleClear(0)}>
              清除全部录屏
            </Button>
          </>
        )}
        actionTitle="录屏操作"
      />

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

      {/* 命令详情弹窗 */}
      {detailRec && (() => {
        const cmds = extractCommands(detailRec.events);
        const copyAll = () => {
          void navigator.clipboard.writeText(cmds.map((c) => c.cmd).join('\n'));
          Toast.success('已复制全部命令');
        };
        return (
          <Modal
            title={
              <Space>
                <Terminal size={15} />
                <span>{detailRec.title || '命令详情'}</span>
                <Tag color="blue" size="small">{detailRec.username}</Tag>
                <Tag size="small">{formatDuration(detailRec.duration)}</Tag>
              </Space>
            }
            visible
            onCancel={() => setDetailRec(null)}
            footer={null}
            closeOnEsc
            width={700}
            style={{ top: '5vh' }}
            bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '75vh' }}
          >
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text type="tertiary" size="small">
                共 {cmds.length} 条命令
              </Typography.Text>
              {cmds.length > 0 && (
                <Button size="small" theme="borderless" icon={<Copy size={12} />} onClick={copyAll}>
                  复制全部
                </Button>
              )}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
              {cmds.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--semi-color-text-2)' }}>
                  未检测到命令输入
                </div>
              ) : (
                cmds.map((c) => (
                  <div
                    key={`${c.time}-${c.cmd}`}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 12,
                      padding: '5px 16px',
                      borderRadius: 4,
                    }}
                  >
                    <Typography.Text type="tertiary" size="small" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', width: 36 }}>
                      {formatTimestamp(c.time)}
                    </Typography.Text>
                    <Typography.Text
                      copyable={{ content: c.cmd }}
                      style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}
                    >
                      {c.cmd}
                    </Typography.Text>
                  </div>
                ))
              )}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
