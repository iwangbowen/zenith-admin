import { useState } from 'react';
import { Banner, Button, Checkbox, Empty, Input, Select, Space, TabPane, Tabs, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { CmsContent, CmsModel } from '@zenith/shared/cms';
import { usePermission } from '@/hooks/usePermission';
import UserSelect from '@/components/UserSelect';
import { confirmDanger } from '@/utils/confirm';
import {
  useCmsEditorialNotes, useAddCmsEditorialNote, useResolveCmsEditorialNote, useCmsQuality,
  useCmsTranslations, useCreateCmsTranslation, useCmsDistributionConflict, useResolveCmsDistribution,
  usePreviewCmsTypeConversion, useConvertCmsType,
} from '@/hooks/queries/cms-editorial';

export default function CmsEditorialPanel({ content, models, onChanged, onOpen, disabled = false }: Readonly<{
  content?: CmsContent; models: CmsModel[]; onChanged: () => void; onOpen: (id: number) => void; disabled?: boolean;
}>) {
  const { hasPermission } = usePermission();
  const notes = useCmsEditorialNotes(content?.id);
  const quality = useCmsQuality(content?.id);
  const translations = useCmsTranslations(content?.id);
  const conflict = useCmsDistributionConflict(content?.id, !!content?.distributionSourceId || !!content?.mappingSourceId);
  const addNote = useAddCmsEditorialNote();
  const resolveNote = useResolveCmsEditorialNote();
  const createTranslation = useCreateCmsTranslation();
  const resolveDistribution = useResolveCmsDistribution();
  const previewConversion = usePreviewCmsTypeConversion();
  const convertType = useConvertCmsType();
  const [message, setMessage] = useState('');
  const [fieldPath, setFieldPath] = useState<string>();
  const [mentions, setMentions] = useState<number[]>([]);
  const [locale, setLocale] = useState('en-US');
  const [translationTitle, setTranslationTitle] = useState('');
  const [choices, setChoices] = useState<Record<string, 'source' | 'target'>>({});
  const [targetModel, setTargetModel] = useState<number>();
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [acknowledgeLoss, setAcknowledgeLoss] = useState(false);
  const canEdit = hasPermission('cms:content:update') && !disabled && !content?.lockedAt;
  const canNote = (canEdit || hasPermission('cms:content:audit')) && !disabled;
  const targetFields = models.find((model) => model.id === targetModel)?.fields ?? [];
  if (!content) return <Empty title="保存工作稿后开始协作" description="批注、检查和语言变体都关联具体稿件。" />;
  return <div style={{ padding: 16 }}>
    {disabled ? <Banner type="warning" description="请先保存当前修改，再执行协作中的内容变更。" /> : null}
    <Tabs collapsible="auto" type="line">
      <TabPane tab={`质量检查（${quality.data?.issues.length ?? 0}）`} itemKey="quality">
        <Space vertical align="start" style={{ width: '100%' }}>
          <Space><Typography.Text>检查已保存工作稿 v{quality.data?.version ?? content.version}</Typography.Text><Button loading={quality.isFetching} onClick={() => void quality.refetch()}>重新检查</Button></Space>
          {quality.isError ? <Banner type="danger" description="质量检查失败，请重试。" /> : null}
          {quality.data?.issues.length === 0 ? <Banner type="success" description="当前稿件通过质量检查。发布前仍会重新校验修订与依赖。" /> : null}
          {quality.data?.issues.map((issue, index) => <Banner key={`${issue.rule}-${issue.fieldPath}-${index}`} type={issue.severity === 'error' ? 'danger' : 'warning'} closeIcon={null} description={<Space wrap><Typography.Text strong>{issue.fieldPath || '稿件'}</Typography.Text><span>{issue.message}</span></Space>} />)}
        </Space>
      </TabPane>
      <TabPane tab={`审稿批注（${notes.data?.filter((note) => !note.resolved).length ?? 0}）`} itemKey="notes">
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          {notes.isError ? <Banner type="danger" description="批注加载失败" /> : null}
          {(notes.data ?? []).map((note) => <div key={note.id} style={{ width: '100%', paddingBottom: 12, borderBottom: '1px solid var(--semi-color-border)' }}>
            <Space wrap><Tag color={note.resolved ? 'green' : 'orange'}>{note.resolved ? '已处理' : '待处理'}</Tag><Typography.Text strong>{note.createdByName ?? '审稿人'}</Typography.Text><Typography.Text type="tertiary">{note.createdAt} · {note.fieldPath ?? '整篇'}{note.revisionId ? ` · 修订 #${note.revisionId}` : ' · 工作稿'}</Typography.Text></Space>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{note.message}</Typography.Paragraph>
            {canNote ? <Button size="small" loading={resolveNote.isPending} onClick={() => void resolveNote.mutateAsync({ params: { id: content.id, noteId: note.id }, body: { resolved: !note.resolved } })}>{note.resolved ? '重新打开' : '标为已处理'}</Button> : null}
          </div>)}
          {canNote ? <Space vertical align="start" style={{ width: '100%' }}>
            <Select showClear value={fieldPath} onChange={(value) => setFieldPath(value == null ? undefined : String(value))} placeholder="整篇批注或选择字段" style={{ width: '100%' }} optionList={[{ value: 'title', label: '标题' }, { value: 'body', label: '正文' }, { value: 'attachments', label: '附件' }, ...(content.modelFields ?? []).map((field) => ({ value: `extend.${field.name}`, label: field.label }))]} />
            <TextArea value={message} onChange={setMessage} placeholder="输入审稿意见" maxCount={5000} style={{ width: '100%' }} />
            <UserSelect multiple value={mentions} onChange={(value) => setMentions(Array.isArray(value) ? value : [])} placeholder="提醒相关人员（可选）" />
            <Button type="primary" disabled={!message.trim()} loading={addNote.isPending} onClick={async () => { await addNote.mutateAsync({ params: { id: content.id }, body: { message: message.trim(), fieldPath, mentionedUserIds: mentions, revisionId: content.submittedRevisionId ?? undefined } }); setMessage(''); Toast.success('批注已添加'); }}>添加批注</Button>
          </Space> : null}
        </Space>
      </TabPane>
      <TabPane tab="语言变体" itemKey="languages">
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <Typography.Paragraph>每种语言独立编辑、审核与发布，来源修订更新后会提示译文需要复核。</Typography.Paragraph>
          {(translations.data ?? []).map((variant) => <Space key={variant.id} wrap><Tag>{variant.locale}</Tag><Button theme="borderless" onClick={() => onOpen(variant.id)}>{variant.title}</Button>{variant.sourceChanged ? <Tag color="orange">源稿已更新</Tag> : null}</Space>)}
          {hasPermission('cms:content:create') ? <Space wrap><Input aria-label="目标语言" placeholder="语言，如 en-US" value={locale} onChange={setLocale} style={{ width: 150 }} /><Input aria-label="译文标题" placeholder="译文标题" value={translationTitle} onChange={setTranslationTitle} style={{ width: 260 }} /><Button disabled={disabled || !locale.trim() || !translationTitle.trim()} loading={createTranslation.isPending} onClick={async () => { const result = await createTranslation.mutateAsync({ params: { id: content.id }, body: { locale, title: translationTitle, channelId: content.channelId } }); Toast.success('语言工作稿已创建'); onOpen(result.id); }}>创建人工翻译稿</Button></Space> : null}
        </Space>
      </TabPane>
      {content.distributionSourceId || content.mappingSourceId ? <TabPane tab="来源同步" itemKey="distribution">
        <Space vertical align="start" style={{ width: '100%' }}>
          <Typography.Paragraph>逐字段比较上次同步基线、当前目标稿与来源新稿。合并只写入工作稿。</Typography.Paragraph>
          {conflict.isError ? <Banner type="danger" description="同步差异加载失败" /> : null}
          {!conflict.data?.conflicts.length ? <Banner type="success" description="当前没有待处理的分发冲突" /> : null}
          {(conflict.data?.conflicts ?? []).map((item) => <div key={item.field} style={{ width: '100%' }}><Typography.Title heading={6}>{item.field}</Typography.Title><div className="auto-grid" style={{ '--auto-grid-cols': 3 } as React.CSSProperties}>{[['上次同步', item.base], ['目标工作稿', item.target], ['来源新稿', item.incoming]].map(([label, value]) => <div key={String(label)}><Typography.Text type="secondary">{String(label)}</Typography.Text><pre style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre></div>)}</div><Select placeholder="选择保留来源或目标" value={choices[item.field]} onChange={(value) => setChoices((previous) => ({ ...previous, [item.field]: value as 'source' | 'target' }))} optionList={[{ value: 'source', label: '采用来源新稿' }, { value: 'target', label: '保留目标修改' }]} /></div>)}
          {conflict.data?.conflicts.length ? <Button type="primary" disabled={!canEdit || conflict.data.conflicts.some((item) => !choices[item.field])} loading={resolveDistribution.isPending} onClick={async () => { await resolveDistribution.mutateAsync({ params: { id: content.id }, body: { expectedVersion: conflict.data!.version, choices } }); setChoices({}); onChanged(); Toast.success('已生成合并工作稿'); }}>确认合并到工作稿</Button> : null}
        </Space>
      </TabPane> : null}
      <TabPane tab="类型转换" itemKey="conversion">
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <Banner type="info" description="栏目移动不会改变内容类型。需要切换模型时，请先预览字段映射、校验问题与字段损失。转换结果保存为工作稿。" />
          <Select placeholder="目标模型" value={targetModel} style={{ width: 280 }} onChange={(value) => { setTargetModel(Number(value)); setFieldMapping({}); setAcknowledgeLoss(false); previewConversion.reset(); }} optionList={models.map((model) => ({ value: model.id, label: model.name }))} />
          {targetFields.map((field) => <Space key={field.name} wrap><Typography.Text>{field.label}</Typography.Text><Select showClear placeholder="来源字段（空则按同名映射）" style={{ width: 260 }} value={fieldMapping[field.name]} onChange={(value) => { setFieldMapping((previous) => { const next = { ...previous }; if (value) next[field.name] = String(value); else delete next[field.name]; return next; }); previewConversion.reset(); }} optionList={(content.modelFields ?? []).map((source) => ({ value: source.name, label: source.label }))} /></Space>)}
          <Button disabled={!canEdit || !targetModel} loading={previewConversion.isPending} onClick={() => targetModel && void previewConversion.mutateAsync({ params: { id: content.id }, body: { modelId: targetModel, fieldMapping } })}>预览转换</Button>
          {previewConversion.data ? <>
            {previewConversion.data.issues.map((issue, index) => <Banner key={`${issue.fieldPath}-${index}`} type={issue.severity === 'error' ? 'danger' : 'warning'} description={`${issue.fieldPath}：${issue.message}`} />)}
            <Typography.Text>将移除字段：{previewConversion.data.droppedFields.join('、') || '无'}</Typography.Text>
            <Checkbox checked={acknowledgeLoss} onChange={(event) => setAcknowledgeLoss(!!event.target.checked)}>已确认字段映射及移除影响</Checkbox>
            <Button type="warning" disabled={!canEdit || !acknowledgeLoss} loading={convertType.isPending} onClick={() => confirmDanger({ title: '转换为目标模型？', content: '将生成新的工作稿，已发布修订保持不变。', onOk: async () => { await convertType.mutateAsync({ params: { id: content.id }, body: { modelId: targetModel!, fieldMapping, expectedVersion: previewConversion.data!.version, acknowledgeLoss } }); previewConversion.reset(); onChanged(); Toast.success('类型转换工作稿已保存'); } })}>应用转换</Button>
          </> : null}
        </Space>
      </TabPane>
    </Tabs>
  </div>;
}
