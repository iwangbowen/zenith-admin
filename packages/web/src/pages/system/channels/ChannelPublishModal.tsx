/**
 * 频道群发 / 草稿编辑 Modal
 *
 * 支持消息类型：文本（text）/ 图片（image）/ 图文（news）。
 * 支持受众：全员 / 指定用户 / 按部门 / 按角色。
 * 支持发送方式：立即发送 / 定时发送 / 存草稿。
 *
 * 复用：UserSelect（指定用户）、DepartmentSelect（按部门，TreeSelect），
 * 角色通过 /api/roles/all 加载为 Select multiple。
 * 封面图通过 /api/files/upload-one 上传得到 URL。
 */
import { useEffect, useState } from 'react';
import { Button, Form, Space, Toast, Typography, Upload, withField } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ImagePlus, Trash2, Users } from 'lucide-react';
import type {
  ChannelAdmin, ChannelMessage, ChannelMessageType, ChannelPublishAudienceMode, ChannelSendMode, Role,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { config } from '@/config';
import { formatDateTimeForApi } from '@/utils/date';
import { AppModal } from '@/components/AppModal';
import UserSelect from '@/components/UserSelect';
import DepartmentSelect from '@/components/DepartmentSelect';

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

interface PublishFormValues {
  type: ChannelMessageType;
  title?: string;
  content?: string;
  summary?: string;
  linkUrl?: string;
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
  const [submitting, setSubmitting] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [roleOptions, setRoleOptions] = useState<Array<{ label: string; value: number }>>([]);

  const [audienceSel, setAudienceSel] = useState<AudienceSelection>({
    mode: 'all', userIds: [], departmentIds: [], roleIds: [],
  });
  const [estimateCount, setEstimateCount] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);

  const card = editing?.extra?.card ?? null;
  const initSendMode: ChannelSendMode = editing?.status === 'draft'
    ? 'draft'
    : editing?.status === 'scheduled' ? 'scheduled' : 'now';

  useEffect(() => {
    if (!visible) return;
    setCoverUrl(card?.cover ?? '');
    setImageUrl(editing?.type === 'image' ? (editing?.content ?? '') : '');
    setAudienceSel({ mode: 'all', userIds: [], departmentIds: [], roleIds: [] });
    setEstimateCount(null);
    request.get<Role[]>('/api/roles/all', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) {
        setRoleOptions(res.data.map((r) => ({ label: r.name, value: r.id })));
      }
    });
  }, [visible, editing?.id, editing?.type, editing?.content, card?.cover]);

  const audienceKey = JSON.stringify(audienceSel);
  useEffect(() => {
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

    let cancelled = false;
    const timer = setTimeout(() => {
      setEstimating(true);
      request.post<{ count: number }>('/api/channels/audience-estimate', { audience }, { silent: true })
        .then((res) => {
          if (cancelled) return;
          setEstimateCount(res.code === 0 && res.data ? res.data.count : null);
        })
        .catch(() => { if (!cancelled) setEstimateCount(null); })
        .finally(() => { if (!cancelled) setEstimating(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, audienceKey]);

  const initValues: PublishFormValues = {
    type: (editing?.type === 'news' ? 'news' : editing?.type === 'image' ? 'image' : 'text'),
    title: editing?.title ?? '',
    content: editing?.type === 'image' ? '' : (editing?.content ?? ''),
    summary: card?.text ?? '',
    linkUrl: card?.actions?.[0]?.url ?? '',
    audienceMode: 'all',
    userIds: [],
    departmentIds: [],
    roleIds: [],
    sendMode: initSendMode,
    scheduledAt: toDateValue(editing?.scheduledAt) ?? null,
  };

  const handleUploadSuccess = (res: unknown) => {
    const r = res as { code?: number; data?: { url?: string } };
    if (r?.code === 0 && r.data?.url) {
      setCoverUrl(r.data.url);
      Toast.success('封面已上传');
    } else {
      Toast.error('封面上传失败');
    }
  };

  const handleImageUploadSuccess = (res: unknown) => {
    const r = res as { code?: number; data?: { url?: string } };
    if (r?.code === 0 && r.data?.url) {
      setImageUrl(r.data.url);
      Toast.success('图片已上传');
    } else {
      Toast.error('图片上传失败');
    }
  };

  const handleSubmit = async () => {
    if (!formApi || !channel) return;
    let values: PublishFormValues;
    try {
      values = await formApi.validate();
    } catch {
      return;
    }

    const type = values.type;
    const content = (values.content ?? '').trim();
    const title = (values.title ?? '').trim();

    if (type === 'text' && !content) { Toast.error('请填写文本内容'); return; }
    if (type === 'image' && !imageUrl) { Toast.error('请上传图片'); return; }
    if (type === 'news' && !title) { Toast.error('图文消息请填写标题'); return; }
    if (type === 'news' && !coverUrl) { Toast.error('请上传图文封面'); return; }

    const mode = values.audienceMode;
    if (mode === 'users' && !(values.userIds?.length)) { Toast.error('请选择指定用户'); return; }
    if (mode === 'departments' && !(values.departmentIds?.length)) { Toast.error('请选择部门'); return; }
    if (mode === 'roles' && !(values.roleIds?.length)) { Toast.error('请选择角色'); return; }

    if (values.sendMode === 'scheduled' && !values.scheduledAt) { Toast.error('请选择定时发送时间'); return; }

    const audience: {
      mode: ChannelPublishAudienceMode;
      userIds?: number[];
      departmentIds?: number[];
      roleIds?: number[];
    } = { mode };
    if (mode === 'users') audience.userIds = values.userIds;
    if (mode === 'departments') audience.departmentIds = values.departmentIds;
    if (mode === 'roles') audience.roleIds = values.roleIds;

    const body = {
      type,
      title: type === 'news' ? title : (title || null),
      content: type === 'image' ? '' : content,
      imageUrl: type === 'image' ? (imageUrl || null) : null,
      cover: type === 'news' ? (coverUrl || null) : null,
      summary: type === 'news' ? ((values.summary ?? '').trim() || null) : null,
      linkUrl: type === 'news' ? ((values.linkUrl ?? '').trim() || null) : null,
      audience,
      sendMode: values.sendMode,
      scheduledAt: values.sendMode === 'scheduled' && values.scheduledAt
        ? formatDateTimeForApi(values.scheduledAt as Date)
        : null,
    };

    setSubmitting(true);
    try {
      const res = editing
        ? await request.put(`/api/channels/admin/messages/${editing.id}`, body)
        : await request.post(`/api/channels/${channel.id}/publish`, body);
      if (res.code === 0) {
        const okMsg = values.sendMode === 'draft' ? '已保存草稿'
          : values.sendMode === 'scheduled' ? '已设置定时发送' : '已群发';
        Toast.success(editing ? '已保存' : okMsg);
        onClose();
        onSuccess();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const titleText = editing ? '编辑消息' : `向「${channel?.name ?? ''}」群发`;

  return (
    <AppModal
      title={titleText}
      visible={visible}
      onCancel={onClose}
      onOk={() => void handleSubmit()}
      confirmLoading={submitting}
      okText={editing ? '保存' : '提交'}
      width={620}
    >
      <Form<PublishFormValues>
        key={editing?.id ?? channel?.id ?? 'new'}
        getFormApi={(api) => setFormApi(api as FormApi<PublishFormValues>)}
        labelPosition="left"
        labelWidth={90}
        initValues={initValues}
        onValueChange={(vals) => {
          const v = vals as PublishFormValues;
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
              <Form.RadioGroup field="type" label="消息类型" type="button">
                {TYPE_OPTIONS.map((o) => (
                  <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
                ))}
              </Form.RadioGroup>

              {type === 'text' ? (
                <>
                  <Form.Input field="title" label="标题" placeholder="可选" />
                  <Form.TextArea field="content" label="内容" placeholder="请输入文本内容" autosize={{ minRows: 3, maxRows: 8 }} />
                </>
              ) : type === 'image' ? (
                <Form.Slot label="图片">
                  <Space align="start">
                    {imageUrl
                      ? (
                        <div style={{ position: 'relative' }}>
                          <img src={imageUrl} alt="图片" style={{ maxWidth: 240, maxHeight: 180, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--semi-color-border)' }} />
                          <Button
                            theme="borderless"
                            type="danger"
                            size="small"
                            icon={<Trash2 size={14} />}
                            style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.8)' }}
                            onClick={() => setImageUrl('')}
                          />
                        </div>
                      )
                      : (
                        <Upload
                          action={`${config.apiBaseUrl}/api/files/upload-one`}
                          headers={{ Authorization: `Bearer ${localStorage.getItem('zenith_token') ?? ''}` }}
                          name="file"
                          accept="image/*"
                          limit={1}
                          showUploadList={false}
                          onSuccess={handleImageUploadSuccess}
                        >
                          <Button icon={<ImagePlus size={14} />}>上传图片</Button>
                        </Upload>
                      )}
                  </Space>
                </Form.Slot>
              ) : (
                <>
                  <Form.Input field="title" label="标题" rules={[{ required: true, message: '请填写标题' }]} />
                  <Form.Slot label="封面图">
                    <Space align="start">
                      {coverUrl
                        ? (
                          <div style={{ position: 'relative' }}>
                            <img src={coverUrl} alt="封面" style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--semi-color-border)' }} />
                            <Button
                              theme="borderless"
                              type="danger"
                              size="small"
                              icon={<Trash2 size={14} />}
                              style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.8)' }}
                              onClick={() => setCoverUrl('')}
                            />
                          </div>
                        )
                        : (
                          <Upload
                            action={`${config.apiBaseUrl}/api/files/upload-one`}
                            headers={{ Authorization: `Bearer ${localStorage.getItem('zenith_token') ?? ''}` }}
                            name="file"
                            accept="image/*"
                            limit={1}
                            showUploadList={false}
                            onSuccess={handleUploadSuccess}
                          >
                            <Button icon={<ImagePlus size={14} />}>上传封面</Button>
                          </Upload>
                        )}
                    </Space>
                  </Form.Slot>
                  <Form.TextArea field="summary" label="摘要" placeholder="可选，列表摘要" autosize={{ minRows: 2, maxRows: 3 }} />
                  <Form.TextArea field="content" label="正文" placeholder="图文正文内容" autosize={{ minRows: 3, maxRows: 8 }} />
                  <Form.Input field="linkUrl" label="跳转链接" placeholder="可选，点击图文跳转的 URL" />

                  <Form.Slot label="预览">
                    <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, overflow: 'hidden', width: 320 }}>
                      {coverUrl && <img src={coverUrl} alt="封面预览" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />}
                      <div style={{ padding: 12 }}>
                        <Typography.Title heading={6} style={{ margin: 0 }}>{(values.title ?? '').trim() || '图文标题'}</Typography.Title>
                        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
                          {(values.summary ?? '').trim() || '图文摘要'}
                        </Typography.Text>
                      </div>
                    </div>
                  </Form.Slot>
                </>
              )}

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
                    {estimating
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
        }}
      </Form>
    </AppModal>
  );
}

export default ChannelPublishModal;
