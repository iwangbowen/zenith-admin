import { useMemo, useState } from 'react';
import { Col, Form, Modal, Row, Space, Spin, Tag, TagGroup, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Info } from 'lucide-react';
import { MASK_TYPES, MASK_TYPE_LABELS, MASK_TYPE_OPTIONS, enumValueOf, previewMask, type CustomMaskRule, type MaskType } from '@zenith/shared/core';
import type { Menu } from '@zenith/shared/identity';
import { DATA_MASK_BYPASS_PERMISSION, type DataMaskField, type SaveDataMaskPolicyInput } from '@zenith/shared/platform';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilterSelect, KeywordInput } from '@/components/search-filters';

import { dataMaskKeys, useDataMaskFields, useResetDataMaskPolicy, useSaveDataMaskPolicy, type DataMaskFieldsQuery } from '@/hooks/queries/data-mask';
import { useMenuTree } from '@/hooks/queries/menus';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';

const { Text } = Typography;

/**
 * 数据脱敏策略中心。
 *
 * 敏感字段由接口契约的 `sensitive()` 声明并在服务端汇总成注册表，这里不再「新增 / 删除规则」：
 * 列表就是全部会被脱敏的字段及其生效策略，管理员只能改某个字段的脱敏方式、豁免权限或停用；
 * 「恢复默认」删除覆盖记录，字段回到契约声明的默认脱敏。
 */

/** 表格行：注册表字段没有主键，用列表序号作 useEditModal 需要的 id（仅用于表单重挂载） */
type DataMaskFieldRow = DataMaskField & { id: number };

type FormValues = {
  maskType: MaskType;
  prefixKeep?: number;
  suffixKeep?: number;
  maskChar?: string;
  exemptPermissions: string[];
  enabled: boolean;
  remark?: string;
};

type SavePayload = { entity: string; field: string; body: SaveDataMaskPolicyInput };

const ENABLED_FILTER_OPTIONS = [{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }];
const SOURCE_FILTER_OPTIONS = [{ value: 'true', label: '已自定义' }, { value: 'false', label: '契约默认' }];

