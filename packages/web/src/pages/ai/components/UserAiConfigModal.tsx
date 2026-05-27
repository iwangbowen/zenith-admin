import React, { useEffect, useState } from 'react';
import { Button, Col, Form, Modal, Row, Spin, Switch, Toast } from '@douyinfe/semi-ui';
import type { AiProvider, UserAiConfig } from '@zenith/shared';
import { request } from '@/utils/request';

const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'baidu', label: '百度千帆' },
];

interface UserAiConfigModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSaved: (config: UserAiConfig) => void;
}

interface FormValues {
  provider: AiProvider;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  isEnabled: boolean;
}

const DEFAULT_VALUES: FormValues = {
  provider: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  isEnabled: true,
};

export default function UserAiConfigModal({ visible, onClose, onSaved }: UserAiConfigModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initValues, setInitValues] = useState<FormValues>(DEFAULT_VALUES);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    void request
      .get<UserAiConfig | null>('/api/ai/user-config')
      .then((res) => {
        const cfg = res.data;
        setInitValues(
          cfg
            ? {
                provider: cfg.provider ?? 'openai_compatible',
                baseUrl: cfg.baseUrl ?? '',
                apiKey: cfg.apiKey ?? '',
                model: cfg.model ?? '',
                isEnabled: cfg.isEnabled ?? true,
              }
            : DEFAULT_VALUES,
        );
        setFormKey((k) => k + 1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible]);

  const handleSubmit = async (values: FormValues) => {
    setSaving(true);
    try {
      const res = await request.put<UserAiConfig>('/api/ai/user-config', {
        provider: values.provider,
        baseUrl: values.baseUrl || null,
        apiKey: values.apiKey || null,
        model: values.model || null,
        isEnabled: values.isEnabled,
      });
      if (res.data) {
        Toast.success('保存成功');
        onSaved(res.data);
        onClose();
      }
    } catch {
      Toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="我的 AI 配置"
      visible={visible}
      onCancel={onClose}
      width={600}
      footer={null}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin />
        </div>
      ) : (
        <Form<FormValues>
          key={formKey}
          onSubmit={handleSubmit}
          initValues={initValues}
          labelPosition="left"
          labelWidth={90}
        >
          {({ formState }) => (
            <>
              <Form.Slot label={{ text: '启用自定义配置' }}>
                <Form.Switch field="isEnabled" noLabel />
              </Form.Slot>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Select
                    field="provider"
                    label="供应商类型"
                    optionList={PROVIDER_OPTIONS}
                    rules={[{ required: true, message: '请选择供应商类型' }]}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col span={12}>
                  <Form.Input
                    field="model"
                    label="模型名称"
                    placeholder="如 gpt-4o、qwen-plus"
                    rules={[
                      {
                        required: formState.values.isEnabled,
                        message: '启用配置时模型名称必填',
                      },
                    ]}
                  />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input
                    field="baseUrl"
                    label="API 地址"
                    placeholder="如 https://api.openai.com/v1"
                    rules={[
                      {
                        required: formState.values.isEnabled,
                        message: '启用配置时 API 地址必填',
                      },
                    ]}
                  />
                </Col>
                <Col span={12}>
                  <Form.Input
                    field="apiKey"
                    label="API Key"
                    mode="password"
                    placeholder="留空则不修改已保存的 Key"
                  />
                </Col>
              </Row>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <Button onClick={onClose}>取消</Button>
                <Button type="primary" htmlType="submit" loading={saving}>
                  保存
                </Button>
              </div>
            </>
          )}
        </Form>
      )}
    </Modal>
  );
}
