import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, Form, Row, Spin, Toast } from '@douyinfe/semi-ui';
import type { AiProvider, AiProviderConfig, UserAiConfig } from '@zenith/shared';
import { AppModal } from '@/components/AppModal';
import { useAiProviderDetail, useSaveAiProvider, useTestAiProviderConnection } from '@/hooks/queries/ai-providers';
import { useSaveAiUserConfig } from '@/hooks/queries/ai-user-config';

const PROVIDER_OPTIONS: { value: AiProvider; label: string; disabled?: boolean }[] = [
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  // 以下供应商协议不兼容 /chat/completions，暂未原生适配；请通过 OpenAI 兼容网关接入
  { value: 'anthropic', label: 'Anthropic（暂未支持，请用兼容网关接入）', disabled: true },
  { value: 'gemini', label: 'Google Gemini（暂未支持，请用兼容网关接入）', disabled: true },
  { value: 'baidu', label: '百度千帆（暂未支持，请用兼容网关接入）', disabled: true },
];

interface FormValues {
  name: string;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string | null;
  maxTokens: number;
  temperature: string;
  isDefault: boolean;
  isEnabled: boolean;
}

const SYSTEM_DEFAULTS: FormValues = {
  name: '',
  provider: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  systemPrompt: null,
  maxTokens: 4096,
  temperature: '0.7',
  isDefault: false,
  isEnabled: true,
};

interface BaseProps {
  visible: boolean;
  onClose: () => void;
}

interface SystemModeProps extends BaseProps {
  mode?: 'system';
  editTarget?: AiProviderConfig | null;
  onSaved: () => void;
}

interface UserModeProps extends BaseProps {
  mode: 'user';
  userConfig?: UserAiConfig | null;
  onSaved: (config: UserAiConfig) => void;
}

type AiProviderFormModalProps = SystemModeProps | UserModeProps;

