import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, Card, Switch, TextArea, Toast, Spin, Typography,
  Tabs, TabPane, Table, Tag, Input, Select,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { IpAccessLog, PaginatedResponse, SystemConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { Search, RotateCcw } from 'lucide-react';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '../../../utils/table-columns';

const { Title, Text } = Typography;

interface IpConfigMap {
  ip_whitelist_enabled?: SystemConfig;
  ip_whitelist?: SystemConfig;
  ip_blacklist_enabled?: SystemConfig;
  ip_blacklist?: SystemConfig;
}

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
  const [tableLoading, setTableLoading] = useState(false);
  const [logList, setLogList] = useState<IpAccessLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [filterIp, setFilterIp] = useState('');
  const [filterBlockType, setFilterBlockType] = useState<string | undefined>(undefined);
  const searchIpRef = useRef('');
  const searchBlockTypeRef = useRef<string | undefined>(undefined);

  const fetchLogs = useCallback(async (p = 1, ip?: string, blockType?: string) => {
    setTableLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (ip) params.set('ip', ip);
      if (blockType) params.set('blockType', blockType);
      const res = await request.get<PaginatedResponse<IpAccessLog>>(`/api/ip-access-logs?${params}`);
      if (res.code === 0) {
        setLogList(res.data.list);
        setTotal(res.data.total);
        setPage(p);
      }
    } finally {
      setTableLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  const handleSearch = () => {
    searchIpRef.current = filterIp;
    searchBlockTypeRef.current = filterBlockType;
    fetchLogs(1, filterIp, filterBlockType);
  };

  const handleReset = () => {
    setFilterIp('');
    setFilterBlockType(undefined);
    searchIpRef.current = '';
    searchBlockTypeRef.current = undefined;
    fetchLogs(1, '', '');
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
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索 IP 地址"
          value={filterIp}
          onChange={(v) => setFilterIp(v)}
          showClear
          style={{ width: 200 }}
        />
        <Select
          placeholder="拦截类型"
          value={filterBlockType}
          onChange={(v) => setFilterBlockType(v as string)}
          showClear
          style={{ width: 140 }}
        >
          <Select.Option value="blacklist">黑名单</Select.Option>
          <Select.Option value="whitelist">白名单</Select.Option>
        </Select>
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>
      <Table
        bordered
        columns={columns}
        dataSource={logList}
        loading={tableLoading}
        rowKey="id"
        pagination={{
          total,
          currentPage: page,
          pageSize,
          showSizeChanger: false,
          onPageChange: (p) => fetchLogs(p, searchIpRef.current, searchBlockTypeRef.current),
        }}
        scroll={{ x: 900 }}
      />
    </>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────

export default function IpAccessPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:ip-access:update');
  const canViewLog = hasPermission('system:ip-access:log');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'whitelist' | 'blacklist' | null>(null);
  const [configs, setConfigs] = useState<IpConfigMap>({});
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [whitelistText, setWhitelistText] = useState('');
  const [blacklistEnabled, setBlacklistEnabled] = useState(false);
  const [blacklistText, setBlacklistText] = useState('');

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<{ list: SystemConfig[] }>('/api/system-configs?keyword=ip_&pageSize=20');
      if (res.code === 0) {
        const map: IpConfigMap = {};
        for (const item of res.data.list) {
          if (item.configKey === 'ip_whitelist_enabled') map.ip_whitelist_enabled = item;
          if (item.configKey === 'ip_whitelist') map.ip_whitelist = item;
          if (item.configKey === 'ip_blacklist_enabled') map.ip_blacklist_enabled = item;
          if (item.configKey === 'ip_blacklist') map.ip_blacklist = item;
        }
        setConfigs(map);
        setWhitelistEnabled(map.ip_whitelist_enabled?.configValue === 'true');
        setBlacklistEnabled(map.ip_blacklist_enabled?.configValue === 'true');
        setWhitelistText(parseList(map.ip_whitelist?.configValue ?? '[]'));
        setBlacklistText(parseList(map.ip_blacklist?.configValue ?? '[]'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const upsertConfig = (
    existing: SystemConfig | undefined,
    configKey: string,
    configType: string,
    configValue: string,
    description: string,
  ) => {
    if (existing?.id) {
      return request.put(`/api/system-configs/${existing.id}`, { configValue });
    }
    return request.post('/api/system-configs', { configKey, configType, configValue, description });
  };

  const saveSection = async (section: 'whitelist' | 'blacklist') => {
    setSaving(section);
    try {
      if (section === 'whitelist') {
        await Promise.all([
          upsertConfig(configs.ip_whitelist_enabled, 'ip_whitelist_enabled', 'boolean', String(whitelistEnabled), '是否开启IP白名单访问控制'),
          upsertConfig(configs.ip_whitelist, 'ip_whitelist', 'json', toJsonArray(whitelistText), 'IP白名单列表（支持CIDR，JSON数组）'),
        ]);
      } else {
        await Promise.all([
          upsertConfig(configs.ip_blacklist_enabled, 'ip_blacklist_enabled', 'boolean', String(blacklistEnabled), '是否开启IP黑名单访问控制'),
          upsertConfig(configs.ip_blacklist, 'ip_blacklist', 'json', toJsonArray(blacklistText), 'IP黑名单列表（支持CIDR，JSON数组）'),
        ]);
      }
      Toast.success('保存成功');
      fetchConfigs();
    } finally {
      setSaving(null);
    }
  };

  const configContent = loading ? (
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
    <div className="page-container">
      <Tabs type="line">
        <TabPane tab="访问控制配置" itemKey="config">
          <div style={{ paddingTop: 16 }}>{configContent}</div>
        </TabPane>
        <TabPane tab="拦截日志" itemKey="logs">
          <div style={{ paddingTop: 16 }}>
            <IpAccessLogsTab />
          </div>
        </TabPane>
      </Tabs>
    </div>
  );
}
