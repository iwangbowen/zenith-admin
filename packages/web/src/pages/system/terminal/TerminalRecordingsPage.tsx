import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Tag, Toast, Dropdown, SplitButtonGroup, Typography, Space, DatePicker, Select } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Trash2, ChevronDown, Copy, Terminal, Star } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { useUserOptions } from '@/hooks/useUserOptions';
import { formatDateTimeForApi } from '@/utils/date';
import RecordingPlayer from './RecordingPlayer';
import {
  terminalKeys,
  useCleanTerminalRecordings,
  useDeleteTerminalRecording,
  useTerminalRecordingDetail,
  useTerminalRecordingList,
  type Recording,
  type RecordingDetail,
  type RecordingEvent,
} from '@/hooks/queries/terminal';

interface SearchParams {
  keyword: string;
  operatorUserId: number | null;
  timeRange: [Date, Date] | null;
}

interface CommandItem {
  time: number;
  cmd: string;
}

const defaultSearchParams: SearchParams = { keyword: '', operatorUserId: null, timeRange: null };

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** 从录屏事件中还原用户执行的命令列表（按行切割 'i' 输入事件，处理退格和 ANSI 转义序列）。 */
function extractCommands(events: RecordingEvent[]): CommandItem[] {
  const commands: CommandItem[] = [];
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

function getKeyCommandLabel(cmd: string): string | null {
  const normalized = cmd.trim();
  if (/^(sudo\s+)?rm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\b/.test(normalized)) return '危险删除';
  if (/^(sudo\s+)?(shutdown|reboot|halt|poweroff)\b/.test(normalized)) return '主机控制';
  if (/^(sudo\s+)?(systemctl|service)\s+(stop|restart|reload)\b/.test(normalized)) return '服务变更';
  if (/^(sudo\s+)?(chmod|chown)\b/.test(normalized)) return '权限变更';
  if (/\b(drop|truncate|delete)\b.+\b(table|from)\b/i.test(normalized)) return '数据变更';
  if (/\b(kubectl\s+delete|docker\s+(rm|rmi|system\s+prune))\b/.test(normalized)) return '资源删除';
  return null;
}

export default function TerminalRecordingsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [playRec, setPlayRec] = useState<RecordingDetail | null>(null);
  const [playStartTime, setPlayStartTime] = useState(0);
  const [detailRec, setDetailRec] = useState<RecordingDetail | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const { userOptions, loading: userOptionsLoading, ensureLoaded } = useUserOptions({ immediate: true });

  const { page, pageSize, resetPage, buildPagination } = usePagination();

  const listQuery = useTerminalRecordingList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    operatorUserId: submittedParams.operatorUserId ?? undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const [playId, setPlayId] = useState<number | undefined>();
  const [detailId, setDetailId] = useState<number | undefined>();
  const playQuery = useTerminalRecordingDetail(playId, playId !== undefined);
  const detailQuery = useTerminalRecordingDetail(detailId, detailId !== undefined);
  const deleteMutation = useDeleteTerminalRecording();
  const cleanMutation = useCleanTerminalRecordings();

  useEffect(() => {
    if (playQuery.data) setPlayRec(playQuery.data);
  }, [playQuery.data]);

  useEffect(() => {
    if (detailQuery.data) setDetailRec(detailQuery.data);
  }, [detailQuery.data]);

  const handleSearch = () => {
    resetPage();
    setSubmittedParams(searchParams);
    void queryClient.invalidateQueries({ queryKey: terminalKeys.recordingLists });
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    resetPage();
    void queryClient.invalidateQueries({ queryKey: terminalKeys.recordingLists });
  };

  const handlePlay = (id: number, startTime = 0) => {
    setPlayStartTime(startTime);
    const cached = queryClient.getQueryData<RecordingDetail>(terminalKeys.recordingDetail(id));
    if (cached) setPlayRec(cached);
    setPlayId(id);
  };

  const handleDetail = (id: number) => {
    const cached = queryClient.getQueryData<RecordingDetail>(terminalKeys.recordingDetail(id));
    if (cached) setDetailRec(cached);
    setDetailId(id);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
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
        const message = await cleanMutation.mutateAsync(months);
        Toast.success(message ?? '清除成功');
        resetPage();
      },
    });
  };

  const handleExportAsciinema = async (record: Recording) => {
    setExportingId(record.id);
    try {
      await request.download(
        `/api/terminal-recordings/${record.id}/asciinema`,
        `terminal-recording-${record.id}.cast`,
      );
    } finally {
      setExportingId(null);
    }
  };

  const columns: ColumnProps<Recording>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      width: 360,
      ellipsis: { showTitle: false },
      render: (v: string) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ display: 'block', maxWidth: 340 }}>
          {v || '（无标题）'}
        </Typography.Text>
      ),
    },
    {
      title: 'Shell',
      dataIndex: 'shell',
      width: 220,
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
    createOperationColumn<Recording>({
      width: 260,
      actions: (record) => [
        {
          key: 'play',
          label: '播放',
          loading: playQuery.isFetching,
          onClick: () => { void handlePlay(record.id); },
        },
        {
          key: 'detail',
          label: '详情',
          loading: detailQuery.isFetching,
          onClick: () => { void handleDetail(record.id); },
        },
        {
          key: 'export',
          label: '导出',
          loading: exportingId === record.id,
          onClick: () => { void handleExportAsciinema(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定删除这条录屏吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleDelete(record.id); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索标题"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams({ ...searchParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 220 }}
            />
            <Select
              placeholder="操作人"
              value={searchParams.operatorUserId ?? undefined}
              optionList={userOptions}
              loading={userOptionsLoading}
              filter
              showClear
              onFocus={() => { void ensureLoaded(); }}
              onChange={(v) => setSearchParams({ ...searchParams, operatorUserId: typeof v === 'number' ? v : null })}
              style={{ width: 180 }}
            />
            <DatePicker
              type="dateTimeRange"
              placeholder={['开始时间', '结束时间']}
              value={searchParams.timeRange ?? undefined}
              onChange={(v) => setSearchParams({ ...searchParams, timeRange: v ? (v as [Date, Date]) : null })}
              style={{ width: 360 }}
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
              loading={cleanMutation.isPending}
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
              value={searchParams.keyword}
              onChange={(v) => setSearchParams({ ...searchParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 220 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          </>
        )}
        mobileActions={(
          <>
            <Select
              placeholder="操作人"
              value={searchParams.operatorUserId ?? undefined}
              optionList={userOptions}
              loading={userOptionsLoading}
              filter
              showClear
              onFocus={() => { void ensureLoaded(); }}
              onChange={(v) => setSearchParams({ ...searchParams, operatorUserId: typeof v === 'number' ? v : null })}
              style={{ width: 220 }}
            />
            <DatePicker
              type="dateTimeRange"
              placeholder={['开始时间', '结束时间']}
              value={searchParams.timeRange ?? undefined}
              onChange={(v) => setSearchParams({ ...searchParams, timeRange: v ? (v as [Date, Date]) : null })}
              style={{ width: 260 }}
            />
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {([12, 6, 3, 1] as const).map((m) => (
              <Button
                key={m}
                type="danger"
                theme="light"
                icon={<Trash2 size={14} />}
                loading={cleanMutation.isPending}
                onClick={() => handleClear(m)}
              >
                清除{clearLabels[m]}前的录屏
              </Button>
            ))}
            <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={cleanMutation.isPending} onClick={() => handleClear(0)}>
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
        loading={listQuery.isFetching}
        pagination={buildPagination(total)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        empty="暂无录屏记录，使用 Web 终端后会自动保存"
      />

      <Modal
        title={playRec?.title || '播放录屏'}
        visible={!!playRec}
        onCancel={() => { setPlayRec(null); setPlayId(undefined); }}
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
            initialTime={playStartTime}
          />
        )}
      </Modal>

      {/* 命令详情弹窗 */}
      {detailRec && (() => {
        const cmds = extractCommands(detailRec.events);
        const keyCommandCount = cmds.filter((cmd) => getKeyCommandLabel(cmd.cmd)).length;
        const jumpToCommand = (cmd: CommandItem) => {
          const record = detailRec;
          setDetailRec(null);
          setPlayStartTime(cmd.time);
          setPlayRec(record);
        };
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
            onCancel={() => { setDetailRec(null); setDetailId(undefined); }}
            footer={null}
            closeOnEsc
            width={700}
            style={{ top: '5vh' }}
            bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '75vh' }}
          >
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text type="tertiary" size="small">
                共 {cmds.length} 条命令
                {keyCommandCount > 0 ? `，关键命令 ${keyCommandCount} 条` : ''}
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
                cmds.map((c) => {
                  const keyLabel = getKeyCommandLabel(c.cmd);
                  return (
                    <div
                      key={`${c.time}-${c.cmd}`}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 12,
                        padding: '5px 16px',
                        borderRadius: 4,
                        background: keyLabel ? 'var(--semi-color-danger-light-default)' : undefined,
                      }}
                    >
                      <Button
                        size="small"
                        theme="borderless"
                        style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', width: 44, padding: '0 4px' }}
                        onClick={() => jumpToCommand(c)}
                      >
                        {formatTimestamp(c.time)}
                      </Button>
                      {keyLabel && (
                        <Tag color="red" size="small" prefixIcon={<Star size={10} />}>
                          {keyLabel}
                        </Tag>
                      )}
                      <Typography.Text
                        copyable={{ content: c.cmd }}
                        style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', flex: 1 }}
                      >
                        {c.cmd}
                      </Typography.Text>
                    </div>
                  );
                })
              )}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
