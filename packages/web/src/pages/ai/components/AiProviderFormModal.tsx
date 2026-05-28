import React, { useEffect, useRef, useState } from 'react';
import { Col, Form, Modal, Row, Spin, Toast } from '@douyinfe/semi-ui';
import type { AiProvider, AiProviderConfig, UserAiConfig } from '@zenith/shared';
import { request } from '@/utils/request';

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'baidu', label: '百度千帆' },
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

  const [submitLoading, setSubmitLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [initValues, setInitValues] = useState<FormValues>(SYSTEM_DEFAULTS);
  const formApiRef = useRef<{ getValues: () => FormValues; validate: () => Promise<FormValues> } | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (props.mode === 'user') {
      const uc = props.userConfig;
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
      const et = props.editTarget;
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
        setDetailLoading(true);
        request
          .get<AiProviderConfig>(`/api/ai/providers/${et.id}`)
          .then((res) => {
            if (res.code === 0 && res.data) {
              setInitValues({
                name: res.data.name,
                provider: res.data.provider,
                baseUrl: res.data.baseUrl,
                apiKey: res.data.apiKey,
                model: res.data.model,
                systemPrompt: res.data.systemPrompt,
                maxTokens: res.data.maxTokens,
                temperature: res.data.temperature,
                isDefault: res.data.isDefault,
                isEnabled: res.data.isEnabled,
              });
              setFormKey((k) => k + 1);
            } else {
              Toast.error(res.message || '获取服务商信息失败');
            }
          })
          .catch(() => {})
          .finally(() => setDetailLoading(false));
      } else {
        setInitValues(SYSTEM_DEFAULTS);
        setFormKey((k) => k + 1);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleOk = async () => {
    if (!formApiRef.current) return;
    let values: FormValues;
    try {
      values = await formApiRef.current.validate();
    } catch {
      // validation failed, semi design will show field errors
      return;
    }
    setSubmitLoading(true);
    try {
      if (props.mode === 'user') {
        const res = await request.put<UserAiConfig>('/api/ai/user-config', {
          name: values.name || null,
          provider: values.provider,
          baseUrl: values.baseUrl || null,
          apiKey: values.apiKey || null,
          model: values.model || null,
          temperature: values.temperature || null,
          maxTokens: values.maxTokens || null,
          systemPrompt: values.systemPrompt || null,
          isEnabled: values.isEnabled,
        });
        if (res.data) {
          Toast.success('保存成功');
          props.onSaved(res.data);
          onClose();
        }
      } else {
        const et = props.editTarget;
        let res;
        if (et) {
          res = await request.put(`/api/ai/providers/${et.id}`, values);
        } else {
          res = await request.post('/api/ai/providers', values);
        }
        if (res.code === 0) {
          Toast.success(et ? '修改成功' : '创建成功');
          props.onSaved();
          onClose();
        }
      }
    } catch {
      // handled by request interceptor
    } finally {
      setSubmitLoading(false);
    }
  };

  const isUser = props.mode === 'user';
  const editTarget = isUser ? undefined : props.editTarget;
  let title = '新增服务商';
  if (isUser) title = '我的 AI 配置';
  else if (editTarget) title = '编辑服务商';

  return (
    <Modal
      title={title}
      visible={visible}
      onCancel={onClose}
      onOk={() => void handleOk()}
      okButtonProps={{ loading: submitLoading, disabled: detailLoading }}
      width={720}
      destroyOnClose
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
                rules={isUser ? undefined : [{ required: true, message: '请输入名称' }]}
                placeholder={isUser ? '可选' : ''}
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
                rules={isUser ? undefined : [{ required: true, message: '请输入 API 地址' }]}
                placeholder="https://api.openai.com/v1"
              />
            </Col>
            <Col span={12}>
              <Form.Input
                field="apiKey"
                label="API Key"
                rules={isUser || editTarget ? undefined : [{ required: true, message: '请输入 API Key' }]}
                mode="password"
                placeholder={editTarget ?? isUser ? '留空保留原值' : ''}
              />
            </Col>
          </Row>
          {/* 行3：模型 + 温度 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="model"
                label="模型"
                rules={isUser ? undefined : [{ required: true, message: '请输入模型名称' }]}
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
    </Modal>
  );
}