interface SearchParams {
  keyword: string;
  entity?: string;
  maskType?: string;
  enabled?: string;
  overridden?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', entity: undefined, maskType: undefined, enabled: undefined, overridden: undefined };

function toQuery(params: SearchParams): DataMaskFieldsQuery {
  return {
    keyword: params.keyword || undefined,
    entity: params.entity,
    maskType: enumValueOf(MASK_TYPES, params.maskType),
    enabled: params.enabled === undefined ? undefined : params.enabled === 'true',
    overridden: params.overridden === undefined ? undefined : params.overridden === 'true',
  };
}

function customRuleOf(values: Pick<FormValues, 'maskType' | 'prefixKeep' | 'suffixKeep' | 'maskChar'>): CustomMaskRule | null {
  if (values.maskType !== 'custom') return null;
  return { prefixKeep: values.prefixKeep ?? 3, suffixKeep: values.suffixKeep ?? 4, maskChar: values.maskChar?.trim() || '*' };
}

/** 菜单树里的全部按钮权限码：作为豁免权限的选项来源（label 带所属页面便于辨认） */
function collectPermissionOptions(tree: Menu[] | undefined): { value: string; label: string }[] {
  const out = new Map<string, string>();
  const walk = (nodes: Menu[], parents: string[]) => {
    for (const node of nodes) {
      if (node.permission && !out.has(node.permission)) {
        out.set(node.permission, `${[...parents.slice(-1), node.title].join(' / ')}（${node.permission}）`);
      }
      if (node.children?.length) walk(node.children, [...parents, node.title]);
    }
  };
  walk(tree ?? [], []);
  return [...out.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.value.localeCompare(b.value));
}

export default function DataMaskPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:data-mask:update');
  const {
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: dataMaskKeys.fields });

  const listQuery = useDataMaskFields(toQuery(submittedParams));
  const rows = useMemo<DataMaskFieldRow[]>(() => (listQuery.data ?? []).map((item, index) => ({ ...item, id: index + 1 })), [listQuery.data]);
  const entityOptions = useMemo(() => {
    const entities = Array.from(new Set((listQuery.data ?? []).map((item) => item.entity))).sort();
    return entities.map((value) => ({ value, label: value }));
  }, [listQuery.data]);
  const permissionOptions = collectPermissionOptions(useMenuTree().data);

  const saveMutation = useSaveDataMaskPolicy();
  const resetMutation = useResetDataMaskPolicy();
  const [preview, setPreview] = useState<{ maskType: MaskType; rule: CustomMaskRule | null }>({ maskType: 'phone', rule: null });

  const modal = useEditModal<DataMaskFieldRow, FormValues, SavePayload>({
    entityName: '脱敏策略',
    // 保存目标由行的 entity / field 决定，不是主键：适配成 useEditModal 需要的 { id, values } 形态
    save: {
      mutateAsync: async ({ values }) => {
        const saved = await saveMutation.mutateAsync({ params: { entity: values.entity, field: values.field }, body: values.body });
        return { ...saved, id: 0 };
      },
      isPending: saveMutation.isPending,
    },
    toValues: (record) => ({
      maskType: record.maskType,
      prefixKeep: record.customRule?.prefixKeep ?? 3,
      suffixKeep: record.customRule?.suffixKeep ?? 4,
      maskChar: record.customRule?.maskChar ?? '*',
      exemptPermissions: record.exemptPermissions,
      enabled: record.enabled,
      remark: record.remark ?? undefined,
    }),
    beforeSave: (values, { editing }) => ({
      entity: editing!.entity,
      field: editing!.field,
      body: {
        maskType: values.maskType,
        customRule: customRuleOf(values),
        exemptPermissions: values.exemptPermissions ?? [],
        enabled: values.enabled,
        remark: values.remark?.trim() || null,
      },
    }),
    successMessage: () => '策略已保存',
  });

  const openEdit = (row: DataMaskFieldRow) => {
    setPreview({ maskType: row.maskType, rule: row.customRule });
    modal.openEdit(row);
  };

  const handleReset2Default = (row: DataMaskFieldRow) => {
    Modal.confirm({
      title: '恢复契约默认策略',
      content: `「${row.label}（${row.key}）」将删除自定义策略，恢复为契约默认：按 ${MASK_TYPE_LABELS[row.kind]} 脱敏、启用、仅平台超管免脱敏。`,
      onOk: () => {
        void resetMutation.mutateAsync({ params: { entity: row.entity, field: row.field } }).then(() => Toast.success('已恢复默认'));
      },
    });
  };

  const enabledStatus = useStatusToggle<DataMaskFieldRow>({
    getKey: (row) => row.key,
    isEnabled: (row) => row.enabled,
    toggle: (row, enabled) => saveMutation.mutateAsync({
      params: { entity: row.entity, field: row.field },
      body: { maskType: row.maskType, customRule: row.customRule, exemptPermissions: row.exemptPermissions, enabled, remark: row.remark },
    }),
    confirmDisable: (row) => ({ title: '确认停用脱敏', content: `停用后「${row.label}（${row.key}）」在所有接口与脱敏导出中都会以明文返回，确认停用？` }),
    disabled: !canUpdate,
    messages: { enabled: '已启用脱敏', disabled: '已停用脱敏' },
  });

  // 标识类列一律单行：列宽按最长的实体 / 字段名（等宽字体）给足，列级 ellipsis 兜底更长的标识。
  // 单元格内用行内文本而不是 Space（inline-flex 是原子行内盒，溢出时会被整体裁掉而不出省略号）。
  const columns: ColumnProps<DataMaskFieldRow>[] = [
    { title: '实体', dataIndex: 'entity', width: 230, ellipsis: { showTitle: false }, render: (v: string) => <Text code>{v}</Text> },
    {
      title: '字段', dataIndex: 'field', minWidth: 280, ellipsis: { showTitle: false },
      render: (v: string, record) => (
        <>
          <Text code>{v}</Text>
          <Text type="tertiary" size="small" style={{ marginLeft: 6 }}>{record.label}</Text>
        </>
      ),
    },
    {
      title: '生效脱敏', dataIndex: 'maskType', width: 240, ellipsis: { showTitle: false },
      render: (v: MaskType, record) => (
        <>
          <Text>{MASK_TYPE_LABELS[v]}</Text>
          {v === 'custom' && record.customRule && (
            <Text type="tertiary" size="small" style={{ marginLeft: 6 }}>前 {record.customRule.prefixKeep} 后 {record.customRule.suffixKeep} · {record.customRule.maskChar || '*'}</Text>
          )}
          <Text type="quaternary" size="small" style={{ marginLeft: 6, fontFamily: 'monospace' }}>{record.preview}</Text>
        </>
      ),
    },
    {
      title: '豁免权限', dataIndex: 'exemptPermissions', width: 240,
      render: (codes: string[]) => codes.length === 0
        ? <Text type="quaternary">仅平台超管</Text>
        : (
          <TagGroup
            maxTagCount={1}
            showPopover
            size="small"
            tagList={codes.map((code) => ({ tagKey: code, children: code, color: 'blue' as const, size: 'small' as const }))}
          />
        ),
    },
    {
      title: '来源', dataIndex: 'overridden', width: 100,
      render: (v: boolean) => (v ? <Tag size="small" color="orange">已自定义</Tag> : <Tag size="small" color="grey">契约默认</Tag>),
    },
    { title: '备注', dataIndex: 'remark', width: 200, render: (v: string | null) => (v ? renderEllipsis(v) : <Text type="quaternary">{EMPTY_PLACEHOLDER}</Text>) },
    dateTimeColumn<DataMaskFieldRow>('策略更新时间', 'updatedAt'),
    enabledStatus.column({ title: '启用', dataIndex: 'enabled' }),
    createOperationColumn<DataMaskFieldRow>({
      // 「恢复默认」只在已自定义的行出现，收进「更多」：内联 80 + 更多 24 → 150
      width: 150,
      desktopInlineKeys: ['edit'],
      actions: (record) => [
        { key: 'edit', label: '编辑策略', hidden: !canUpdate, onClick: () => openEdit(record) },
        { key: 'reset', label: '恢复默认', hidden: !canUpdate || !record.overridden, onClick: () => handleReset2Default(record) },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索实体 / 字段 / 标签" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleSearch} />}
        filters={(
          <>
            <FilterSelect placeholder="全部实体" items={entityOptions} value={draftParams.entity} onChange={setField('entity')} width={160} />
            <FilterSelect placeholder="全部脱敏类型" items={MASK_TYPE_OPTIONS} value={draftParams.maskType} onChange={setField('maskType')} width={150} />
            <FilterSelect placeholder="全部启用状态" items={ENABLED_FILTER_OPTIONS} value={draftParams.enabled} onChange={setField('enabled')} width={140} />
            <FilterSelect placeholder="全部来源" items={SOURCE_FILTER_OPTIONS} value={draftParams.overridden} onChange={setField('overridden')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="数据脱敏筛选"
      />

      <Space spacing={6} align="start">
        <Info size={14} style={{ marginTop: 3, color: 'var(--semi-color-text-2)' }} />
        <Text type="tertiary" size="small">
          敏感字段由接口契约声明，下表即全部会被脱敏的字段。未自定义的字段按契约默认类型脱敏、仅平台超管可见明文；
          拥有豁免权限的用户直接看到明文，拥有「按需查看明文」权限的用户可逐条查看并留下审计记录。
          脱敏对列表 / 详情 / 写接口响应与脱敏导出统一生效。
        </Text>
      </Space>

      <ConfigurableTable<DataMaskFieldRow>
        columns={columns}
        {...listTableProps({ ...listQuery, data: rows }, { rowKey: 'key' })}
      />

      <AppModal {...modal.modalProps} title="编辑脱敏策略" okText="保存" width={640}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={modal.formKey}
            {...modal.formProps}
            onValueChange={(vals: Record<string, unknown>) => {
              const v = vals as Partial<FormValues>;
              const maskType = (v.maskType ?? preview.maskType) as MaskType;
              setPreview({ maskType, rule: customRuleOf({ maskType, prefixKeep: v.prefixKeep, suffixKeep: v.suffixKeep, maskChar: v.maskChar }) });
            }}
          >
            <Form.Slot label="字段">
              <Space spacing={6}>
                <Text code>{modal.editing?.key}</Text>
                <Text type="tertiary">{modal.editing?.label}</Text>
                <Text type="quaternary" size="small">契约默认：{modal.editing ? MASK_TYPE_LABELS[modal.editing.kind] : ''}</Text>
              </Space>
            </Form.Slot>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="maskType" label="脱敏类型" style={{ width: '100%' }} rules={[{ required: true }]} optionList={MASK_TYPE_OPTIONS} />
              </Col>
              <Col span={12}>
                <Form.Slot label="效果预览">
                  <Tag color="orange" size="large" style={{ fontFamily: 'monospace' }}>{previewMask(preview.maskType, preview.rule)}</Tag>
                </Form.Slot>
              </Col>
            </Row>
            {preview.maskType === 'custom' && (
              <Row gutter={16}>
                <Col span={8}>
                  <Form.InputNumber field="prefixKeep" label="保留前 N 位" min={0} max={20} style={{ width: '100%' }} rules={[{ required: true, message: '请填写保留位数' }]} />
                </Col>
                <Col span={8}>
                  <Form.InputNumber field="suffixKeep" label="保留后 N 位" min={0} max={20} style={{ width: '100%' }} rules={[{ required: true, message: '请填写保留位数' }]} />
                </Col>
                <Col span={8}>
                  <Form.Input field="maskChar" label="掩码字符" maxLength={1} placeholder="默认 *" />
                </Col>
              </Row>
            )}
            <Form.Select
              field="exemptPermissions"
              label="豁免权限"
              multiple
              filter
              allowCreate
              style={{ width: '100%' }}
              optionList={permissionOptions}
              placeholder={`拥有任一权限即看到明文；平台超管无需配置。推荐 ${DATA_MASK_BYPASS_PERMISSION}`}
              extraText="按钮权限码来自菜单管理；也可输入自定义权限码"
            />
            <Form.Switch field="enabled" label="启用脱敏" />
            <Form.TextArea field="remark" label="备注" maxCount={256} rows={2} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
