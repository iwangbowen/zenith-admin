/**
 * 接入 Semi Form 的自定义控件：关联审批单 / 远程数据源 / 手写签名 / 人员 / 富文本 / 附件上传，
 * 以及现成组件（地区 / 部门 / 字典 / 颜色 / 评分）的 withField 包装。
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Rating, Select, Space, Spin, Typography, withField } from '@douyinfe/semi-ui';
import { Eraser } from 'lucide-react';
import type { WorkflowRelationOption } from '@zenith/shared/workflow';
import { workflowAttachmentContract } from '@zenith/shared/workflow';
import FileAttachment from '@/components/FileAttachment';
import { uploadedFileToAttachment } from '@/components/FileAttachment/utils';
import RegionSelect from '@/components/RegionSelect';
import DepartmentSelect from '@/components/DepartmentSelect';
import DictSelect from '@/components/DictSelect';
import ColorPickerInput from '@/components/ColorPickerInput';
import type { RichTextEditorProps } from '@/components/RichTextEditor';
import { useWorkflowDesignerRelationOptions, useWorkflowDesignerRemoteDataSourceOptions } from '@/hooks/queries/workflow-designer';
import { useWorkflowSelectableUsers } from '@/hooks/queries/workflow-shared';
import { urlOf } from '@/lib/contract-query';
import { useSignaturePad } from '@/hooks/useSignaturePad';

// 富文本编辑器懒加载：wangeditor（~780KB raw）只在可编辑富文本字段真正渲染时加载，
// 移动审批、工作流发起/审批等承载本渲染器的入口不再静态背上编辑器
const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));

// ─── 关联审批单 ─────────────────────────────────────────────────────
interface RelationSelectProps {
  value?: number | number[];
  onChange?: (value: number | number[] | undefined) => void;
  relationDefinitionId?: number;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

function formatRelationOption(option: WorkflowRelationOption): string {
  const serial = option.serialNo ? `[${option.serialNo}] ` : '';
  const definition = option.definitionName ? `（${option.definitionName}）` : '';
  return `${serial}${option.title}${definition}`;
}

function RelationSelect({
  value,
  onChange,
  relationDefinitionId,
  multiple = false,
  placeholder = '请选择关联审批单',
  disabled = false,
  showClear = true,
  style,
}: Readonly<RelationSelectProps>) {
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState(false);
  const optionsQuery = useWorkflowDesignerRelationOptions(
    { definitionId: relationDefinitionId, keyword: keyword.trim() || undefined, limit: 20 },
    active,
  );
  const options = optionsQuery.data ?? [];
  const loading = optionsQuery.isFetching;

  useEffect(() => {
    setKeyword('');
    setActive(false);
  }, [relationDefinitionId]);

  const selectedIds = (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .filter((v): v is number => typeof v === 'number');
  const optionList = [
    ...options.map((o) => ({ value: o.instanceId, label: formatRelationOption(o) })),
    ...selectedIds
      .filter((id) => !options.some((o) => o.instanceId === id))
      .map((id) => ({ value: id, label: `审批单 #${id}` })),
  ];

  const selectValue = multiple ? selectedIds : (selectedIds[0] ?? undefined);
  const handleChange = (nextValue: unknown) => {
    if (multiple) {
      const values = Array.isArray(nextValue)
        ? nextValue.map(Number).filter((id) => Number.isFinite(id))
        : [];
      onChange?.(values.length > 0 ? values : undefined);
      return;
    }
    if (nextValue === undefined || nextValue === null || nextValue === '') {
      onChange?.(undefined);
      return;
    }
    const id = Number(nextValue);
    onChange?.(Number.isFinite(id) ? id : undefined);
  };

  return (
    <Select
      value={selectValue}
      onChange={handleChange}
      multiple={multiple}
      filter
      remote
      onSearch={(nextKeyword) => { setKeyword(nextKeyword); setActive(true); }}
      onFocus={() => { setActive(true); }}
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled}
      showClear={showClear}
      maxTagCount={3}
      style={{ width: '100%', ...style }}
      optionList={optionList}
    />
  );
}

// ─── 远程数据源下拉 ──────────────────────────────────────────────────
interface DataSourceSelectProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  dataSourceId?: number;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

function DataSourceSelect({ value, onChange, dataSourceId, placeholder, disabled, showClear = true, style }: Readonly<DataSourceSelectProps>) {
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState(false);
  const optionsQuery = useWorkflowDesignerRemoteDataSourceOptions(
    { dataSourceId, keyword: keyword.trim() || undefined },
    active && !!dataSourceId,
  );
  const options = optionsQuery.data ?? [];
  const loading = optionsQuery.isFetching;

  useEffect(() => {
    setKeyword('');
    setActive(false);
  }, [dataSourceId]);

  const current = value === undefined || value === null ? '' : String(value);
  const optionList = [
    ...options.map((o) => ({ value: o.value, label: o.label })),
    ...(current !== '' && !options.some((o) => o.value === current) ? [{ value: current, label: current }] : []),
  ];

  return (
    <Select
      value={current || undefined}
      onChange={(v) => onChange?.((v as string) ?? undefined)}
      filter
      remote
      onSearch={(nextKeyword) => { setKeyword(nextKeyword); setActive(true); }}
      onFocus={() => { setActive(true); }}
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled}
      showClear={showClear}
      style={{ width: '100%', ...style }}
      optionList={optionList}
    />
  );
}

// ─── 手写签名板 ─────────────────────────────────────────────────────
interface SignaturePadProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  width?: number;
  height?: number;
}

function SignaturePad({ value, onChange, disabled, width = 360, height = 150 }: Readonly<SignaturePadProps>) {
  const { canvasRef, handlePointerDown, handlePointerMove, handlePointerUp, clear } = useSignaturePad({
    value,
    onChange,
    disabled,
    echoValue: true,
  });

  return (
    <Space vertical align="start" spacing={6}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: '1px dashed var(--semi-color-border)',
          borderRadius: 'var(--semi-border-radius-medium)',
          background: 'var(--surface-card)',
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'crosshair',
          maxWidth: '100%',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      {!disabled && (
        <Button size="small" theme="borderless" icon={<Eraser size={12} />} onClick={clear} style={{ alignSelf: 'flex-start' }}>
          清除
        </Button>
      )}
    </Space>
  );
}

// Suspense 收在字段内部：编辑器 chunk 加载期间只有该字段显示占位，不打断整表单渲染
function RichTextEditorField(props: Readonly<RichTextEditorProps>) {
  return (
    <Suspense
      fallback={
        <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>
          <Spin />
        </div>
      }
    >
      <RichTextEditor {...props} />
    </Suspense>
  );
}

/**
 * 工作流表单「人员选择」控件的选人数据源。
 * 不用系统管理接口 /api/users/all（要求 system:user:list，普通发起人 403 拿不到任何选项），
 * 统一走面向普通发起人/审批人开放的 /api/workflows/selectable-users（与转办/委派/抄送等选人一致）。
 */
