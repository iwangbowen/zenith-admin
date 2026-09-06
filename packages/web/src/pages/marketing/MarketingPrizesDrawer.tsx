import { useState } from 'react';
import { Col, Form, Row, SideSheet, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { deleteAction, listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import AppModal from '@/components/AppModal';
import { CreateButton } from '@/components/toolbar-controls';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useCouponList } from '@/hooks/queries/member-admin';
import {
  useCreateMarketingPrize, useDeleteMarketingPrize, useMarketingPrizes, useUpdateMarketingPrize,
} from '@/hooks/queries/marketing-campaigns';
import {
  MARKETING_PRIZE_TYPE_LABELS, MARKETING_PRIZE_TYPE_OPTIONS,
} from '@zenith/shared/marketing';
import type { MarketingCampaign, MarketingPrize, SaveMarketingPrizeInput } from '@zenith/shared/marketing';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text } = Typography;

interface MarketingPrizesDrawerProps {
  campaign: MarketingCampaign | null;
  onClose: () => void;
}

/** 奖品管理抽屉：权重抽取 + 库存台账（进行中活动不可删奖品） */
export default function MarketingPrizesDrawer({ campaign, onClose }: MarketingPrizesDrawerProps) {
  const { hasPermission } = usePermission();
  const campaignId = campaign?.id ?? null;
  const prizesQuery = useMarketingPrizes(campaignId);
  const createMutation = useCreateMarketingPrize();
  const updateMutation = useUpdateMarketingPrize();
  const deleteMutation = useDeleteMarketingPrize();
  const couponsQuery = useCouponList({ page: 1, pageSize: 100 });
  const [prizeType, setPrizeType] = useState<MarketingPrize['prizeType']>('points');

  const canEdit = hasPermission('marketing:campaign:update');
  const prizes = prizesQuery.data ?? [];
  const totalWeight = prizes.reduce((s, p) => s + p.weight, 0);

  const modal = useEditModal<MarketingPrize, Partial<SaveMarketingPrizeInput>, SaveMarketingPrizeInput>({
    entityName: '奖品',
    // 新增 / 更新是两条独立契约操作，按是否带 id 分流
    save: {
      mutateAsync: ({ id, values }) => (id === undefined
        ? createMutation.mutateAsync({ params: { campaignId: campaignId! }, body: values })
        : updateMutation.mutateAsync({ params: { campaignId: campaignId!, prizeId: id }, body: values })),
      isPending: createMutation.isPending || updateMutation.isPending,
    },
    defaults: () => {
      setPrizeType('points');
      return { prizeType: 'points', stock: 100, weight: 10, sort: 0 };
    },
    toValues: (r) => {
      setPrizeType(r.prizeType);
      return {
        name: r.name,
        prizeType: r.prizeType,
        points: r.points ?? undefined,
        couponId: r.couponId ?? undefined,
        stock: r.totalStock,
        weight: r.weight,
        sort: r.sort,
      };
    },
    beforeSave: (values) => ({
      name: values.name ?? '',
      prizeType: values.prizeType ?? prizeType,
      points: typeof values.points === 'number' ? values.points : null,
      couponId: typeof values.couponId === 'number' ? values.couponId : null,
      stock: typeof values.stock === 'number' ? values.stock : 0,
      weight: typeof values.weight === 'number' ? values.weight : 1,
      sort: typeof values.sort === 'number' ? values.sort : 0,
    }),
    labelWidth: 90,
  });

  const columns: ColumnProps<MarketingPrize>[] = [
    { title: '奖品名称', dataIndex: 'name', minWidth: 160 },
    {
      title: '类型', dataIndex: 'prizeType', width: 100,
      render: (v: MarketingPrize['prizeType']) => (
        <Tag color={v === 'none' ? 'grey' : v === 'physical' ? 'orange' : 'blue'} size="small">{MARKETING_PRIZE_TYPE_LABELS[v]}</Tag>
      ),
    },
    {
      title: '奖励内容', width: 160,
      render: (_: unknown, r: MarketingPrize) => r.prizeType === 'points'
        ? `${r.points ?? 0} 积分`
        : r.prizeType === 'coupon'
          ? (r.couponName ?? `优惠券 #${r.couponId}`)
          : r.prizeType === 'physical' ? '线下发放' : EMPTY_PLACEHOLDER,
    },
    {
      title: '库存（剩余/总量）', width: 140, align: 'right',
      render: (_: unknown, r: MarketingPrize) => r.prizeType === 'none' ? '不限' : `${r.stock} / ${r.totalStock}`,
    },
    {
      title: '权重（中奖率）', width: 130, align: 'right',
      render: (_: unknown, r: MarketingPrize) => `${r.weight}${totalWeight > 0 ? `（${((r.weight / totalWeight) * 100).toFixed(1)}%）` : ''}`,
    },
    createOperationColumn<MarketingPrize>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canEdit ? [
        { key: 'edit', label: '编辑', onClick: () => { modal.openEdit(record); } },
        deleteAction({
          disabledReason: campaign?.status === 'published' ? '进行中不可删' : undefined,
          title: `确定要删除奖品「${record.name}」吗？`,
          run: () => deleteMutation.mutateAsync({ params: { campaignId: campaignId!, prizeId: record.id } }),
        }),
      ] : [],
    }),
  ];

  const couponOptions = (couponsQuery.data?.list ?? []).map((c) => ({ value: c.id, label: c.name }));

  return (
    <SideSheet
      title={`奖品管理${campaign ? ` · ${campaign.name}` : ''}`}
      visible={campaign !== null}
      onCancel={onClose}
      width={860}
      closeOnEsc
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="tertiary">按权重抽取；「谢谢参与」不占库存。中奖后积分/优惠券自动发放，实物线下发放。</Text>
          {canEdit && <CreateButton onClick={modal.openCreate}>新增奖品</CreateButton>}
        </div>
        <ConfigurableTable<MarketingPrize>
          columns={columns}
          empty="暂无奖品，发布前请至少配置一个"
          {...listTableProps(prizesQuery)}
        />
      </div>

      <AppModal {...modal.modalProps} width={520}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="奖品名称" placeholder="如：100 积分"
              rules={[{ required: true, message: '奖品名称不能为空' }]} />
            <Form.Select
              field="prizeType" label="奖品类型" style={{ width: '100%' }}
              optionList={MARKETING_PRIZE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) => setPrizeType(v as MarketingPrize['prizeType'])}
              rules={[{ required: true, message: '请选择奖品类型' }]}
            />
            {prizeType === 'points' && (
              <Form.InputNumber field="points" label="积分数" style={{ width: '100%' }} min={1}
                rules={[{ required: true, message: '请填写积分数' }]} />
            )}
            {prizeType === 'coupon' && (
              <Form.Select
                field="couponId" label="优惠券" style={{ width: '100%' }} placeholder="选择优惠券模板"
                optionList={couponOptions} loading={couponsQuery.isFetching} filter
                rules={[{ required: true, message: '请选择优惠券' }]}
              />
            )}
            <Row gutter={16}>
              {prizeType !== 'none' && (
                <Col span={12}>
                  <Form.InputNumber field="stock" label="库存" style={{ width: '100%' }} min={0}
                    rules={[{ required: true, message: '请填写库存' }]} />
                </Col>
              )}
              <Col span={12}>
                <Form.InputNumber
                  field="weight" label="权重" style={{ width: '100%' }} min={1}
                  extraText="数值越大越易抽中，占比 = 权重 / 全部奖品权重和"
                  rules={[{ required: true, message: '请填写权重' }]}
                />
              </Col>
            </Row>
          </Form>
        </Spin>
      </AppModal>
    </SideSheet>
  );
}
