import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Button, Collapse, Form, Modal, Space, Spin, Steps, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ArrowLeft, Eye, EyeOff, Sparkles } from 'lucide-react';
import { CMS_INTERACTION_REPEAT_POLICY_OPTIONS, cmsSlugRegex, CMS_INTERACTION_KIND_OPTIONS, CMS_INTERACTION_PARTICIPANT_SCOPE_OPTIONS, CMS_INTERACTION_RESULT_VISIBILITY_OPTIONS, CMS_INTERACTION_CAPTCHA_POLICY_OPTIONS } from '@zenith/shared/cms';
import type { CmsInteractionKind, CmsInteractionStatus } from '@zenith/shared/cms';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { mediaUp } from '@/lib/breakpoints';
import { usePermission } from '@/hooks/usePermission';
import { useCmsInteractionDetail, useSaveCmsInteraction } from '@/hooks/queries/cms';
import { formatDateTimeForApi } from '@/utils/date';
import { slugifyName } from '@/utils/slug';
import InteractionPreview from './InteractionPreview';
import QuestionDesigner from './QuestionDesigner';
import { INTERACTION_TEMPLATES } from './interaction-templates';
import {
  applyQuestionType,
  createQuestion,
  normalizeQuestions,
  questionToDraft,
  validateQuestionSet,
  validateQuestions,
  type QuestionDraft,
} from './question-draft';
import './interaction-editor.css';

export interface InteractionFormValues {
  kind: CmsInteractionKind;
  code: string;
  title: string;
  description?: string;
  status: CmsInteractionStatus;
  participantScope: 'anonymous' | 'member';
  repeatPolicy: 'once_per_member' | 'once_per_ip' | 'multiple';
  resultVisibility: 'always' | 'after_submit' | 'after_close' | 'hidden';
  captchaPolicy: 'inherit' | 'none' | 'math' | 'turnstile';
  turnstileSiteKey?: string;
  turnstileSecret?: string;
  thankYouMessage: string;
  startAt?: Date | string;
  endAt?: Date | string;
}

const LIST_PATH = '/cms/interactions';

const STEPS = [
  { title: '基本信息', description: '类型 / 标题 / 访问标识' },
  { title: '题目设计', description: '题干 / 选项 / 必答' },
  { title: '参与与展示', description: '参与范围 / 结果 / 时间' },
];

/** 每一步归属的表单字段：用于「下一步」分步校验与保存失败时定位步骤 */
const STEP_FIELDS: (keyof InteractionFormValues)[][] = [
  ['kind', 'title', 'code', 'description'],
  [],
  [
    'participantScope', 'repeatPolicy', 'resultVisibility', 'captchaPolicy',
    'turnstileSiteKey', 'turnstileSecret', 'thankYouMessage', 'startAt', 'endAt', 'status',
  ],
];

const DEFAULT_VALUES: InteractionFormValues = {
  kind: 'survey',
  code: '',
  title: '',
  description: '',
  status: 'draft',
  participantScope: 'anonymous',
  repeatPolicy: 'once_per_ip',
  resultVisibility: 'after_submit',
  captchaPolicy: 'inherit',
  turnstileSiteKey: '',
  turnstileSecret: '',
  thankYouMessage: '感谢您的参与！',
  startAt: undefined,
  endAt: undefined,
};

/** 从 Semi validate 的 reject 值中取出出错字段名 */
function errorFieldsOf(err: unknown): string[] {
  if (!err || typeof err !== 'object') return [];
  const record = err as Record<string, unknown>;
  const source = record.errors && typeof record.errors === 'object'
    ? record.errors as Record<string, unknown>
    : record;
  return Object.keys(source);
}

/**
 * 互动问卷设计页。
 *
 * 分步表单 + 题目设计 + 前台预览三块内容同屏，弹窗承载不下，因此独立成页：
 * 由「互动问卷」列表页以 `?id=`（编辑）或 `?siteId=`（新增）跳入。
 */
