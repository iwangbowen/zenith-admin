import { Copy, ExternalLink } from 'lucide-react';
import { Button, Space, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { copyTextWithToast } from '@/utils/clipboard';

const { Text } = Typography;

export default function ObservabilityLink({
  traceId,
  correlationId,
  compact = false,
}: Readonly<{
  traceId: string;
  correlationId?: string | null;
  compact?: boolean;
}>) {
  const navigate = useNavigate();
  return (
    <Space spacing={compact ? 4 : 8} align="center">
      <Text code ellipsis={{ showTooltip: true }} style={{ maxWidth: compact ? 220 : 360 }}>{traceId}</Text>
      <Button
        theme="borderless"
        size="small"
        icon={<Copy size={14} />}
        aria-label="复制 trace_id"
        onClick={() => void copyTextWithToast(traceId, { success: 'trace_id 已复制' })}
      />
      {correlationId && correlationId !== traceId && <Text type="tertiary" size="small">业务 {correlationId}</Text>}
      <Button
        theme="borderless"
        size="small"
        icon={<ExternalLink size={14} />}
        aria-label="查看链路日志"
        onClick={() => navigate(`/system/log-files?traceId=${encodeURIComponent(traceId)}`)}
      />
    </Space>
  );
}