interface WorkflowUserSelectProps {
  value?: number | number[];
  onChange?: (value: number | number[] | undefined) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

function WorkflowUserSelect({
  value,
  onChange,
  multiple = false,
  placeholder = '请选择人员',
  disabled = false,
  showClear = true,
  style,
}: Readonly<WorkflowUserSelectProps>) {
  const { data: users, isPending: loading } = useWorkflowSelectableUsers();
  const optionList = useMemo(
    () => (users ?? []).map((u) => ({
      value: u.id,
      label: u.departmentName ? `${u.nickname}（${u.departmentName}）` : u.nickname,
    })),
    [users],
  );
  return (
    <Select
      value={value as never}
      onChange={(v) => onChange?.(v as number | number[] | undefined)}
      multiple={multiple}
      filter
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled || loading}
      showClear={showClear}
      maxTagCount={3}
      style={{ width: '100%', ...style }}
      optionList={optionList}
    />
  );
}

// ─── 附件 / 图片上传（接入 Form，存 {name,url,size} 数组） ──────────────
interface UploadedFileValue { name: string; url: string; size?: number }

interface FileUploadInputProps {
  value?: UploadedFileValue[];
  onChange?: (value: UploadedFileValue[]) => void;
  disabled?: boolean;
  isImage?: boolean;
  limit?: number;
  accept?: string;
  maxSizeMb?: number;
}

function FileUploadInput({ value, onChange, disabled, isImage, limit, accept, maxSizeMb }: Readonly<FileUploadInputProps>) {
  const files = Array.isArray(value) ? value : [];
  const attachments = files.map((f, i) => uploadedFileToAttachment(f, i));

  if (disabled) {
    if (files.length === 0) return <Typography.Text type="tertiary">（无附件）</Typography.Text>;
    return <FileAttachment mode="view" value={attachments} showTitle={false} />;
  }

  return (
    <FileAttachment
      mode="edit"
      value={attachments}
      showTitle={false}
      multiple={limit !== 1}
      limit={limit ?? 0}
      accept={accept || (isImage ? 'image/*' : undefined)}
      maxSizeMB={maxSizeMb && maxSizeMb > 0 ? maxSizeMb : undefined}
      uploadTip={isImage ? '上传图片' : '上传文件'}
      uploadPath={urlOf(workflowAttachmentContract.upload)}
      onChange={(items) => onChange?.(items.map((a) => ({
        name: a.file.originalName,
        url: a.file.url,
        size: a.file.size,
      })))}
    />
  );
}

export const FormRegion = withField(RegionSelect);
export const FormRichText = withField(RichTextEditorField);
export const FormSignature = withField(SignaturePad);
export const FormUserSelect = withField(WorkflowUserSelect);
export const FormDeptSelect = withField(DepartmentSelect);
export const FormDictSelect = withField(DictSelect);
export const FormRelationSelect = withField(RelationSelect);
export const FormDataSourceSelect = withField(DataSourceSelect);
export const FormColorPicker = withField(ColorPickerInput);
export const FormRating = withField(Rating);
export const FormFileUpload = withField(FileUploadInput);
