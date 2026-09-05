import { useEffect, useState } from 'react';
import { Button, Col, Form, Row, SideSheet, Spin, Toast, useFormState } from '@douyinfe/semi-ui';
import type { AiModelFallbackRef, AiModelSettings, AiProviderConfig, AiReasoningLevel, SaveUserAiConfigInput, UserAiConfig } from '@zenith/shared/ai';
import { AI_CUSTOM_PROVIDER_ID, AI_REASONING_LEVELS } from '@zenith/shared/ai';
import {
  useAiProviderDetail,
  useSaveAiProvider,
  useTestAiProviderConnection,
  useFetchAiProviderModels,
  useAiProviderList,
  useAiProviderCatalog,
  useAiCatalogModels,
  type AiProviderFetchModelsPayload,
  type AiProviderTestPayload,
  type SaveAiProviderValues,
} from '@/hooks/queries/ai-providers';
import { useSaveAiUserConfig } from '@/hooks/queries/ai-user-config';
import { useEditModal } from '@/hooks/useEditModal';

interface FormValues {
  name: string;
  providerId: string;
  baseUrl?: string | null;
  apiKey: string;
  models: string[];
  defaultModel: string;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  /** 推理力度(仅支持 reasoning 的模型生效;空 = 跟随模型默认) */
  reasoning?: AiReasoningLevel | null;
  capVision?: boolean;
  capTools?: boolean;
  contextWindow?: number | null;
  priceInputPerM?: number | null;
  priceOutputPerM?: number | null;
  /** 降级链(`${configId}:${model}` 复合值,顺序即优先级) */
  fallbackRefs?: string[];
  maxConcurrent?: number | null;
  systemPrompt?: string | null;
  isDefault: boolean;
  isEnabled: boolean;
}

const SYSTEM_DEFAULTS: FormValues = {
  name: '',
  providerId: AI_CUSTOM_PROVIDER_ID,
  baseUrl: null,
  apiKey: '',
  models: [],
  defaultModel: '',
  temperature: null,
  maxOutputTokens: null,
  reasoning: null,
  capVision: false,
  capTools: false,
  contextWindow: null,
  priceInputPerM: null,
  priceOutputPerM: null,
  fallbackRefs: [],
  maxConcurrent: null,
  systemPrompt: null,
  isDefault: false,
  isEnabled: true,
};

const encodeFallback = (f: AiModelFallbackRef) => `${f.configId}:${f.model}`;

/** 默认模型选择器:经 useFormState 订阅「启用模型」值实时联动选项。
 * 注意不能加 allowCreate —— Semi Select 开启 allowCreate 后不再响应 optionList 动态更新。 */
function DefaultModelField() {
  const formState = useFormState();
  const models = ((formState.values as { models?: string[] } | undefined)?.models ?? []).filter(Boolean);
  return (
    <Form.Select
      field="defaultModel"
      label="默认模型"
      filter
      optionList={models.map((m) => ({ value: m, label: m }))}
      style={{ width: '100%' }}
      rules={[{ required: true, message: '请选择默认模型' }]}
      placeholder="必须是启用模型之一"
    />
  );
}

function decodeFallbacks(refs: string[] | undefined): AiModelFallbackRef[] | null {
  const parsed = (refs ?? [])
    .map((v) => {
      const idx = v.indexOf(':');
      if (idx <= 0) return null;
      const configId = Number(v.slice(0, idx));
      const model = v.slice(idx + 1);
      return Number.isFinite(configId) && model ? { configId, model } : null;
    })
    .filter((f): f is AiModelFallbackRef => f !== null);
  return parsed.length > 0 ? parsed : null;
}

