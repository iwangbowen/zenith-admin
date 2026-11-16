import { Collapse, Descriptions, Empty, Space, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import { MAINTENANCE_ACTION_LABELS, MAINTENANCE_LOG_STATUS_OPTIONS, type MaintenanceLog } from '@zenith/shared/ops';
import DateTimeText from '@/components/DateTimeText';

const { Text, Title } = Typography;

export default function MaintenanceDetail({ detail }: { readonly detail: MaintenanceLog }) {
  const status = MAINTENANCE_LOG_STATUS_OPTIONS.find((item) => item.value === detail.status);
  return <div className="maintenance-detail">
    <section className="maintenance-detail-section" aria-label="维护概况">
      <Space spacing={12}>
        <Title heading={6}>维护概况</Title>
        <Tag color={detail.status === 'ongoing' ? 'orange' : detail.status === 'scheduled' ? 'blue' : 'grey'}>{status?.label ?? detail.status}</Tag>
      </Space>
      <dl className="maintenance-detail-description">
        <div><dt>维护原因</dt><dd>{detail.reason || '未填写'}</dd></div>
        {detail.endReason ? <div><dt>{detail.status === 'cancelled' ? '取消原因' : '结束原因'}</dt><dd>{detail.endReason}</dd></div> : null}
        <div><dt>维护提示</dt><dd>{detail.message}</dd></div>
      </dl>
      <div className="auto-grid maintenance-detail-times">
        {detail.scheduledStartAt ? <div><Text type="tertiary" size="small">计划开始</Text><DateTimeText value={detail.scheduledStartAt} mode="absolute" /></div> : null}
        <div><Text type="tertiary" size="small">实际开始</Text><DateTimeText value={detail.startedAt} mode="absolute" empty={detail.status === 'cancelled' ? '未开始' : '尚未开始'} /></div>
        <div><Text type="tertiary" size="small">{detail.status === 'cancelled' ? '取消时间' : '实际结束'}</Text><DateTimeText value={detail.endedAt} mode="absolute" empty="尚未结束" /></div>
        <div><Text type="tertiary" size="small">预计结束 · 仅展示</Text><DateTimeText value={detail.estimatedEndAt} mode="absolute" empty="未设置" /></div>
        <div><Text type="tertiary" size="small">自动恢复</Text><DateTimeText value={detail.autoEndAt} mode="absolute" empty="未设置" /></div>
      </div>
    </section>

    <section className="maintenance-detail-section" aria-label="操作记录">
      <Title heading={6}>操作记录</Title>
      {detail.changes.length ? <Timeline className="maintenance-detail-timeline">
        {detail.changes.map((change, index) => <Timeline.Item key={index} type={change.action === 'finish' ? 'success' : 'default'}>
          <div className="maintenance-detail-event">
            <div className="maintenance-detail-event-heading">
              <Text strong>{MAINTENANCE_ACTION_LABELS[change.action] ?? change.action}</Text>
              <Text type="tertiary" size="small"><DateTimeText value={change.at} mode="absolute" /></Text>
            </div>
            <Text type="secondary" size="small">操作人：{change.actor}</Text>
            <div className="maintenance-detail-reason">{change.reason || '未填写操作原因'}</div>
            <Collapse className="maintenance-detail-snapshot">
              <Collapse.Panel header="查看当时配置" itemKey="snapshot">
                <Descriptions align="left" column={1} data={[
                  { key: '维护提示', value: <span className="maintenance-detail-copy">{change.message}</span> },
                  { key: '预计结束', value: <DateTimeText value={change.estimatedEndAt} mode="absolute" empty="未设置" /> },
                  { key: '自动恢复', value: <DateTimeText value={change.autoEndAt} mode="absolute" empty="未设置" /> },
                ]} />
              </Collapse.Panel>
            </Collapse>
          </div>
        </Timeline.Item>)}
      </Timeline> : <Empty description="暂无操作记录" />}
    </section>
  </div>;
}
