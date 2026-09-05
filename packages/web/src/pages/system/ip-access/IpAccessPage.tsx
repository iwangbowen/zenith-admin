import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Switch, TextArea, Toast, Spin, Typography, Tabs, TabPane, Tag, Select } from '@douyinfe/semi-ui';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { IP_ACCESS_BLOCK_TYPES, type IpAccessLog } from '@zenith/shared/platform';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { ipAccessKeys, useIpAccessConfigs, useIpAccessLogs, useSaveIpAccessSection } from '@/hooks/queries/ip-access';
import { useListSearch } from '@/hooks/useListSearch';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';

import { useUrlTabState } from '@/hooks/useUrlTabState';
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

  const BLOCK_TYPE_OPTIONS = [{ value: 'blacklist', label: '黑名单' }, { value: 'whitelist', label: '白名单' }];

interface SearchParams { filterIp: string; filterBlockType: string | undefined; }
  const defaultSearchParams: SearchParams = { filterIp: '', filterBlockType: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: ipAccessKeys.logs });
  const logsQuery = useIpAccessLogs({
    page,
    pageSize,
    ip: submittedParams.filterIp || undefined,
    blockType: enumValueOf(IP_ACCESS_BLOCK_TYPES, submittedParams.filterBlockType),
  });
  const logList = logsQuery.data?.list ?? [];
  const total = logsQuery.data?.total ?? 0;

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
    dateTimeColumn('拦截时间', 'createdAt'),
  ];

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <KeywordInput placeholder="搜索 IP 地址" value={draftParams.filterIp} onChange={(v) => { setDraftParams((prev) => ({ ...prev, filterIp: v })); }} width={200} />
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
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索 IP 地址" value={draftParams.filterIp} onChange={(v) => { setDraftParams((prev) => ({ ...prev, filterIp: v })); }} width={200} />
            <SearchButton onClick={handleSearch} />
          </>
        )}
        mobileFilters={(
          <FilterSelect
            placeholder="全部拦截类型"
            items={BLOCK_TYPE_OPTIONS}
            value={draftParams.filterBlockType}
            onChange={(v) => { setDraftParams((prev) => ({ ...prev, filterBlockType: v })); }}
            width={140}
          />
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
  const [activeTab, setActiveTab] = useUrlTabState(['config', 'logs'] as const, 'config');
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
            onChange={setWhitelistEnabled}
          />
        </div>
        <TextArea
          placeholder={'每行一条，支持单个 IP 或 CIDR，例如：\n192.168.1.1\n10.0.0.0/24'}
          value={whitelistText}
          onChange={setWhitelistText}
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
            onChange={setBlacklistEnabled}
          />
        </div>
        <TextArea
          placeholder={'每行一条，支持单个 IP 或 CIDR，例如：\n1.2.3.4\n5.6.7.0/24'}
          value={blacklistText}
          onChange={setBlacklistText}
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
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
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
