import { Copy } from 'lucide-react';
import { Button, Space, Typography } from '@douyinfe/semi-ui';
import { copyTextWithToast } from '@/utils/clipboard';

const { Text } = Typography;

export default function ObservabilityLink({
  correlationId,
  compact = false,
  expand = false,
}: Readonly<{
  correlationId: string;
  compact?: boolean;
  /** 让文本占满所在表格单元格扣除操作按钮后的剩余空间。 */
  expand?: boolean;
}>) {
  return (
    <Space
      spacing={compact ? 4 : 8}
      align="center"
      style={expand ? { width: '100%', minWidth: 0 } : undefined}
    >
      <Text
        code
        ellipsis={{ showTooltip: true }}
        style={expand ? { minWidth: 0, flex: 1 } : { maxWidth: compact ? 220 : 360 }}
      >{correlationId}</Text>
      <Button
        theme="borderless"
        size="small"
        icon={<Copy size={14} />}
        aria-label="复制 correlationId"
        onClick={() => void copyTextWithToast(correlationId, { success: 'correlationId 已复制' })}
      />
    </Space>
  );
}