export default function InteractionEditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = usePermission();
  const editingId = Number(searchParams.get('id')) || undefined;
  const routeSiteId = Number(searchParams.get('siteId')) || undefined;

  // useEditModal 例外：整页编辑器（路由页，保存后跳转列表）；详情到达后经 formKey 重挂载
  const formApi = useRef<FormApi<InteractionFormValues> | null>(null);
  /** 用户是否手动改过访问标识：手改后不再由标题自动生成 */
  const codeTouched = useRef(false);
  /** 标记「本次 code 变更来自自动生成」，避免误判为用户手改 */
  const autoCoding = useRef(false);

  const [step, setStep] = useState(0);
  const [showPreview, setShowPreview] = useState(true);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [questionErrors, setQuestionErrors] = useState<Map<string, string>>(new Map());
  const [live, setLive] = useState<InteractionFormValues>(DEFAULT_VALUES);
  const [formKey, setFormKey] = useState('new');

  const canShowPreview = useMediaQuery(mediaUp('lg'));
  const detailQuery = useCmsInteractionDetail(editingId, !!editingId);
  const editingDetail = detailQuery.data;
  const saveMutation = useSaveCmsInteraction();
  const questionsLocked = (editingDetail?.responseCount ?? 0) > 0;
  const kind = live.kind;
  const siteId = editingDetail?.siteId ?? routeSiteId;
  const canSave = hasPermission('cms:interaction:manage');

  useEffect(() => {
    // 编辑态需等详情返回后再初始化，避免用空数据填充题目
    if (editingId && !detailQuery.data) return;
    const detail = editingId ? detailQuery.data! : null;
    const values: InteractionFormValues = detail
      ? {
          kind: detail.kind,
          code: detail.code,
          title: detail.title,
          description: detail.description ?? '',
          status: detail.status,
          participantScope: detail.participantScope,
          repeatPolicy: detail.repeatPolicy,
          resultVisibility: detail.resultVisibility,
          captchaPolicy: detail.captchaPolicy,
          turnstileSiteKey: detail.turnstileSiteKey ?? '',
          turnstileSecret: '',
          thankYouMessage: detail.thankYouMessage,
          startAt: detail.startAt ?? undefined,
          endAt: detail.endAt ?? undefined,
        }
      : { ...DEFAULT_VALUES };
    setStep(0);
    setQuestionErrors(new Map());
    setLive(values);
    setQuestions(detail ? (detail.questions ?? []).map(questionToDraft) : [createQuestion('single')]);
    setFormKey(`${detail?.id ?? 'new'}-${Date.now()}`);
    codeTouched.current = !!detail;
  }, [editingId, detailQuery.data]);

  const initValues = live;

  const goBack = () => navigate(LIST_PATH);

  /** 类型切到投票时收敛为单道选择题 */
  const handleKindChange = (value: CmsInteractionKind) => {
    if (value !== 'poll') return;
    setQuestions((current) => {
      const first = current[0] ?? createQuestion('single');
      const normalized = first.type === 'single' || first.type === 'multiple'
        ? first
        : applyQuestionType(first, 'single');
      return [{ ...normalized, pageNo: 1, visibleWhen: null }];
    });
    setQuestionErrors(new Map());
  };

  const handleValueChange = (values: InteractionFormValues, changed: Partial<InteractionFormValues>) => {
    const changedKeys = Object.keys(changed) as (keyof InteractionFormValues)[];
    if (changedKeys.includes('code')) {
      if (autoCoding.current) autoCoding.current = false;
      else codeTouched.current = true;
    }
    // 新增时由标题自动生成访问标识（用户手改过则不再覆盖）
    if (changedKeys.includes('title') && !editingId && !codeTouched.current) {
      const slug = slugifyName(String(changed.title ?? ''), 50);
      if (slug && slug !== values.code) {
        autoCoding.current = true;
        formApi.current?.setValue('code', slug);
        values = { ...values, code: slug };
      }
    }
    // 「每位会员一次」仅适用于仅会员参与，切换参与范围时自动回退
    if (changedKeys.includes('participantScope')
      && values.participantScope !== 'member'
      && values.repeatPolicy === 'once_per_member') {
      formApi.current?.setValue('repeatPolicy', 'once_per_ip');
      values = { ...values, repeatPolicy: 'once_per_ip' };
    }
    if (changedKeys.includes('kind')) handleKindChange(values.kind);
    setLive(values);
  };

  const applyTemplate = (templateKey: string) => {
    const template = INTERACTION_TEMPLATES.find((item) => item.key === templateKey);
    if (!template) return;
    const apply = () => {
      setQuestions(template.build());
      setQuestionErrors(new Map());
      if (!formApi.current?.getValue('title')?.trim()) {
        formApi.current?.setValue('title', template.suggestedTitle);
        const slug = slugifyName(template.suggestedTitle, 50);
        if (slug && !codeTouched.current && !editingId) {
          autoCoding.current = true;
          formApi.current?.setValue('code', slug);
        }
        setLive((current) => ({ ...current, title: template.suggestedTitle }));
      }
      Toast.success(`已套用模板「${template.name}」`);
    };
    const hasContent = questions.some((question) => question.label.trim());
    if (hasContent) {
      Modal.confirm({
        title: `套用模板「${template.name}」？`,
        content: '当前已填写的题目会被模板内容覆盖。',
        onOk: apply,
      });
      return;
    }
    apply();
  };

  /** 题目区校验，返回是否通过 */
  const checkQuestions = () => {
    if (questionsLocked) return true;
    const perQuestion = validateQuestions(questions, kind);
    setQuestionErrors(perQuestion);
    const setError = validateQuestionSet(questions, kind);
    if (setError) {
      Toast.warning(setError);
      return false;
    }
    return perQuestion.size === 0;
  };

  const goNext = async () => {
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      try {
        await formApi.current?.validate(fields);
      } catch {
        return;
      }
    }
    if (step === 1 && !checkQuestions()) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const handleSave = async () => {
    if (!siteId) {
      Toast.warning('缺少站点信息，请从互动问卷列表重新进入');
      return;
    }
    let values: InteractionFormValues;
    try {
      values = await formApi.current!.validate() as InteractionFormValues;
    } catch (err) {
      const fields = errorFieldsOf(err);
      const failedStep = STEP_FIELDS.findIndex((stepFields) => stepFields.some((field) => fields.includes(field)));
      if (failedStep >= 0) setStep(failedStep);
      return;
    }
    if (!checkQuestions()) {
      setStep(1);
      return;
    }
    const payload: Record<string, unknown> = {
      ...values,
      kind,
      description: values.description || null,
      startAt: values.startAt instanceof Date ? formatDateTimeForApi(values.startAt) : (values.startAt || null),
      endAt: values.endAt instanceof Date ? formatDateTimeForApi(values.endAt) : (values.endAt || null),
      ...(questionsLocked ? {} : { questions: normalizeQuestions(questions) }),
      ...(editingId ? {} : { siteId }),
    };
    if (!values.turnstileSecret?.trim()) delete payload.turnstileSecret;
    await saveMutation.mutateAsync({ id: editingId, values: payload });
    Toast.success(editingId ? '更新成功' : '创建成功');
    goBack();
  };

  const isTurnstile = live.captchaPolicy === 'turnstile';
  const templates = INTERACTION_TEMPLATES.filter((template) => template.kind === kind);

  return (
    <div className="page-container page-container--stretch interaction-editor-page">
      <div className="interaction-editor-page__header">
        <Space wrap>
          <Button icon={<ArrowLeft size={14} />} onClick={goBack}>返回</Button>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {editingId ? (editingDetail?.title ? `设计：${editingDetail.title}` : '互动问卷设计') : '新增互动问卷'}
          </Typography.Title>
        </Space>
      </div>

      <Spin spinning={!!editingId && detailQuery.isFetching} wrapperClassName="interaction-editor__spin">
        <div className="interaction-editor">
          <Steps type="basic" size="small" current={step} onChange={setStep}>
            {STEPS.map((item) => (
              <Steps.Step key={item.title} title={item.title} description={item.description} />
            ))}
          </Steps>

          {questionsLocked ? (
            <Banner
              type="warning"
              closeIcon={null}
              description={`已收集 ${editingDetail?.responseCount ?? 0} 份答卷，题目结构已锁定；仍可调整标题、时间、状态与展示策略。`}
            />
          ) : null}

          <div className="interaction-editor__body">
            <div className="interaction-editor__main">
              <Form<InteractionFormValues>
                key={formKey}
                getFormApi={(api) => { formApi.current = api; }}
                labelPosition="top"
                allowEmpty
                initValues={initValues}
                onValueChange={handleValueChange}
              >
                <div style={{ display: step === 0 ? 'block' : 'none' }}>
                  <div className="interaction-form-grid">
                    <Form.Select
                      field="kind"
                      label="互动类型"
                      disabled={!!editingId}
                      style={{ width: '100%' }}
                      extraText={kind === 'poll' ? '投票只含一道选择题，前台直接展示得票分布' : '问卷可包含多道单选/多选/文本题'}
                      optionList={CMS_INTERACTION_KIND_OPTIONS}
                    />
                    <Form.Input
                      field="code"
                      label="访问标识"
                      disabled={!!editingId}
                      rules={[
                        { required: true, message: '请输入访问标识' },
                        { pattern: cmsSlugRegex, message: '标识仅支持小写字母、数字、中划线' },
                        { max: 50, message: '标识最多 50 个字符' },
                      ]}
                      extraText="前台地址 /interaction/{标识}/；正文用 [互动:标识] 嵌入。留空由标题自动生成"
                    />
                  </div>
                  <Form.Input
                    field="title"
                    label="标题"
                    size="large"
                    rules={[{ required: true, message: '请输入标题' }]}
                  />
                  <Form.TextArea field="description" label="说明" rows={3} maxCount={2000} />
                </div>

                <div style={{ display: step === 2 ? 'block' : 'none' }}>
                  <div className="interaction-form-grid">
                    <Form.Select
                      field="participantScope"
                      label="参与范围"
                      style={{ width: '100%' }}
                      optionList={CMS_INTERACTION_PARTICIPANT_SCOPE_OPTIONS}
                    />
                    <Form.Select
                      field="repeatPolicy"
                      label="重复提交"
                      style={{ width: '100%' }}
                      extraText={live.participantScope === 'member' ? undefined : '「每位会员一次」需先将参与范围设为仅会员'}
                      optionList={CMS_INTERACTION_REPEAT_POLICY_OPTIONS.map((option) => ({
                        ...option,
                        disabled: option.value === 'once_per_member' && live.participantScope !== 'member',
                      }))}
                    />
                    <Form.Select
                      field="resultVisibility"
                      label="结果可见性"
                      style={{ width: '100%' }}
                      optionList={CMS_INTERACTION_RESULT_VISIBILITY_OPTIONS}
                    />
                    <Form.Select
                      field="captchaPolicy"
                      label="验证码策略"
                      style={{ width: '100%' }}
                      optionList={CMS_INTERACTION_CAPTCHA_POLICY_OPTIONS}
                    />
                    <Form.DatePicker field="startAt" label="开始时间" type="dateTime" style={{ width: '100%' }} />
                    <Form.DatePicker field="endAt" label="结束时间" type="dateTime" style={{ width: '100%' }} />
                  </div>
                  <Form.Input
                    field="thankYouMessage"
                    label="提交后提示语"
                    rules={[{ required: true, message: '请输入提交后提示语' }]}
                  />
                  <Form.RadioGroup field="status" label="状态">
                    <Form.Radio value="draft">草稿</Form.Radio>
                    <Form.Radio value="published">进行中</Form.Radio>
                    <Form.Radio value="closed">已关闭</Form.Radio>
                  </Form.RadioGroup>
                  <Collapse activeKey={isTurnstile ? 'turnstile' : undefined} keepDOM>
                    <Collapse.Panel header="Cloudflare Turnstile（高级）" itemKey="turnstile">
                      <Form.Input
                        field="turnstileSiteKey"
                        label="Turnstile Site Key"
                        disabled={!isTurnstile}
                        rules={isTurnstile ? [{ required: true, message: '请配置 Turnstile Site Key' }] : []}
                        extraText="仅验证码策略为 Cloudflare Turnstile 时生效"
                      />
                      <Form.Input
                        field="turnstileSecret"
                        label="Turnstile Secret Key"
                        mode="password"
                        disabled={!isTurnstile}
                        rules={isTurnstile && !editingDetail?.turnstileSecretConfigured
                          ? [{ required: true, message: '请配置 Turnstile Secret Key' }]
                          : []}
                        placeholder={editingDetail?.turnstileSecretConfigured ? '已配置，留空保持不变' : '仅服务端保存，不会回显'}
                      />
                    </Collapse.Panel>
                  </Collapse>
                </div>
              </Form>

              <div style={{ display: step === 1 ? 'block' : 'none' }}>
                {!questionsLocked && templates.length > 0 ? (
                  <div className="interaction-templates">
                    <Typography.Text type="tertiary" size="small" icon={<Sparkles size={13} />}>快速开始</Typography.Text>
                    {templates.map((template) => (
                      <Button key={template.key} size="small" onClick={() => applyTemplate(template.key)}>
                        {template.name}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <QuestionDesigner
                  questions={questions}
                  onChange={(next) => { setQuestions(next); setQuestionErrors(new Map()); }}
                  kind={kind}
                  locked={questionsLocked}
                  errors={questionErrors}
                />
              </div>
            </div>

            {showPreview && canShowPreview ? (
              <aside className="interaction-editor__side">
                <InteractionPreview
                  kind={kind}
                  title={live.title}
                  description={live.description}
                  questions={questions}
                  participantScope={live.participantScope}
                  thankYouMessage={live.thankYouMessage}
                />
              </aside>
            ) : null}
          </div>
        </div>
      </Spin>

      <div className="interaction-editor__footer">
        {canShowPreview ? (
          <Button
            theme="borderless"
            icon={showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setShowPreview((value) => !value)}
          >
            {showPreview ? '隐藏预览' : '显示预览'}
          </Button>
        ) : null}
        <span className="interaction-editor__footer-gap" />
        {step > 0 ? <Button onClick={() => setStep((current) => current - 1)}>上一步</Button> : null}
        {step < STEPS.length - 1 ? <Button type="primary" onClick={() => void goNext()}>下一步</Button> : null}
        <Button
          type="primary"
          theme="solid"
          disabled={!canSave}
          loading={saveMutation.isPending}
          onClick={() => void handleSave()}
        >
          {editingId ? '保存' : '创建'}
        </Button>
      </div>
    </div>
  );
}