function providerToFormValues(config: AiProviderConfig): FormValues {
  return {
    name: config.name,
    providerId: config.providerId,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    models: config.models ?? [],
    defaultModel: config.defaultModel,
    temperature: config.modelSettings?.temperature ?? null,
    maxOutputTokens: config.modelSettings?.maxOutputTokens ?? null,
    reasoning: config.modelSettings?.reasoning ?? null,
    capVision: config.capabilities?.vision ?? false,
    capTools: config.capabilities?.tools ?? false,
    contextWindow: config.capabilities?.contextWindow ?? null,
    priceInputPerM: config.priceInputPerM,
    priceOutputPerM: config.priceOutputPerM,
    fallbackRefs: (config.fallbacks ?? []).map(encodeFallback),
    maxConcurrent: config.maxConcurrent,
    systemPrompt: null,
    isDefault: config.isDefault,
    isEnabled: config.isEnabled,
  };
}

function userConfigToFormValues(config: UserAiConfig): FormValues {
  return {
    ...SYSTEM_DEFAULTS,
    name: config.name ?? '',
    providerId: config.providerId ?? AI_CUSTOM_PROVIDER_ID,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ?? '',
    models: config.models ?? [],
    defaultModel: config.defaultModel ?? '',
    temperature: config.modelSettings?.temperature ?? null,
    maxOutputTokens: config.modelSettings?.maxOutputTokens ?? null,
    reasoning: config.modelSettings?.reasoning ?? null,
    capVision: config.capabilities?.vision ?? false,
    capTools: config.capabilities?.tools ?? false,
    contextWindow: config.capabilities?.contextWindow ?? null,
    systemPrompt: config.systemPrompt ?? null,
    isEnabled: config.isEnabled,
  };
}

/** 温度/最大输出/推理力度并入 Mastra modelSettings(留空的键不写入) */
function toModelSettings(values: FormValues): AiModelSettings | null {
  const settings: AiModelSettings = {};
  if (values.temperature !== null && values.temperature !== undefined) settings.temperature = values.temperature;
  if (values.maxOutputTokens) settings.maxOutputTokens = values.maxOutputTokens;
  if (values.reasoning) settings.reasoning = values.reasoning;
  return Object.keys(settings).length > 0 ? settings : null;
}

