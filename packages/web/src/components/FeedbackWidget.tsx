import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Empty, Feedback, Radio, RadioGroup, Rating, TextArea, Typography } from '@douyinfe/semi-ui';
import { IllustrationSuccess, IllustrationSuccessDark } from '@douyinfe/semi-illustrations';
import { useSubmitFeedback } from '@/hooks/queries/user-feedbacks';
import type { UserFeedbackCategory } from '@zenith/shared';
import { USER_FEEDBACK_CATEGORY_LABELS } from '@zenith/shared';

const CATEGORY_OPTIONS: Array<{ value: UserFeedbackCategory; label: string }> =
  (Object.keys(USER_FEEDBACK_CATEGORY_LABELS) as UserFeedbackCategory[]).map((value) => ({ value, label: USER_FEEDBACK_CATEGORY_LABELS[value] }));

interface FeedbackWidgetProps {
  visible: boolean;
  onClose: () => void;
}

/** 全局意见反馈弹层（入口位于用户头像下拉菜单，由 feedback_entry_enabled 系统配置控制显隐） */
export function FeedbackWidget({ visible, onClose }: FeedbackWidgetProps) {
  const location = useLocation();
  const submitMutation = useSubmitFeedback();
  const [score, setScore] = useState(0);
  const [category, setCategory] = useState<UserFeedbackCategory>('suggestion');
  const [content, setContent] = useState('');
  const [showThanks, setShowThanks] = useState(false);

  const resetForm = useCallback(() => {
    setScore(0);
    setCategory('suggestion');
    setContent('');
  }, []);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleOk = useCallback(async () => {
    try {
      await submitMutation.mutateAsync({
        score: score || null,
        category,
        content: content.trim() || null,
        pagePath: location.pathname,
      });
    } catch {
      return; // 错误 Toast 由 request 层弹出，保持弹层打开
    }
    setShowThanks(true);
    setTimeout(() => {
      onClose();
      setTimeout(() => {
        setShowThanks(false);
        resetForm();
      }, 200);
    }, 1500);
  }, [submitMutation, score, category, content, location.pathname, onClose, resetForm]);

  const canSubmit = score > 0 || content.trim() !== '';

  const renderContent = useCallback(() => {
    if (showThanks) {
      return (
        <Empty
          image={<IllustrationSuccess style={{ width: 120, height: 120 }} />}
          darkModeImage={<IllustrationSuccessDark style={{ width: 120, height: 120 }} />}
          description="感谢您的反馈"
          style={{ padding: 24 }}
        />
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Typography.Text type="secondary">整体满意度</Typography.Text>
          <Rating value={score} onChange={(v) => setScore(v)} allowClear />
        </div>
        <RadioGroup
          type="button"
          buttonSize="small"
          value={category}
          onChange={(e) => setCategory(e.target.value as UserFeedbackCategory)}
        >
          {CATEGORY_OPTIONS.map((o) => (
            <Radio key={o.value} value={o.value}>{o.label}</Radio>
          ))}
        </RadioGroup>
        <TextArea
          value={content}
          onChange={(v) => setContent(v)}
          placeholder="请描述您的建议或遇到的问题（选填）"
          maxCount={1000}
          rows={4}
        />
      </div>
    );
  }, [showThanks, score, category, content]);

  return (
    <Feedback
      type="custom"
      visible={visible}
      onOk={() => void handleOk()}
      onCancel={handleCancel}
      renderContent={renderContent}
      {...(showThanks
        ? { title: ' ', footer: null }
        : {
            title: '您对系统的使用体验如何？',
            okButtonProps: { disabled: !canSubmit, loading: submitMutation.isPending },
          })}
    />
  );
}
