import { Typography } from '@douyinfe/semi-ui';

const { Text } = Typography;

interface AiUserCellProps {
  username?: string | null;
  nickname?: string | null;
}

export function AiUserCell({ username, nickname }: AiUserCellProps) {
  return username ? (
    <div>
      <Text style={{ fontSize: 13 }}>{nickname || username}</Text>
      <Text type="tertiary" size="small" style={{ display: 'block' }}>{username}</Text>
    </div>
  ) : '—';
}

interface AiMessageSnippetProps {
  text?: string | null;
  maxWidth?: number;
  empty?: string;
}

export function AiMessageSnippet({ text, maxWidth = 600, empty = '—' }: AiMessageSnippetProps) {
  return text ? (
    <Text ellipsis={{ showTooltip: { opts: { style: { maxWidth } } } }} style={{ fontSize: 13 }}>
      {text}
    </Text>
  ) : empty;
}
