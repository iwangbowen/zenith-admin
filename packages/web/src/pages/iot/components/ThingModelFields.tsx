/* eslint-disable react-refresh/only-export-components */
import { Form } from '@douyinfe/semi-ui';
import { IOT_COMPARE_OP_OPTIONS } from '@zenith/shared/iot';
import { useIotThingModel } from '@/hooks/queries/iot-products';

export function useIotThingModelSelects(productId: number | null | undefined) {
  const query = useIotThingModel(productId ?? null);
  const model = query.data;
  return {
    numericProperties: (model?.properties ?? []).filter((p) => p.dataType === 'number'),
    services: model?.services ?? [],
    events: model?.events ?? [],
    isFetching: query.isFetching,
  };
}

interface PropertyConditionFieldsProps {
  productId: number | null | undefined;
  includeConsecutiveCount?: boolean;
  propertyField?: string;
  operatorField?: string;
  thresholdField?: string;
  consecutiveCountField?: string;
}

export function IotPropertyConditionFields({
  productId,
  includeConsecutiveCount = false,
  propertyField = 'propertyIdentifier',
  operatorField = 'operator',
  thresholdField = 'threshold',
  consecutiveCountField = 'consecutiveCount',
}: Readonly<PropertyConditionFieldsProps>) {
  const { numericProperties } = useIotThingModelSelects(productId);
  return (
    <>
      <Form.Select
        field={propertyField} label="监控属性" placeholder="选择数值型属性" style={{ width: '100%' }}
        optionList={numericProperties.map((p) => ({ value: p.identifier, label: `${p.name}（${p.identifier}${p.unit ? `，${p.unit}` : ''}）` }))}
        rules={[{ required: true, message: '请选择监控属性' }]}
        emptyContent={productId ? '该产品物模型没有数值型属性' : '请先选择产品'}
      />
      <div style={{ display: 'flex', gap: 12 }}>
        <Form.Select field={operatorField} label="比较符" style={{ width: 110 }}
          optionList={IOT_COMPARE_OP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          rules={[{ required: true, message: '必选' }]} />
        <Form.InputNumber field={thresholdField} label="阈值" hideButtons style={{ width: 140 }}
          rules={[{ required: true, message: '必填' }]} />
        {includeConsecutiveCount && (
          <Form.InputNumber field={consecutiveCountField} label="连续次数" min={1} max={60} style={{ width: 110 }}
            extraText="连续 N 个点满足才触发" />
        )}
      </div>
    </>
  );
}

export function IotEventSelectField({ productId, field = 'eventIdentifier' }: Readonly<{ productId: number | null | undefined; field?: string }>) {
  const { events } = useIotThingModelSelects(productId);
  return (
    <Form.Select
      field={field} label="触发事件" placeholder="选择物模型事件" style={{ width: '100%' }}
      optionList={events.map((e) => ({ value: e.identifier, label: `${e.name}（${e.identifier}）` }))}
      rules={[{ required: true, message: '请选择触发事件' }]}
      emptyContent={productId ? '该产品物模型没有声明事件' : '请先选择产品'}
    />
  );
}

export function IotServiceSelectField({ productId, field = 'service', label = '服务' }: Readonly<{ productId: number | null | undefined; field?: string; label?: string }>) {
  const { services } = useIotThingModelSelects(productId);
  return (
    <Form.Select
      field={field} label={label} placeholder="选择物模型服务" style={{ width: '100%' }}
      optionList={services.map((s) => ({ value: s.identifier, label: `${s.name}（${s.identifier}）` }))}
      rules={[{ required: true, message: '请选择服务' }]}
      emptyContent={productId ? '该产品物模型没有服务' : '请先选择产品'}
    />
  );
}
