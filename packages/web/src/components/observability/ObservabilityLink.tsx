import { Copy, ExternalLink } from 'lucide-react';
import { Button, Space, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { copyTextWithToast } from '@/utils/clipboard';

const { Text } = Typography;

export default function ObservabilityLink({
  correlationId,
  compact = false,
}: Readonly<{
  correlationId: string;
  compact?: boolean;
}>) {
  const navigate = useNavigate();
  return (
    <Space spacing={compact ? 4 : 8} align="center">
      <Text code ellipsis={{ showTooltip: true }} style={{ maxWidth: compact ? 220 : 360 }}>{correlationId}</Text>
      <Button
        theme="borderless"
        size="small"
        icon={<Copy size={14} />}
        aria-label="复制 correlationId"
        onClick={() => void copyTextWithToast(correlationId, { success: 'correlationId 已复制' })}
      />
      <Button
        theme="borderless"
        size="small"
        icon={<ExternalLink size={14} />}
        aria-label="查看链路日志"
        onClick={() => navigate(`/system/log-files?correlationId=${encodeURIComponent(correlationId)}`)}
      />
    </Space>
  );
}
