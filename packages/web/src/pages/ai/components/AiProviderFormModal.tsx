import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, Form, Row, Spin, Toast } from '@douyinfe/semi-ui';
import type { AiProvider, AiProviderConfig, UserAiConfig } from '@zenith/shared';
import { AppModal } from '@/components/AppModal';
import { useAiProviderDetail, useSaveAiProvider, useTestAiProviderConnection, useFetchAiProviderModels } from '@/hooks/queries/ai-providers';
import { useSaveAiUserConfig } from '@/hooks/queries/ai-user-config';

const PROVIDER_OPTIONS: { value: AiProvider; label: string; disabled?: boolean }[] = [
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic（原生 /v1/messages）' },
  { value: 'gemini', label: 'Google Gemini（原生 streamGenerateContent）' },
  { value: 'baidu', label: '百度千帆（暂未支持，请用兼容网关接入）', disabled: true },
];

interface FormValues {
  name: string;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[] | null;
  capVision?: boolean;
  capTools?: boolean;
  contextWindow?: number | null;
  systemPrompt?: string | null;
  maxTokens: number;
  temperature: string;
  priceInputPerM?: number | null;
  priceOutputPerM?: number | null;
  isDefault: boolean;
  isEnabled: boolean;
}

const SYSTEM_DEFAULTS: FormValues = {
  name: '',
  provider: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  models: [],
  capVision: false,
  capTools: false,
  contextWindow: null,
  systemPrompt: null,
  maxTokens: 4096,
  temperature: '0.7',
  priceInputPerM: null,
  priceOutputPerM: null,
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
  const fetchModelsMutation = useFetchAiProviderModels();
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
          models: et.models ?? [],
          capVision: et.capabilities?.vision ?? false,
          capTools: et.capabilities?.tools ?? false,
          contextWindow: et.capabilities?.contextWindow ?? null,
          systemPrompt: et.systemPrompt,
          maxTokens: et.maxTokens,
          temperature: et.temperature,
          priceInputPerM: et.priceInputPerM,
          priceOutputPerM: et.priceOutputPerM,
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
        const { capVision, capTools, contextWindow, models, ...rest } = values;
        await saveProviderMutation.mutateAsync({
          id: editTarget?.id,
          values: {
            ...rest,
            models: models?.filter((m) => m.trim()) ?? null,
            capabilities: {
              vision: capVision ?? false,
              tools: capTools ?? false,
              ...(contextWindow ? { contextWindow } : {}),
            },
            priceInputPerM: values.priceInputPerM ?? null,
            priceOutputPerM: values.priceOutputPerM ?? null,
          },
        });
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

  /** 从供应商 API 自动发现模型列表，填充附加模型字段 */
  const handleFetchModels = async () => {
    if (!formApiRef.current) return;
    const values = formApiRef.current.getValues();
    if (!values.baseUrl) {
      Toast.warning('请先填写 API 地址');
      return;
    }
    try {
      const body: { id?: number; provider?: string; baseUrl: string; apiKey?: string } = {
        provider: values.provider ?? 'openai_compatible',
        baseUrl: values.baseUrl,
      };
      const apiKey = values.apiKey ?? '';
      if (editTarget?.id && (!apiKey || apiKey.includes('...') || apiKey === '******')) {
        body.id = editTarget.id;
      } else if (apiKey) {
        body.apiKey = apiKey;
      }
      const models = await fetchModelsMutation.mutateAsync(body);
      if (models.length === 0) {
        Toast.info('未发现可用模型');
        return;
      }
      (formApiRef.current as unknown as { setValue: (f: string, v: unknown) => void }).setValue('models', models);
      Toast.success(`已获取 ${models.length} 个模型`);
    } catch {
      // handled by request interceptor
    }
  };

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
          {/* 附加模型 + 能力标签（仅系统配置） */}
          {!isUser && (
            <>
              <Form.TagInput
                field="models"
                label={
                  <span>
                    附加模型（同一服务商多模型，聊天时可切换）
                    <Button
                      theme="borderless"
                      type="primary"
                      size="small"
                      loading={fetchModelsMutation.isPending}
                      style={{ marginLeft: 8 }}
                      onClick={() => void handleFetchModels()}
                    >
                      从 API 获取
                    </Button>
                  </span>
                }
                placeholder="输入模型名后回车添加，或点击「从 API 获取」自动发现"
                allowDuplicates={false}
              />
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Switch field="capVision" label="支持图片理解" />
                </Col>
                <Col span={8}>
                  <Form.Switch field="capTools" label="支持函数调用" />
                </Col>
                <Col span={8}>
                  <Form.InputNumber field="contextWindow" label="上下文窗口（Token）" min={0} placeholder="可选" style={{ width: '100%' }} />
                </Col>
              </Row>
            </>
          )}
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
          {/* 行5：模型单价（仅系统配置，用于用量统计的成本估算） */}
          {!isUser && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber
                  field="priceInputPerM"
                  label="输入单价（分/百万Token）"
                  min={0}
                  placeholder="留空不计成本"
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={12}>
                <Form.InputNumber
                  field="priceOutputPerM"
                  label="输出单价（分/百万Token）"
                  min={0}
                  placeholder="留空不计成本"
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>
          )}
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
