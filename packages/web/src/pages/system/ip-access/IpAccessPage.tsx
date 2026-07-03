import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Switch, TextArea, Toast, Spin, Typography,
  Tabs, TabPane, Tag, Input, Select,
} from '@douyinfe/semi-ui';
import { usePagination } from '@/hooks/usePagination';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { IpAccessLog } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { Search, RotateCcw } from 'lucide-react';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '../../../utils/table-columns';
import { ipAccessKeys, useIpAccessConfigs, useIpAccessLogs, useSaveIpAccessSection } from '@/hooks/queries/ip-access';

const { Title, Text } = Typography;

function parseList(raw: string): string {
  try {
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.join('\n') : '';
  } catch {
    return '';
  }
}

function toJsonArray(text: string): string {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return JSON.stringify(lines);
}

// ─── 拦截日志子页面 ─────────────────────────────────────────────

function IpAccessLogsTab() {
  const queryClient = useQueryClient();
  const { page, setPage, pageSize, buildPagination } = usePagination();

  interface SearchParams { filterIp: string; filterBlockType: string | undefined; }
  const defaultSearchParams: SearchParams = { filterIp: '', filterBlockType: undefined };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const logsQuery = useIpAccessLogs({
    page,
    pageSize,
    ip: submittedParams.filterIp || undefined,
    blockType: submittedParams.filterBlockType || undefined,
  });
  const logList = logsQuery.data?.list ?? [];
  const total = logsQuery.data?.total ?? 0;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: ipAccessKeys.logs });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: ipAccessKeys.logs });
  };

  const columns: ColumnProps<IpAccessLog>[] = [
    { title: 'IP 地址', dataIndex: 'ip', width: 160 },
    {
      title: '拦截类型', dataIndex: 'blockType', width: 120,
      render: (v: string) => (
        <Tag color={v === 'blacklist' ? 'red' : 'blue'} size="small">
          {v === 'blacklist' ? '黑名单' : '白名单'}
        </Tag>
      ),
    },
    { title: '请求路径', dataIndex: 'path', render: renderEllipsis },
    { title: '请求方法', dataIndex: 'method', width: 100 },
    { title: 'User-Agent', dataIndex: 'userAgent', render: renderEllipsis },
    {
      title: '拦截时间', dataIndex: 'createdAt', width: 180,
      render: (v: string) => formatDateTime(v),
    },
  ];

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索 IP 地址"
              value={draftParams.filterIp}
              onChange={(v) => { setDraftParams((prev) => ({ ...prev, filterIp: v })); }}
              showClear
              style={{ width: 200 }}
            />
            <Select
              placeholder="拦截类型"
              value={draftParams.filterBlockType}
              onChange={(v) => { setDraftParams((prev) => ({ ...prev, filterBlockType: v as string | undefined })); }}
              showClear
              style={{ width: 140 }}
            >
              <Select.Option value="blacklist">黑名单</Select.Option>
              <Select.Option value="whitelist">白名单</Select.Option>
            </Select>
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索 IP 地址"
              value={draftParams.filterIp}
              onChange={(v) => { setDraftParams((prev) => ({ ...prev, filterIp: v })); }}
              showClear
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          </>
        )}
        mobileFilters={(
          <Select
            placeholder="拦截类型"
            value={draftParams.filterBlockType}
            onChange={(v) => { setDraftParams((prev) => ({ ...prev, filterBlockType: v as string | undefined })); }}
            showClear
            style={{ width: 140 }}
          >
            <Select.Option value="blacklist">黑名单</Select.Option>
            <Select.Option value="whitelist">白名单</Select.Option>
          </Select>
        )}
        filterTitle="IP 访问筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={logList}
        loading={logsQuery.isFetching}
        rowKey="id"
        pagination={buildPagination(total)}
        onRefresh={() => void logsQuery.refetch()}
        refreshLoading={logsQuery.isFetching}
      />
    </>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────

