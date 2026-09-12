import { useMemo, useState } from 'react';
import { Form, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis, EMPTY_PLACEHOLDER, enabledStatusColumn } from '@/utils/table-columns';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { compactParams } from '@/lib/query';
import { useDictItems } from '@/hooks/useDictItems';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import { IOT_VALIDATION_MODE_OPTIONS } from '@zenith/shared/iot';
import type { CreateIotProductInput, IotProduct } from '@zenith/shared/iot';
import {
  iotProductKeys, useDeleteIotProducts, useIotProductList, useSaveIotProduct,
} from '@/hooks/queries/iot-products';
import IotThingModelDrawer from './IotThingModelDrawer';

const { Text } = Typography;

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined };

/** 产品表单值：记录里的 null 描述在表单中归一为空串 */
type IotProductFormValues = Partial<CreateIotProductInput>;

export default function IotProductsPage() {
  const { hasPermission } = usePermission();
  const { items: statusItems } = useDictItems('common_status');
  const [modelProduct, setModelProduct] = useState<IotProduct | null>(null);

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: iotProductKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }), [submittedParams]);
  const listQuery = useIotProductList({
    page,
    pageSize,
    ...filterQuery,
  });

  const modal = useEditModal<IotProduct, IotProductFormValues, Partial<CreateIotProductInput>>({
    entityName: '产品',
    save: useSaveIotProduct(),
    toValues: (r) => ({
      name: r.name,
      validationMode: r.validationMode,
      status: r.status,
      description: r.description ?? '',
    }),
    defaults: { status: 'enabled', validationMode: 'loose' },
    beforeSave: (values) => ({
      name: values.name,
      validationMode: values.validationMode,
      status: values.status,
      description: values.description || null,
    }),
    labelWidth: 100,
  });

  const deleteMutation = useDeleteIotProducts();

  const columns: ColumnProps<IotProduct>[] = [
    {
      title: '产品名称', dataIndex: 'name', width: 180,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '物模型', width: 210,
      render: (_: unknown, r: IotProduct) => (
        <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
          <Tag size="small" color="cyan">属性 {r.propertyCount ?? 0}</Tag>
          <Tag size="small" color="blue">服务 {r.serviceCount ?? 0}</Tag>
          <Tag size="small" color="orange">事件 {r.eventCount ?? 0}</Tag>
        </div>
      ),
    },
    {
      title: '遥测校验', dataIndex: 'validationMode', width: 90,
      render: (v: IotProduct['validationMode']) => (
        <Tag size="small" color={v === 'strict' ? 'red' : 'grey'}>{v === 'strict' ? '严格' : '宽松'}</Tag>
      ),
    },
    {
      title: '描述', dataIndex: 'description', minWidth: 240,
      render: (v: string | null) => v ? renderEllipsis(v) : EMPTY_PLACEHOLDER,
    },
    {
      title: '设备数', dataIndex: 'deviceCount', width: 90, align: 'right',
      render: (v: number) => <Text strong>{v}</Text>,
    },
    createdAtColumn,
    enabledStatusColumn(),
    createOperationColumn<IotProduct>({
      width: 220,
      actions: (record) => [
        {
          key: 'model', label: '物模型', onClick: () => setModelProduct(record),
        },
        ...(hasPermission('iot:product:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('iot:product:delete'),
          disabled: (record.deviceCount ?? 0) > 0,
          disabledReason: (record.deviceCount ?? 0) > 0 ? '产品下存在设备' : undefined,
          title: `确定要删除产品「${record.name}」吗？`,
          content: '删除后不可恢复，物模型定义一并删除',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索产品名称..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={(
          <StatusSelect
            items={statusItems}
            {...bind('status')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('iot:product:create')
            ? <CreateButton onClick={modal.openCreate} /> : null
        )}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<IotProduct>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无 IoT 产品' })}
      />

      <AppModal {...modal.modalProps} width={560}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="产品名称" placeholder="如：温湿度传感器"
              rules={[{ required: true, message: '产品名称不能为空' }]} />
            <Form.Select
              field="validationMode" label="遥测校验" style={{ width: '100%' }}
              optionList={IOT_VALIDATION_MODE_OPTIONS}
              extraText="宽松：校验已声明属性（不符丢弃该键），未声明键放行；严格：仅接受已声明属性"
            />
            <FormStatusRadioGroup />
            <Form.TextArea field="description" label="描述" rows={3} placeholder="产品用途说明（选填）" maxCount={2000} />
          </Form>
        </Spin>
      </AppModal>

      <IotThingModelDrawer product={modelProduct} onClose={() => setModelProduct(null)} />
    </div>
  );
}
