import { FormPasswordInput } from '@/components/PasswordInput';
import { useMemo } from 'react';
import { Banner, Descriptions, Form, Tag, Typography } from '@douyinfe/semi-ui';
import { IMPERSONATION_DURATION_OPTIONS, type User } from '@zenith/shared/identity';
import { EditFormModal } from '@/components/EditFormModal';
import { useMySettings } from '@/hooks/queries/settings';
import type { UseEditModalReturn } from '@/hooks/useEditModal';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

/** 发起「以用户身份登录」的确认弹窗：目标信息 + 原因 + 模式 + 时长 + 操作者本人密码二次验证 */
export function ImpersonateModal({ modal }: Readonly<{ modal: UseEditModalReturn<User> }>) {
  const policy = useMySettings().data?.identitySecurity.impersonation;
  const maxMinutes = policy?.maxMinutes ?? 30;
  const allowWrite = policy?.allowWrite ?? false;
  const target = modal.editing;

  const durationOptions = useMemo(() => {
    const presets = IMPERSONATION_DURATION_OPTIONS.filter((m) => m <= maxMinutes);
    const values = presets.includes(maxMinutes as (typeof IMPERSONATION_DURATION_OPTIONS)[number]) ? presets : [...presets, maxMinutes];
    return values.map((m) => ({ value: m, label: `${m} 分钟${m === maxMinutes ? '（上限）' : ''}` }));
  }, [maxMinutes]);

  return (
    <EditFormModal
      modal={modal}
      title={target ? `模拟登录 - ${target.nickname}（${target.username}）` : '模拟登录'}
      okText="进入模拟"
      width={560}
      header={(
        <>
          <Banner
            type="warning"
            closeIcon={null}
            description="进入后你将以该用户的身份与权限浏览系统；全部操作都会记录为你的行为，目标用户会收到通知。到期或结束后自动回到当前账号。"
            style={{ marginBottom: 16 }}
          />
          {target && (
            <Descriptions
              size="small"
              row
              style={{ marginBottom: 8 }}
              data={[
                { key: '部门', value: target.departmentName ?? EMPTY_PLACEHOLDER },
                { key: '角色', value: target.roles.length ? target.roles.map((r) => <Tag key={r.id} size="small" style={{ marginRight: 4 }}>{r.name}</Tag>) : EMPTY_PLACEHOLDER },
              ]}
            />
          )}
        </>
      )}
    >
      <Form.TextArea
        field="reason"
        label="模拟原因"
        placeholder="例如：工单 #1234，复现该用户看不到审批入口的问题"
        rows={3}
        maxCount={200}
        rules={[
          { required: true, message: '请填写模拟原因' },
          { validator: (_rule, value: string) => (value ?? '').trim().length >= 5, message: '原因至少 5 个字' },
        ]}
      />
      <Form.RadioGroup
        field="mode"
        label="模式"
        extraText={allowWrite ? '可操作模式下仍禁止改密、MFA、API Token 等账号安全操作' : '当前安全策略只允许只读模拟'}
      >
        <Form.Radio value="readonly">只读（推荐）</Form.Radio>
        <Form.Radio value="write" disabled={!allowWrite}>可操作</Form.Radio>
      </Form.RadioGroup>
      <Form.Select field="durationMinutes" label="时长" optionList={durationOptions} style={{ width: 200 }} />
      <FormPasswordInput
        field="password"
        label="当前密码"
        placeholder="输入你自己的登录密码以确认"
        autoComplete="current-password"
        rules={[{ required: true, message: '请输入当前账号密码' }]}
      />
      <Typography.Text type="tertiary" size="small">
        模拟期间无法再次发起模拟；关闭标签页不会结束会话，请从顶部横幅「结束模拟」退出。
      </Typography.Text>
    </EditFormModal>
  );
}
