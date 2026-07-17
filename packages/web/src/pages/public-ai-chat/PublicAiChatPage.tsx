import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, MarkdownRender, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { Sparkles } from 'lucide-react';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { formatDateTime } from '@/utils/date';

const { Text, Title } = Typography;

interface SharedMessage {
  id: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning: string | null;
  model: string | null;
  createdAt: string;
}

interface SharedConversation {
  title: string;
  sharedAt: string;
  messages: SharedMessage[];
}

/** 对话分享只读页（免登录，/public/ai-chat/:token） */
export default function PublicAiChatPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    request
      .get<SharedConversation>(`/api/ai/public/chat/${token}`, { skipAuth: true, silent: true })
      .then(unwrap)
      .then(setData)
      .catch((err: { message?: string }) => setError(err?.message || '分享不存在或已失效'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Empty title="无法访问" description={error ?? '分享不存在或已失效'} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--semi-color-bg-0)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px 64px' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Sparkles size={28} color="var(--semi-color-primary)" />
          <Title heading={3} style={{ margin: '8px 0 4px' }}>{data.title}</Title>
          <Text type="tertiary" size="small">AI 对话分享（只读） · 分享于 {formatDateTime(data.sharedAt)}</Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '88%',
                    padding: '10px 14px',
                    borderRadius: 'var(--semi-border-radius-large)',
                    background: isUser ? 'var(--semi-color-primary-light-default)' : 'var(--semi-color-bg-2)',
                    border: '1px solid var(--semi-color-border)',
                  }}
                >
                  <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 4 }}>
                    {isUser ? '用户' : 'AI 助手'}
                    {m.model && <Tag size="small" color="blue" style={{ marginLeft: 6 }}>{m.model}</Tag>}
                    <span style={{ marginLeft: 8 }}>{formatDateTime(m.createdAt)}</span>
                  </Text>
                  {m.reasoning && (
                    <details style={{ marginBottom: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                      <summary style={{ cursor: 'pointer' }}>思考过程</summary>
                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.reasoning}</div>
                    </details>
                  )}
                  {isUser ? (
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{m.content}</div>
                  ) : (
                    <MarkdownRender raw={m.content} format="md" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
