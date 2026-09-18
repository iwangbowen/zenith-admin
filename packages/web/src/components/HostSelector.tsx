import { useEffect } from 'react';
import { Select, Space, Tag } from '@douyinfe/semi-ui';
import { Monitor, Server } from 'lucide-react';
import { useOpsHosts } from '@/hooks/queries/ops-hosts';
import { usePermission } from '@/hooks/usePermission';

interface HostSelectorProps {
  /** null = 当前服务端本机 */
  readonly value: number | null;
  readonly onChange: (hostId: number | null) => void;
  readonly disabled?: boolean;
  readonly size?: 'small' | 'default' | 'large';
  readonly style?: React.CSSProperties;
}

/**
 * 运维页面通用主机选择器。
 *
 * 本机始终可选；远端仅展示已启用主机，离线主机仍保留在下拉中供排障。
 * query key / API 参数由调用页按 hostId 维度接入。
 */
export function HostSelector({ value, onChange, disabled, size, style }: HostSelectorProps) {
  const { hasPermission } = usePermission();
  const canUseRemote = hasPermission('system:host:use');
  const hostsQuery = useOpsHosts(canUseRemote);
  const hosts = (hostsQuery.data ?? []).filter((host) => host.enabled);
  useEffect(() => {
    if (!canUseRemote && value != null) {
      onChange(null);
      return;
    }
    if (value == null || !hostsQuery.data) return;
    if (!hostsQuery.data.some((host) => host.enabled && host.id === value)) onChange(null);
  }, [canUseRemote, hostsQuery.data, onChange, value]);

  if (!canUseRemote) return null;

  return (
    <Select
      size={size}
      value={value == null ? 'local' : String(value)}
      onChange={(next) => onChange(next === 'local' ? null : Number(next))}
      loading={hostsQuery.isFetching}
      disabled={disabled}
      style={{ width: 220, ...style }}
      aria-label="选择运维主机"
    >
      <Select.Option value="local">
        <Space spacing={6}><Monitor size={14} />本机</Space>
      </Select.Option>
      {hosts.map((host) => (
        <Select.Option key={host.id} value={String(host.id)}>
          <Space spacing={6}>
            <Server size={14} />
            <span>{host.name}</span>
            <Tag size="small" color={host.status === 'online' ? 'green' : host.status === 'offline' ? 'red' : 'grey'}>
              {host.status === 'online' ? '在线' : host.status === 'offline' ? '离线' : '未探测'}
            </Tag>
          </Space>
        </Select.Option>
      ))}
    </Select>
  );
}
