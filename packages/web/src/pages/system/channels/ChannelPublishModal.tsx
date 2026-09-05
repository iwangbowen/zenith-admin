/**
 * 频道群发 / 草稿编辑 Modal
 *
 * 支持消息类型：文本（text）/ 图片（image）/ 图文（news）。
 * 支持受众：全员 / 指定用户 / 按部门 / 按角色。
 * 支持发送方式：立即发送 / 定时发送 / 存草稿。
 *
 * 复用：UserSelect（指定用户）、DepartmentSelect（按部门，TreeSelect），
 * 角色通过 /api/roles/all 加载为 Select multiple。
 * 封面图经通用单文件上传（`fileContract.uploadOne`，见 ImageUploadField）得到 URL。
 */
import { useEffect, useMemo, useState } from 'react';
import { useDebouncer } from '@tanstack/react-pacer';
import { Button, Col, Form, Input, Row, Select, SideSheet, Space, Toast, Typography, withField } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Eye, Save, Send, Settings2, Users } from 'lucide-react';
import type { ChatCard, ChatMessageExtra } from '@zenith/shared/chat';
import type { ChannelAdmin, ChannelMessage, ChannelMessageTemplate, ChannelPublishAudienceMode, ChannelSendMode } from '@zenith/shared/messaging';
import type { PublishChannelInput } from '@zenith/shared/mp';
import { formatDateTimeForApi } from '@/utils/date';
import { AppModal } from '@/components/AppModal';
import UserSelect from '@/components/UserSelect';
import DepartmentSelect from '@/components/DepartmentSelect';
import {
  ChannelContentFields,
  ChannelNewsBodyField,
  ChannelNewsPreviewModal,
} from './ChannelContentEditor';
import { EMPTY_CHANNEL_CONTENT, validateChannelContent, type ChannelContentValue } from './channel-content';
import { ChannelTemplateDrawer } from './ChannelTemplateDrawer';
import { useAllRoles } from '@/hooks/queries/roles';
import {
  useAudienceEstimate,
  useChannelTemplates,
  usePublishChannelMessage,
  useSaveChannelTemplate,
  useTestSendChannelMessage,
} from '@/hooks/queries/channels';

const FormUserSelect = withField(UserSelect);
const FormDeptSelect = withField(DepartmentSelect);