export default function IpAccessPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:ip-access:update');
  const canViewLog = hasPermission('system:ip-access:log');

  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [whitelistText, setWhitelistText] = useState('');
  const [blacklistEnabled, setBlacklistEnabled] = useState(false);
  const [blacklistText, setBlacklistText] = useState('');
  const configsQuery = useIpAccessConfigs();
  const configs = useMemo(() => configsQuery.data ?? {}, [configsQuery.data]);
  const saveMutation = useSaveIpAccessSection();
  const saving = saveMutation.isPending ? (saveMutation.variables?.section ?? null) : null;

  useEffect(() => {
    if (!configsQuery.data) return;
    setWhitelistEnabled(configs.ip_whitelist_enabled?.configValue === 'true');
    setBlacklistEnabled(configs.ip_blacklist_enabled?.configValue === 'true');
    setWhitelistText(parseList(configs.ip_whitelist?.configValue ?? '[]'));
    setBlacklistText(parseList(configs.ip_blacklist?.configValue ?? '[]'));
  }, [configs, configsQuery.data]);

  const saveSection = async (section: 'whitelist' | 'blacklist') => {
    await saveMutation.mutateAsync({
      configs,
      section,
      enabled: section === 'whitelist' ? whitelistEnabled : blacklistEnabled,
      listJson: section === 'whitelist' ? toJsonArray(whitelistText) : toJsonArray(blacklistText),
    });
    Toast.success('保存成功');
  };

  const configContent = configsQuery.isFetching && !configsQuery.data ? (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Spin size="large" />
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 白名单 */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <Title heading={5} style={{ marginBottom: 4 }}>IP 白名单</Title>
            <Text type="tertiary" style={{ fontSize: 13 }}>
              开启后，仅允许列表中的 IP 或 CIDR 地址段访问系统（公开接口除外）。
            </Text>
          </div>
          <Switch
            checked={whitelistEnabled}
            disabled={!canUpdate}
            onChange={(v) => setWhitelistEnabled(v)}
          />
        </div>
        <TextArea
          placeholder={'每行一条，支持单个 IP 或 CIDR，例如：\n192.168.1.1\n10.0.0.0/24'}
          value={whitelistText}
          onChange={(v) => setWhitelistText(v)}
          disabled={!canUpdate}
          maxCount={5000}
          rows={6}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
        {canUpdate && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button type="primary" loading={saving === 'whitelist'} onClick={() => saveSection('whitelist')}>
              保存白名单配置
            </Button>
          </div>
        )}
      </Card>

      {/* 黑名单 */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <Title heading={5} style={{ marginBottom: 4 }}>IP 黑名单</Title>
            <Text type="tertiary" style={{ fontSize: 13 }}>
              开启后，列表中的 IP 或 CIDR 地址段将被禁止访问系统（黑名单优先于白名单）。
            </Text>
          </div>
          <Switch
            checked={blacklistEnabled}
            disabled={!canUpdate}
            onChange={(v) => setBlacklistEnabled(v)}
          />
        </div>
        <TextArea
          placeholder={'每行一条，支持单个 IP 或 CIDR，例如：\n1.2.3.4\n5.6.7.0/24'}
          value={blacklistText}
          onChange={(v) => setBlacklistText(v)}
          disabled={!canUpdate}
          maxCount={5000}
          rows={6}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
        {canUpdate && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button type="primary" loading={saving === 'blacklist'} onClick={() => saveSection('blacklist')}>
              保存黑名单配置
            </Button>
          </div>
        )}
      </Card>
    </div>
  );

  if (!canViewLog) {
    return configContent;
  }

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line">
        <TabPane tab="访问控制配置" itemKey="config">
          {configContent}
        </TabPane>
        <TabPane tab="拦截日志" itemKey="logs">
          <IpAccessLogsTab />
        </TabPane>
      </Tabs>
    </div>
  );
}
