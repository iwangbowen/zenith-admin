import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Switch, TextArea, Toast, Spin, Typography } from '@douyinfe/semi-ui';
import type { SystemConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';

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

export default function IpAccessPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:ip-access:update');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'whitelist' | 'blacklist' | null>(null);
  const [configs, setConfigs] = useState<IpConfigMap>({});

  // Form state
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

  const saveSection = async (section: 'whitelist' | 'blacklist') => {
    setSaving(section);
    try {
      if (section === 'whitelist') {
        const enabledId = configs.ip_whitelist_enabled?.id;
        const listId = configs.ip_whitelist?.id;
        if (!enabledId || !listId) { Toast.error('配置项未找到，请刷新后重试'); return; }
        await Promise.all([
          request.put(`/api/system-configs/${enabledId}`, { configValue: String(whitelistEnabled) }),
          request.put(`/api/system-configs/${listId}`, { configValue: toJsonArray(whitelistText) }),
        ]);
      } else {
        const enabledId = configs.ip_blacklist_enabled?.id;
        const listId = configs.ip_blacklist?.id;
        if (!enabledId || !listId) { Toast.error('配置项未找到，请刷新后重试'); return; }
        await Promise.all([
          request.put(`/api/system-configs/${enabledId}`, { configValue: String(blacklistEnabled) }),
          request.put(`/api/system-configs/${listId}`, { configValue: toJsonArray(blacklistText) }),
        ]);
      }
      Toast.success('保存成功');
      fetchConfigs();
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
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
}
