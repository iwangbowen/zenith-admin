import { Button, Typography } from '@douyinfe/semi-ui';
import { Sparkles } from 'lucide-react';
import type { AiAgent } from '@zenith/shared/ai';
import { SUGGESTED_QUESTIONS } from '../chat-utils';

const { Title } = Typography;

/** 空会话欢迎页：有智能体时展示其开场白与建议问题，否则展示通用建议问题 */
export function ChatWelcome({ agent, onAsk }: Readonly<{ agent: AiAgent | undefined; onAsk: (text: string) => void }>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, padding: 24, textAlign: 'center' }}>
      {agent ? (
        <>
          <span style={{ fontSize: 44, lineHeight: 1 }}>{agent.avatar}</span>
          <Title heading={4} style={{ margin: 0 }}>{agent.name}</Title>
          <Typography.Text type="tertiary" style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>
            {agent.openingMessage || agent.description || '有什么可以帮您？'}
          </Typography.Text>
          {agent.suggestedQuestions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 560, marginTop: 4 }}>
              {agent.suggestedQuestions.map((q) => (
                <Button key={q} theme="light" type="primary" onClick={() => onAsk(q)}>{q}</Button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Sparkles size={40} color="var(--semi-color-primary)" />
          <Title heading={4} style={{ margin: 0 }}>有什么可以帮您？</Title>
          <Typography.Text type="tertiary">选择下面的问题快速开始，或在下方输入框直接提问</Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 560, marginTop: 4 }}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <Button key={q} theme="light" type="primary" onClick={() => onAsk(q)}>{q}</Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