export default function AiProviderFormModal(props: AiProviderFormModalProps) {
  const { visible, onClose } = props;
  const isUser = props.mode === 'user';
  const editTarget = isUser ? undefined : props.editTarget;
  const existingUserConfig = isUser ? (props as { mode: 'user'; userConfig?: UserAiConfig | null }).userConfig ?? null : null;
  const detailQuery = useAiProviderDetail(editTarget?.id, visible && !isUser && !!editTarget);
  const saveProviderMutation = useSaveAiProvider();
  const saveUserConfigMutation = useSaveAiUserConfig();
  const testConnectionMutation = useTestAiProviderConnection();
  const [formKey, setFormKey] = useState(0);
  const [initValues, setInitValues] = useState<FormValues>(SYSTEM_DEFAULTS);
  const formApiRef = useRef<{ getValues: () => FormValues; validate: () => Promise<FormValues> } | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (isUser) {
      const uc = existingUserConfig;
      setInitValues(
        uc
          ? {
              ...SYSTEM_DEFAULTS,
              name: uc.name ?? '',
              provider: uc.provider ?? 'openai_compatible',
              baseUrl: uc.baseUrl ?? '',
              apiKey: uc.apiKey ?? '',
              model: uc.model ?? '',
              temperature: uc.temperature ?? '0.7',
              maxTokens: uc.maxTokens ?? 4096,
              systemPrompt: uc.systemPrompt ?? null,
              isEnabled: uc.isEnabled,
            }
          : SYSTEM_DEFAULTS,
      );
      setFormKey((k) => k + 1);
    } else {
      const et = detailQuery.data ?? editTarget;
      if (et) {
        setInitValues({
          name: et.name,
          provider: et.provider,
          baseUrl: et.baseUrl,
          apiKey: et.apiKey,
          model: et.model,
          systemPrompt: et.systemPrompt,
          maxTokens: et.maxTokens,
          temperature: et.temperature,
          isDefault: et.isDefault,
          isEnabled: et.isEnabled,
        });
        setFormKey((k) => k + 1);
      } else {
        setInitValues(SYSTEM_DEFAULTS);
        setFormKey((k) => k + 1);
      }
    }
  }, [detailQuery.data, editTarget, existingUserConfig, isUser, visible]);

  const handleOk = async () => {
    if (!formApiRef.current) return;
    let values: FormValues;
    try {
      values = await formApiRef.current.validate();
    } catch {
      // validation failed, semi design will show field errors
      return;
    }
    try {
      if (isUser) {
        const saved = await saveUserConfigMutation.mutateAsync({
          id: existingUserConfig?.id,
          values: {
            name: values.name || null,
            provider: values.provider,
            baseUrl: values.baseUrl || null,
            apiKey: values.apiKey || null,
            model: values.model || null,
            temperature: values.temperature || null,
            maxTokens: values.maxTokens || null,
            systemPrompt: values.systemPrompt || null,
            isEnabled: values.isEnabled,
          },
        });
        Toast.success('保存成功');
        props.onSaved(saved);
        onClose();
      } else {
        await saveProviderMutation.mutateAsync({ id: editTarget?.id, values });
        Toast.success(editTarget ? '修改成功' : '创建成功');
        props.onSaved();
        onClose();
      }
    } catch {
      // handled by request interceptor
    }
  };

  const isEditing = isUser ? !!existingUserConfig : !!editTarget;
  const submitLoading = saveProviderMutation.isPending || saveUserConfigMutation.isPending;
  const detailLoading = !isUser && !!editTarget && detailQuery.isFetching;
  const testLoading = testConnectionMutation.isPending;
  let title = '新增服务商';
  if (isUser) title = '我的 AI 配置';
  else if (editTarget) title = '编辑服务商';

  const handleTestConnection = async () => {
    if (!formApiRef.current) return;
    const values = formApiRef.current.getValues();
    if (!values.baseUrl || !values.model) {
      Toast.warning('请先填写 API 地址和模型名称');
      return;
    }
    try {
      const body: {
        id?: number;
        provider?: AiProvider;
        baseUrl: string;
        apiKey?: string;
        model: string;
      } = {
        provider: values.provider ?? 'openai_compatible',
        baseUrl: values.baseUrl,
        model: values.model,
      };
      // 有 id 时（编辑模式），若 apiKey 为空或含脱敏标记，传 id 让后端取真实密钥
      const id = editTarget?.id;
      const apiKey = values.apiKey ?? '';
      if (id && (!apiKey || apiKey.includes('...') || apiKey === '******')) {
        body.id = id;
      } else if (apiKey) {
        body.apiKey = apiKey;
      }

      const res = await testConnectionMutation.mutateAsync(body);
      if (res.success) {
        Toast.success('连接测试成功');
      } else {
        Toast.error(`连接测试失败：${res.message ?? '未知错误'}`);
      }
    } catch {
      // handled by request interceptor
    }
  };

  return (
    <AppModal
      title={title}
      visible={visible}
      onCancel={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button loading={testLoading} disabled={detailLoading} onClick={() => void handleTestConnection()}>
              测试连接
            </Button>
          <Button disabled={submitLoading || testLoading} onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitLoading} disabled={detailLoading || testLoading} onClick={() => void handleOk()}>确定</Button>
        </div>
      }
      width={720}
    >
      {detailLoading ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin />
        </div>
      ) : (
        <Form<FormValues>
          key={formKey}
          labelPosition="left"
          labelWidth={90}
          initValues={initValues}
          getFormApi={(api) => {
            formApiRef.current = api;
          }}
        >
          {/* 行1：名称 + 供应商类型 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
                placeholder=""
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="provider"
                label="供应商类型"
                optionList={PROVIDER_OPTIONS}
                style={{ width: '100%' }}
              />
            </Col>
          </Row>
          {/* 行2：API地址 + API Key */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="baseUrl"
                label="API 地址"
                rules={[{ required: true, message: '请输入 API 地址' }]}
                placeholder="https://api.openai.com/v1"
              />
            </Col>
            <Col span={12}>
              <Form.Input
                field="apiKey"
                label="API Key"
                rules={isEditing ? undefined : [{ required: true, message: '请输入 API Key' }]}
                mode="password"
                placeholder={isEditing ? '留空保留原值' : ''}
              />
            </Col>
          </Row>
          {/* 行3：模型 + 温度 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="model"
                label="模型"
                rules={[{ required: true, message: '请输入模型名称' }]}
                placeholder="gpt-4o"
              />
            </Col>
            <Col span={12}>
              <Form.Input field="temperature" label="温度" placeholder="0.7" />
            </Col>
          </Row>
          {/* 行4：最大 Token + 启用开关 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber field="maxTokens" label="最大 Token" min={1} max={128000} />
            </Col>
            <Col span={12}>
              {isUser ? (
                <Form.Switch field="isEnabled" label="启用配置" />
              ) : (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Switch field="isDefault" label="默认" />
                  </Col>
                  <Col span={12}>
                    <Form.Switch field="isEnabled" label="启用" />
                  </Col>
                </Row>
              )}
            </Col>
          </Row>
          <Form.TextArea
            field="systemPrompt"
            label="系统提示词"
            rows={3}
            placeholder="可选，为空则使用默认提示词"
          />
        </Form>
      )}
    </AppModal>
  );
}