/** 推理力度选项(shared 档位;首项为跟随模型默认) */
const REASONING_OPTIONS = [
  { value: '', label: '跟随模型默认' },
  ...AI_REASONING_LEVELS.map((lv) => ({ value: lv, label: lv })),
];

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
  const allProvidersQuery = useAiProviderList({ enabled: visible && !isUser });
  const catalogQuery = useAiProviderCatalog({ enabled: visible });
  const saveProviderMutation = useSaveAiProvider();
  const saveUserConfigMutation = useSaveAiUserConfig();
  const testConnectionMutation = useTestAiProviderConnection();
  const fetchModelsMutation = useFetchAiProviderModels();
  // 镜像表单中的 providerId(驱动目录模型查询;其余联动经 Form 函数式 children 的 formState)
  const [providerId, setProviderId] = useState<string>(AI_CUSTOM_PROVIDER_ID);
  const isCustom = providerId === AI_CUSTOM_PROVIDER_ID;
  const catalogModelsQuery = useAiCatalogModels(providerId, { enabled: visible && !isCustom });

  const systemModal = useEditModal<AiProviderConfig, FormValues, SaveAiProviderValues>({
    save: saveProviderMutation,
    useDetail: useAiProviderDetail,
    defaults: SYSTEM_DEFAULTS,
    toValues: providerToFormValues,
    beforeSave: (values) => {
      const models = (values.models ?? []).map((m) => m.trim()).filter(Boolean);
      return {
        name: values.name,
        providerId: values.providerId,
        baseUrl: values.baseUrl?.trim() || null,
        apiKey: values.apiKey,
        models,
        defaultModel: values.defaultModel,
        modelSettings: toModelSettings(values),
        fallbacks: decodeFallbacks(values.fallbackRefs),
        capabilities: {
          vision: values.capVision ?? false,
          tools: values.capTools ?? false,
          ...(values.contextWindow ? { contextWindow: values.contextWindow } : {}),
        },
        priceInputPerM: values.priceInputPerM ?? null,
        priceOutputPerM: values.priceOutputPerM ?? null,
        maxConcurrent: values.maxConcurrent || null,
        isDefault: values.isDefault,
        isEnabled: values.isEnabled,
      };
    },
    successMessage: ({ isEdit }) => (isEdit ? '修改成功' : '创建成功'),
    // 最长标签「最大输出」+双列布局,不宜再宽
    labelWidth: 92,
    onSaved: () => {
      if (props.mode !== 'user') props.onSaved();
      onClose();
    },
  });
  const userModal = useEditModal<UserAiConfig, FormValues, SaveUserAiConfigInput>({
    save: saveUserConfigMutation,
    defaults: SYSTEM_DEFAULTS,
    toValues: userConfigToFormValues,
    beforeSave: (values) => ({
      name: values.name || null,
      providerId: values.providerId,
      baseUrl: values.baseUrl?.trim() || null,
      apiKey: values.apiKey || null,
      models: (values.models ?? []).map((m) => m.trim()).filter(Boolean),
      defaultModel: values.defaultModel || null,
      modelSettings: toModelSettings(values),
      capabilities: {
        vision: values.capVision ?? false,
        tools: values.capTools ?? false,
        ...(values.contextWindow ? { contextWindow: values.contextWindow } : {}),
      },
      systemPrompt: values.systemPrompt || null,
      isEnabled: values.isEnabled,
    }),
    successMessage: () => '保存成功',
    labelWidth: 92,
    onSaved: (saved) => {
      if (props.mode === 'user') props.onSaved(saved);
      onClose();
    },
  });

  useEffect(() => {
    if (!visible) {
      systemModal.close();
      userModal.close();
      return;
    }
    if (isUser) {
      if (existingUserConfig) userModal.openEdit(existingUserConfig);
      else userModal.openCreate();
      setProviderId(existingUserConfig?.providerId ?? AI_CUSTOM_PROVIDER_ID);
    } else if (editTarget) {
      systemModal.openEdit(editTarget);
      setProviderId(editTarget.providerId);
    } else {
      systemModal.openCreate();
      setProviderId(AI_CUSTOM_PROVIDER_ID);
    }
  }, [visible, isUser, existingUserConfig, editTarget, systemModal.openCreate, systemModal.openEdit, systemModal.close, userModal.openCreate, userModal.openEdit, userModal.close]);

  const activeModal = isUser ? userModal : systemModal;
  const isEditing = activeModal.isEdit;
  const submitLoading = saveProviderMutation.isPending || saveUserConfigMutation.isPending;
  const detailLoading = !isUser && systemModal.detailLoading;
  const testLoading = testConnectionMutation.isPending;
  let title = '新增服务商';
  if (isUser) title = '我的 AI 配置';
  else if (editTarget) title = '编辑服务商';

  const providerOptions = (catalogQuery.data ?? []).map((p) => ({
    value: p.id,
    label: p.common ? p.name : `${p.name}（${p.id}）`,
  }));

  type FormApiLike = { getValues: () => FormValues; setValue: (field: string, value: unknown) => void } | null;

  /** 获取模型列表:custom 从端点 /models 发现;目录服务商直接取目录清单 */
  const handleFetchModels = async () => {
    const formApi = activeModal.formApi.current as FormApiLike;
    if (!formApi) return;
    const values = formApi.getValues();
    if (values.providerId === AI_CUSTOM_PROVIDER_ID && !values.baseUrl) {
      Toast.warning('请先填写 API 地址');
      return;
    }
    try {
      const body: AiProviderFetchModelsPayload = {
        providerId: values.providerId,
        baseUrl: values.baseUrl ?? null,
      };
      const apiKey = values.apiKey ?? '';
      if (editTarget?.id && (!apiKey || apiKey.includes('...') || apiKey === '******')) {
        body.id = editTarget.id;
      } else if (apiKey) {
        body.apiKey = apiKey;
      }
      const models = await fetchModelsMutation.mutateAsync({ body });
      if (models.length === 0) {
        Toast.info('未发现可用模型');
        return;
      }
      formApi.setValue('models', models);
      Toast.success(`已获取 ${models.length} 个模型`);
    } catch {
      // handled by request interceptor
    }
  };

  const handleTestConnection = async () => {
    const formApi = activeModal.formApi.current as FormApiLike;
    if (!formApi) return;
    const values = formApi.getValues();
    const model = values.defaultModel;
    if (!model) {
      Toast.warning('请先选择默认模型');
      return;
    }
    if (values.providerId === AI_CUSTOM_PROVIDER_ID && !values.baseUrl) {
      Toast.warning('自定义服务商请先填写 API 地址');
      return;
    }
    try {
      const body: AiProviderTestPayload = {
        providerId: values.providerId,
        baseUrl: values.baseUrl ?? null,
        model,
      };
      // 有 id 时（编辑模式），若 apiKey 为空或含脱敏标记，传 id 让后端取真实密钥
      const id = editTarget?.id;
      const apiKey = values.apiKey ?? '';
      if (id && (!apiKey || apiKey.includes('...') || apiKey === '******')) {
        body.id = id;
      } else if (apiKey) {
        body.apiKey = apiKey;
      }

      const res = await testConnectionMutation.mutateAsync({ body });
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
    <SideSheet
      title={title}
      visible={activeModal.visible}
      onCancel={() => { activeModal.close(); onClose(); }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <Button loading={testLoading} disabled={detailLoading} onClick={() => void handleTestConnection()}>
            测试连接
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="tertiary" disabled={submitLoading || testLoading} onClick={() => { activeModal.close(); onClose(); }}>取消</Button>
            <Button type="primary" theme="solid" loading={submitLoading} disabled={detailLoading || testLoading} onClick={() => void activeModal.modalProps.onOk()}>确定</Button>
          </div>
        </div>
      }
      width={720}
      closeOnEsc
    >
      {detailLoading ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin />
        </div>
      ) : (
        <Form
          key={activeModal.formKey} {...activeModal.formProps}
          onValueChange={(values: Partial<FormValues>) => {
            if (values.providerId && values.providerId !== providerId) setProviderId(values.providerId);
          }}
        >
          <Form.Section text="接入信息">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} />
              </Col>
              <Col span={12}>
                <Form.Select
                  field="providerId"
                  label="服务商"
                  filter
                  loading={catalogQuery.isLoading}
                  optionList={providerOptions}
                  style={{ width: '100%' }}
                  extraText="常用服务商排前;更多服务商可搜索(来自 Mastra 模型目录)"
                />
              </Col>
            </Row>
            <Form.Input
              field="baseUrl"
              label="API 地址"
              rules={isCustom ? [{ required: true, message: '请输入 API 地址' }] : undefined}
              placeholder={isCustom ? 'https://your-gateway.example.com/v1' : '留空使用官方端点,填写则覆盖'}
            />
            <Form.Input
              field="apiKey"
              label="API Key"
              rules={isEditing ? undefined : [{ required: true, message: '请输入 API Key' }]}
              mode="password"
              placeholder={isEditing ? '留空保留原值' : ''}
            />
          </Form.Section>

          <Form.Section text="模型">
            {isCustom ? (
              <Form.TagInput
                field="models"
                label="启用模型"
                placeholder="输入模型名后回车添加，或点击右侧「从 API 获取」"
                allowDuplicates={false}
                rules={[{ required: true, message: '至少启用一个模型' }]}
                extraText={(
                  <span>
                    聊天时可在启用的模型间切换
                    <Button
                      theme="borderless"
                      type="primary"
                      size="small"
                      loading={fetchModelsMutation.isPending}
                      style={{ marginLeft: 4 }}
                      onClick={() => void handleFetchModels()}
                    >
                      从 API 获取
                    </Button>
                  </span>
                )}
              />
            ) : (
              <Form.Select
                field="models"
                label="启用模型"
                // allowCreate 的 Select 不响应 optionList 动态更新:目录数据到达后经 key 重挂载
                key={`models-${providerId}-${catalogModelsQuery.data?.length ?? 0}`}
                multiple
                filter
                allowCreate
                loading={catalogModelsQuery.isLoading}
                optionList={(catalogModelsQuery.data ?? []).map((m) => ({ value: m, label: m }))}
                style={{ width: '100%' }}
                rules={[{ required: true, message: '至少启用一个模型' }]}
                placeholder="从目录选择,支持搜索与手动输入"
                extraText="模型清单来自 Mastra 目录;也可输入目录外的模型名"
              />
            )}
            <DefaultModelField />
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="temperature" label="温度" min={0} max={2} step={0.1} placeholder="留空用模型默认" style={{ width: '100%' }} extraText="0–2，越大越发散" />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="maxOutputTokens" label="最大输出" min={1} placeholder="留空用模型默认" style={{ width: '100%' }} extraText="单次回复最大 Token" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="reasoning" label="推理力度" optionList={REASONING_OPTIONS} style={{ width: '100%' }} placeholder="跟随模型默认" extraText="仅推理模型生效，开启后回复带思考过程" />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="contextWindow" label="上下文窗口" min={0} placeholder="可选" style={{ width: '100%' }} extraText="单位 Token" />
              </Col>
            </Row>
            <Form.Slot label="模型能力">
              <div style={{ display: 'flex', gap: 24 }}>
                <Form.Switch field="capVision" noLabel label="图片理解" extraText="支持图片理解" />
                <Form.Switch field="capTools" noLabel label="函数调用" extraText="支持函数调用" />
              </div>
            </Form.Slot>
          </Form.Section>

          {!isUser && (
            <Form.Section text="成本与可靠性">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.InputNumber field="priceInputPerM" label="输入单价" min={0} placeholder="留空不计成本" style={{ width: '100%' }} extraText="分 / 百万 Token" />
                </Col>
                <Col span={12}>
                  <Form.InputNumber field="priceOutputPerM" label="输出单价" min={0} placeholder="留空不计成本" style={{ width: '100%' }} extraText="分 / 百万 Token" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Select
                    field="fallbackRefs"
                    label="降级链"
                    placeholder="不启用主备切换"
                    multiple
                    filter
                    showClear
                    style={{ width: '100%' }}
                    extraText="失败(5xx/限流/超时)时按顺序自动切换,可多级"
                    optionList={(allProvidersQuery.data ?? [])
                      .filter((pr) => pr.id !== editTarget?.id && pr.isEnabled)
                      .flatMap((pr) => (pr.models ?? []).map((m) => ({
                        value: `${pr.id}:${m}`,
                        label: `${pr.name} / ${m}`,
                      })))}
                  />
                </Col>
                <Col span={12}>
                  <Form.InputNumber field="maxConcurrent" label="并发上限" min={0} max={1000} placeholder="留空不限制" style={{ width: '100%' }} extraText="同时进行的流式请求数" />
                </Col>
              </Row>
            </Form.Section>
          )}

          <Form.Section text="其他">
            {isUser && (
              <Form.TextArea
                field="systemPrompt"
                label="系统提示词"
                rows={3}
                placeholder="可选，为空则使用默认提示词"
              />
            )}
            <Form.Slot label="状态">
              <div style={{ display: 'flex', gap: 24 }}>
                {!isUser && <Form.Switch field="isDefault" noLabel label="默认" extraText="设为默认服务商" />}
                <Form.Switch field="isEnabled" noLabel label="启用" extraText={isUser ? '启用此配置' : '启用此服务商'} />
              </div>
            </Form.Slot>
          </Form.Section>
        </Form>
      )}
    </SideSheet>
  );
}
