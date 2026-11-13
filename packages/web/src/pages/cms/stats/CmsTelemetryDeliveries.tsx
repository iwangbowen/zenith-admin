import { useState } from 'react';
import { Banner, Button, Card, Select, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CMS_TELEMETRY_DELIVERY_STATUSES, CMS_TELEMETRY_DELIVERY_STATUS_LABELS, type CmsTelemetryDelivery } from '@zenith/shared/cms';
import ConfigurableTable from '@/components/ConfigurableTable';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn } from '@/utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { cmsTelemetryDeliveryKeys, useCmsTelemetryDeliveries, useCmsTelemetryDeliverySummary, useReplayCmsTelemetryDelivery } from '@/hooks/queries/cms-stats';

export default function CmsTelemetryDeliveries({ siteId }: Readonly<{ siteId: number }>) {
  const [visible,setVisible]=useState(false);
  const search=useListSearch<{status?:CmsTelemetryDelivery['status']}>({defaults:{},listKey:cmsTelemetryDeliveryKeys.list,resetKey:siteId});
  const summary=useCmsTelemetryDeliverySummary(siteId);
  const deliveries=useCmsTelemetryDeliveries(siteId,{...search.submittedParams,page:search.page,pageSize:search.pageSize},visible);
  const replay=useReplayCmsTelemetryDelivery();const {hasPermission}=usePermission();
  const columns:ColumnProps<CmsTelemetryDelivery>[]=[
    {title:'业务成功事件',dataIndex:'name',minWidth:210,render:(name:string,row)=><Space vertical align="start" spacing={2}><Typography.Text>{row.targetName??name}</Typography.Text><Typography.Text type="tertiary" size="small">{name}</Typography.Text></Space>},
    dateTimeColumn<CmsTelemetryDelivery>('发生时间','occurredAt'),
    {title:'投递状态',dataIndex:'status',width:150,render:(status:CmsTelemetryDelivery['status'])=><Tag color={status==='failed'?'red':status==='delivered'?'green':'orange'}>{CMS_TELEMETRY_DELIVERY_STATUS_LABELS[status]}</Tag>},
    {title:'尝试 / 人工重放',width:180,render:(_v:unknown,row)=>`${row.attempts} / ${row.replayCount}`},
    dateTimeColumn<CmsTelemetryDelivery>('下次投递','nextAttemptAt'),
    {title:'页面上下文',dataIndex:'contextAvailable',width:110,render:(value:boolean)=>value?'完整':'缺失或无效'},
    {title:'归因结果',minWidth:210,render:(_v:unknown,row)=>!row.attributionStatus?'等待投递':row.attributionStatus==='missing_context'?'缺少上下文，无法归因':`${row.attributionStatus==='matched'?row.originContentTitle??'已归因':'未找到来源'} · ${row.attributionSettledAt?'已结算':'迟到窗口内持续重算'}`},
    {title:'最后失败原因',dataIndex:'lastError',minWidth:260,render:(value:string|null)=>value??'—'},
  ];
  if(hasPermission('cms:site:update'))columns.push(createOperationColumn<CmsTelemetryDelivery>({width:110,desktopInlineKeys:['replay'],actions:row=>[{key:'replay',label:row.status==='delivered'?'重算归因':'重新投递',disabled:row.status==='processing'||replay.isPending,onClick:async()=>{
    const result=await replay.mutateAsync({params:{id:siteId,deliveryId:row.id}});Toast.success(result.mode==='attribution'?'归因重算已排队':'原事件已重新排队，不会重复计数');
  }}]}));
  return <>
    <Card title="当前成功转化投递" headerExtraContent={<Button onClick={()=>setVisible(true)}>查看投递明细</Button>}>
      <Typography.Paragraph type="tertiary">当前积压独立于报表日期；业务成功事实不变，晚到访问只更新归因结果。缺少上下文的成功记录不会丢弃。</Typography.Paragraph>
      {summary.isError?<Banner type="danger" description="投递状态查询失败，请刷新重试" />:null}
      <StatGrid minItemWidth={160}>
        <StatCard title="待投递" value={summary.data?.pending??'—'} />
        <StatCard title="等待重试" value={summary.data?.retrying??'—'} />
        <StatCard title="自动重试已停止" value={summary.data?.failed??'—'} />
        <StatCard title="最老积压" value={summary.data?`${Math.ceil(summary.data.oldestPendingAgeSeconds/60)} 分钟`:'—'} />
        <StatCard title="缺少上下文" value={summary.data?.missingContext??'—'} />
        <StatCard title="归因待结算" value={summary.data?.pendingAttribution??'—'} />
      </StatGrid>
    </Card>
    <SideSheet title="成功转化投递与归因" visible={visible} onCancel={()=>setVisible(false)} width={1200}>
      <ListSearchToolbar onSearch={search.handleSearch} onReset={search.handleReset} filters={<Select aria-label="投递状态" placeholder="全部投递状态" showClear {...search.bind('status',(value:unknown)=>value as CmsTelemetryDelivery['status']|undefined)} optionList={CMS_TELEMETRY_DELIVERY_STATUSES.map(value=>({value,label:CMS_TELEMETRY_DELIVERY_STATUS_LABELS[value]}))} />} />
      {deliveries.isError?<Banner type="danger" description="明细查询失败，请刷新重试" />:null}
      <ConfigurableTable columnSettingsKey="cms-telemetry-deliveries" columns={columns} {...listTableProps(deliveries,{rowKey:'id',pagination:search.buildPagination,loadingMode:'initial',empty:'暂无成功转化记录'})} />
    </SideSheet>
  </>;
}
