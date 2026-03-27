import { useState } from 'react';
import RegionSelect from '@/components/RegionSelect';
import { Card, Space, Typography, Row, Col } from '@douyinfe/semi-ui';
import './ComponentsPage.css';

const { Text } = Typography;

function Section({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Card
      title={<Text strong style={{ fontSize: 14 }}>{title}</Text>}
      className="comp-section"
      bodyStyle={{ padding: 16 }}
    >
      {children}
    </Card>
  );
}

export default function ComponentsPage() {
  const [regionValue, setRegionValue] = useState<string[] | undefined>();
  const [regionValue2, setRegionValue2] = useState<string[] | undefined>();

  return (
    <div className="page-container">
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Section title="RegionSelect 省市区联动选择">
            <Row gutter={[24, 16]}>
              <Col span={12}>
                <Space vertical align="start" style={{ width: '100%' }}>
                  <Text type="tertiary">① 基础用法（可选到任意层级）</Text>
                  <RegionSelect
                    value={regionValue}
                    onChange={setRegionValue}
                    style={{ width: 320 }}
                  />
                  <Text type="tertiary" size="small">
                    当前选中：{regionValue ? regionValue.join(' / ') : '未选择'}
                  </Text>
                </Space>
              </Col>
              <Col span={12}>
                <Space vertical align="start" style={{ width: '100%' }}>
                  <Text type="tertiary">② 必须选到县级（changeOnSelect=false）</Text>
                  <RegionSelect
                    value={regionValue2}
                    onChange={setRegionValue2}
                    changeOnSelect={false}
                    placeholder="请选择到县/区级"
                    style={{ width: 320 }}
                  />
                  <Text type="tertiary" size="small">
                    当前选中：{regionValue2 ? regionValue2.join(' / ') : '未选择'}
                  </Text>
                </Space>
              </Col>
              <Col span={12}>
                <Space vertical align="start" style={{ width: '100%' }}>
                  <Text type="tertiary">③ 禁用状态</Text>
                  <RegionSelect disabled placeholder="禁用" style={{ width: 320 }} />
                </Space>
              </Col>
            </Row>
          </Section>
        </Col>
      </Row>
    </div>
  );
}