interface Props {
  channel: ChannelAdmin | null;
  /** 编辑的草稿 / 定时消息；为空表示新建群发 */
  editing?: ChannelMessage | null;
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/** 群发只支持文本 / 图片 / 图文（不含聊天卡片） */
type PublishType = PublishChannelInput['type'];

interface PublishFormValues {
  type: PublishType;
  audienceMode: ChannelPublishAudienceMode;
  userIds?: number[];
  departmentIds?: number[];
  roleIds?: number[];
  sendMode: ChannelSendMode;
  scheduledAt?: Date | string | null;
}

interface AudienceSelection {
  mode: ChannelPublishAudienceMode;
  userIds?: number[];
  departmentIds?: number[];
  roleIds?: number[];
}

const TYPE_OPTIONS = [
  { label: '文本', value: 'text' },
  { label: '图片', value: 'image' },
  { label: '图文', value: 'news' },
];
const AUDIENCE_OPTIONS = [
  { label: '全员', value: 'all' },
  { label: '指定用户', value: 'users' },
  { label: '按部门', value: 'departments' },
  { label: '按角色', value: 'roles' },
];
const SEND_OPTIONS = [
  { label: '立即发送', value: 'now' },
  { label: '定时发送', value: 'scheduled' },
  { label: '存草稿', value: 'draft' },
];

function toDateValue(v: string | null | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function ChannelPublishModal({ channel, editing, visible, onClose, onSuccess }: Readonly<Props>) {
  const [formApi, setFormApi] = useState<FormApi<PublishFormValues> | null>(null);
  /** 消息内容（标题/正文/图片/封面/摘要/链接/富文本），与发布设置分离，便于模板往返 */
  const [content, setContent] = useState<ChannelContentValue>(EMPTY_CHANNEL_CONTENT);
  const updateContent = (patch: Partial<ChannelContentValue>) => setContent((prev) => ({ ...prev, ...patch }));
  const [modalType, setModalType] = useState<PublishType>('text');

  const [audienceSel, setAudienceSel] = useState<AudienceSelection>({
    mode: 'all', userIds: [], departmentIds: [], roleIds: [],
  });
  const [estimateCount, setEstimateCount] = useState<number | null>(null);

  const [tplDrawerVisible, setTplDrawerVisible] = useState(false);
  const [saveTplVisible, setSaveTplVisible] = useState(false);
  const [saveTplName, setSaveTplName] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const rolesQuery = useAllRoles({ enabled: visible });
  const templatesQuery = useChannelTemplates(visible);
  const templates = templatesQuery.data ?? [];
  const roleOptions = useMemo(() => (rolesQuery.data ?? []).map((r) => ({ label: r.name, value: r.id })), [rolesQuery.data]);
  const publishMutation = usePublishChannelMessage();
  const testSendMutation = useTestSendChannelMessage();
  const saveTemplateMutation = useSaveChannelTemplate();
  const audienceEstimateMutation = useAudienceEstimate();

  const card = editing?.extra?.card ?? null;
  const initSendMode: ChannelSendMode = editing?.status === 'draft'
    ? 'draft'
    : editing?.status === 'scheduled' ? 'scheduled' : 'now';

  useEffect(() => {
    if (!visible) return;
    setContent({
      title: editing?.title ?? '',
      content: editing && editing.type !== 'image' && editing.type !== 'news' ? (editing.content ?? '') : '',
      imageUrl: editing?.type === 'image' ? (editing?.content ?? '') : '',
      cover: card?.cover ?? '',
      summary: card?.text ?? '',
      linkUrl: card?.actions?.[0]?.url ?? '',
      bodyHtml: card?.bodyHtml ?? '',
    });
    setModalType(editing?.type === 'news' ? 'news' : editing?.type === 'image' ? 'image' : 'text');
    setAudienceSel({ mode: 'all', userIds: [], departmentIds: [], roleIds: [] });
    setEstimateCount(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing?.id]);

  const audienceKey = JSON.stringify(audienceSel);
  const estimateDebouncer = useDebouncer((audience: AudienceSelection) => {
    audienceEstimateMutation.mutateAsync({ body: { audience } })
      .then((res) => setEstimateCount(res.count))
      .catch(() => setEstimateCount(null));
  }, { wait: 300 });
  useEffect(() => {
    estimateDebouncer.cancel();
    if (!visible) return;
    const mode = audienceSel.mode;
    const userIds = audienceSel.userIds ?? [];
    const departmentIds = audienceSel.departmentIds ?? [];
    const roleIds = audienceSel.roleIds ?? [];

    if (mode === 'users' && userIds.length === 0) { setEstimateCount(0); return; }
    if (mode === 'departments' && departmentIds.length === 0) { setEstimateCount(0); return; }
    if (mode === 'roles' && roleIds.length === 0) { setEstimateCount(0); return; }

    const audience: AudienceSelection = { mode };
    if (mode === 'users') audience.userIds = userIds;
    if (mode === 'departments') audience.departmentIds = departmentIds;
    if (mode === 'roles') audience.roleIds = roleIds;

    estimateDebouncer.maybeExecute(audience);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, audienceKey]);

  const initValues: PublishFormValues = {
    type: (editing?.type === 'news' ? 'news' : editing?.type === 'image' ? 'image' : 'text'),
    audienceMode: 'all',
    userIds: [],
    departmentIds: [],
    roleIds: [],
    sendMode: initSendMode,
    scheduledAt: toDateValue(editing?.scheduledAt) ?? null,
  };

  const buildBody = (values: PublishFormValues) => {
    const type = values.type;
    const contentErr = validateChannelContent(type, content, { requireCover: true });
    if (contentErr) { Toast.error(contentErr); return null; }
    const text = content.content.trim();
    const title = content.title.trim();

    const mode = values.audienceMode;
    if (mode === 'users' && !(values.userIds?.length)) { Toast.error('请选择指定用户'); return null; }
    if (mode === 'departments' && !(values.departmentIds?.length)) { Toast.error('请选择部门'); return null; }
    if (mode === 'roles' && !(values.roleIds?.length)) { Toast.error('请选择角色'); return null; }

    if (values.sendMode === 'scheduled' && !values.scheduledAt) { Toast.error('请选择定时发送时间'); return null; }

    const audience: {
      mode: ChannelPublishAudienceMode;
      userIds?: number[];
      departmentIds?: number[];
      roleIds?: number[];
    } = { mode };
    if (mode === 'users') audience.userIds = values.userIds;
    if (mode === 'departments') audience.departmentIds = values.departmentIds;
    if (mode === 'roles') audience.roleIds = values.roleIds;

    return {
      type,
      title: type === 'news' ? title : (title || null),
      content: type === 'image' || type === 'news' ? '' : text,
      bodyHtml: type === 'news' ? (content.bodyHtml.trim() || null) : null,
      imageUrl: type === 'image' ? (content.imageUrl || null) : null,
      cover: type === 'news' ? (content.cover || null) : null,
      summary: type === 'news' ? (content.summary.trim() || null) : null,
      linkUrl: type === 'news' ? (content.linkUrl.trim() || null) : null,
      audience,
      sendMode: values.sendMode,
      scheduledAt: values.sendMode === 'scheduled' && values.scheduledAt
        ? formatDateTimeForApi(values.scheduledAt as Date)
        : null,
    };
  };

  const handleSubmit = async () => {
    if (!formApi || !channel) return;
    let values: PublishFormValues;
    try {
      values = await formApi.validate();
    } catch {
      return;
    }

    const body = buildBody(values);
    if (!body) return;

    await publishMutation.mutateAsync({ channelId: channel.id, id: editing?.id, values: body });
    const okMsg = values.sendMode === 'draft' ? '已保存草稿'
      : values.sendMode === 'scheduled' ? '已设置定时发送' : '已群发';
    Toast.success(editing ? '已保存' : okMsg);
    onClose();
    onSuccess();
  };

  const handleTestSend = async () => {
    if (!formApi || !channel) return;
    let values: PublishFormValues;
    try {
      values = await formApi.validate();
    } catch {
      return;
    }
    const body = buildBody(values);
    if (!body) return;

    await testSendMutation.mutateAsync({ params: { id: channel.id }, body });
    Toast.success('测试消息已发送，请在消息中心查看');
  };

  /** 把当前表单内容抽取为模板内容（不含受众/发送方式） */
  const buildTemplateContent = (values: PublishFormValues): {
    type: PublishType;
    title: string | null;
    content: string;
    extra: ChatMessageExtra | null;
  } => {
    const type = values.type;
    const title = content.title.trim();
    if (type === 'image') {
      return { type, title: null, content: content.imageUrl, extra: null };
    }
    if (type === 'news') {
      const summary = content.summary.trim();
      const linkUrl = content.linkUrl.trim();
      const card: ChatCard = {
        title,
        cover: content.cover || null,
        bodyHtml: content.bodyHtml.trim() || null,
        text: summary || null,
        actions: linkUrl
          ? [{ key: 'link', label: '查看详情', action: 'link', url: linkUrl }]
          : [],
      };
      return { type, title: title || null, content: '', extra: { card } };
    }
    return { type: 'text', title: title || null, content: content.content.trim(), extra: null };
  };

  /** 把模板内容回填到本地内容状态，实现 保存→载入→发布 的内容往返 */
  const applyTemplate = (tpl: ChannelMessageTemplate) => {
    if (!formApi) return;
    const type: PublishType = tpl.type === 'news' ? 'news' : tpl.type === 'image' ? 'image' : 'text';
    setModalType(type);
    formApi.setValue('type', type);
    if (type === 'image') {
      setContent({ ...EMPTY_CHANNEL_CONTENT, imageUrl: tpl.content ?? '' });
    } else if (type === 'news') {
      const tplCard = tpl.extra?.card ?? null;
      setContent({
        ...EMPTY_CHANNEL_CONTENT,
        title: tpl.title ?? '',
        cover: tplCard?.cover ?? '',
        bodyHtml: tplCard?.bodyHtml ?? '',
        summary: tplCard?.text ?? '',
        linkUrl: tplCard?.actions?.[0]?.url ?? '',
      });
    } else {
      setContent({ ...EMPTY_CHANNEL_CONTENT, title: tpl.title ?? '', content: tpl.content ?? '' });
    }
    Toast.success(`已载入模板「${tpl.name}」`);
  };

  const handleSaveTemplate = async () => {
    if (!formApi) return;
    const name = saveTplName.trim();
    if (!name) { Toast.error('请填写模板名称'); return; }
    const values = formApi.getValues();
    const tpl = buildTemplateContent(values);
    if (tpl.type === 'text' && !tpl.content) { Toast.error('请先填写文本内容'); return; }
    if (tpl.type === 'image' && !tpl.content) { Toast.error('请先上传图片'); return; }
    if (tpl.type === 'news' && !tpl.title) { Toast.error('图文模板请先填写标题'); return; }

    await saveTemplateMutation.mutateAsync({ values: { name, ...tpl } });
    Toast.success('已存为模板');
    setSaveTplVisible(false);
    setSaveTplName('');
  };

  const titleText = editing ? '编辑消息' : `向「${channel?.name ?? ''}」群发`;

  const templateOptions = templates.map((t) => ({
    label: `${t.name}（${TYPE_OPTIONS.find((o) => o.value === t.type)?.label ?? t.type}）`,
    value: t.id,
  }));

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Space>
        <Button
          icon={<Send size={14} />}
          loading={testSendMutation.isPending}
          disabled={publishMutation.isPending}
          onClick={() => void handleTestSend()}
        >
          测试发送
        </Button>
        {modalType === 'news' && (
          <Button icon={<Eye size={14} />} onClick={() => setPreviewVisible(true)}>
            预览
          </Button>
        )}
      </Space>
      <Space>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" loading={publishMutation.isPending} onClick={() => void handleSubmit()}>
          {editing ? '保存' : '提交'}
        </Button>
      </Space>
    </div>
  );

  return (
    <>
    <SideSheet
      title={titleText}
      visible={visible}
      onCancel={onClose}
      footer={footer}
      closeOnEsc
      width="min(1100px, 96vw)"
    >
      <Form<PublishFormValues>
        key={editing?.id ?? channel?.id ?? 'new'}
        getFormApi={(api) => setFormApi(api as FormApi<PublishFormValues>)}
        labelPosition="left"
        labelWidth={90}
        initValues={initValues}
        onValueChange={(vals) => {
          const v = vals as PublishFormValues;
          setModalType(v.type ?? 'text');
          setAudienceSel({
            mode: v.audienceMode ?? 'all',
            userIds: v.userIds ?? [],
            departmentIds: v.departmentIds ?? [],
            roleIds: v.roleIds ?? [],
          });
        }}
      >
        {({ formState }) => {
          const values = formState.values as PublishFormValues;
          const type = values.type ?? 'text';
          const audienceMode = values.audienceMode ?? 'all';
          const sendMode = values.sendMode ?? 'now';
          return (
            <>
              <Form.Slot label="从模板载入">
                <Space wrap>
                  <Select
                    placeholder="选择模板载入内容"
                    style={{ width: 220 }}
                    optionList={templateOptions}
                    showClear
                    filter
                    value={undefined}
                    onChange={(val) => {
                      const tpl = templates.find((t) => t.id === (val as unknown as number));
                      if (tpl) applyTemplate(tpl);
                    }}
                    emptyContent="暂无模板"
                  />
                  <Button icon={<Save size={14} />} onClick={() => { setSaveTplName(''); setSaveTplVisible(true); }}>
                    存为模板
                  </Button>
                  <Button theme="borderless" icon={<Settings2 size={14} />} onClick={() => setTplDrawerVisible(true)}>
                    模板管理
                  </Button>
                </Space>
              </Form.Slot>

              <Form.RadioGroup field="type" label="消息类型" type="button">
                {TYPE_OPTIONS.map((o) => (
                  <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
                ))}
              </Form.RadioGroup>

              {(() => {
                const sendSettings = (
                  <>
                    <Form.Select field="audienceMode" label="接收范围" style={{ width: '100%' }} optionList={AUDIENCE_OPTIONS} />
                    {audienceMode === 'users' && (
                      <FormUserSelect field="userIds" label="指定用户" multiple placeholder="请选择用户" />
                    )}
                    {audienceMode === 'departments' && (
                      <FormDeptSelect field="departmentIds" label="选择部门" multiple placeholder="请选择部门" />
                    )}
                    {audienceMode === 'roles' && (
                      <Form.Select field="roleIds" label="选择角色" multiple filter style={{ width: '100%' }} placeholder="请选择角色" optionList={roleOptions} maxTagCount={3} />
                    )}

                    <Form.Slot label=" ">
                      <Space align="center" style={{ color: 'var(--semi-color-text-2)' }}>
                        <Users size={14} />
                        <Typography.Text type="tertiary" size="small">
                          {audienceEstimateMutation.isPending
                            ? '计算中...'
                            : <>预计触达 <Typography.Text strong>{estimateCount ?? '-'}</Typography.Text> 人</>}
                        </Typography.Text>
                      </Space>
                    </Form.Slot>

                    <Form.RadioGroup field="sendMode" label="发送方式" type="button">
                      {SEND_OPTIONS.map((o) => (
                        <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
                      ))}
                    </Form.RadioGroup>
                    {sendMode === 'scheduled' && (
                      <Form.DatePicker
                        field="scheduledAt"
                        label="定时时间"
                        type="dateTime"
                        style={{ width: '100%' }}
                        position="topLeft"
                        rules={[{ required: true, message: '请选择定时发送时间' }]}
                      />
                    )}
                  </>
                );


                if (type === 'news') {
                  return (
                    <>
                      <Row gutter={24}>
                        <Col span={12}><ChannelContentFields type="news" value={content} onChange={updateContent} /></Col>
                        <Col span={12}>{sendSettings}</Col>
                      </Row>
                      {/* 正文整行独占，给富文本最大编辑空间；预览走底部「预览」按钮弹窗 */}
                      <ChannelNewsBodyField value={content} onChange={updateContent} height={440} />
                    </>
                  );
                }

                return (
                  <Row gutter={24}>
                    <Col span={12}>
                      <ChannelContentFields type={type} value={content} onChange={updateContent} showTextTitle />
                    </Col>
                    <Col span={12}>{sendSettings}</Col>
                  </Row>
                );
              })()}
            </>
          );
        }}
      </Form>
    </SideSheet>

    <AppModal
      title="存为模板"
      visible={saveTplVisible}
      onCancel={() => setSaveTplVisible(false)}
      onOk={() => void handleSaveTemplate()}
      okText="保存"
      confirmLoading={saveTemplateMutation.isPending}
      width={420}
    >
      <Input
        placeholder="请输入模板名称"
        value={saveTplName}
        onChange={setSaveTplName}
        maxLength={100}
        showClear
      />
    </AppModal>

    <ChannelTemplateDrawer
      visible={tplDrawerVisible}
      onClose={() => setTplDrawerVisible(false)}
      onChanged={() => void templatesQuery.refetch()}
    />

    <ChannelNewsPreviewModal
      visible={previewVisible}
      onCancel={() => setPreviewVisible(false)}
      value={content}
    />
    </>
  );
}

export default ChannelPublishModal;
