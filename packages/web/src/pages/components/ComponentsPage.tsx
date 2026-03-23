import {
  Card,
  Button,
  Tag,
  Space,
  Input,
  Select,
  Switch,
  Badge,
  Avatar,
  Progress,
  Tooltip,
  Typography,
  Steps,
  Rating,
  Notification,
  Toast,
  Row,
  Col,
  Timeline,
} from '@douyinfe/semi-ui';
import { Search, Bell, Star, Send, Plus, User, Info } from 'lucide-react';
import './ComponentsPage.css';

const { Title, Text, Paragraph } = Typography;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
  return (
    <div className="page-container">
      <div className="page-header">
        <Title heading={4} style={{ fontWeight: 600, margin: 0 }}>组件示例</Title>
        <Text type="tertiary" size="small">Semi Design 组件库常用组件展示</Text>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Section title="Button 按钮">
            <Space wrap>
              <Button type="primary" theme="solid">主按钮</Button>
              <Button type="secondary">次按钮</Button>
              <Button type="tertiary">三级按钮</Button>
              <Button type="warning" theme="solid">警告</Button>
              <Button type="danger" theme="solid">危险</Button>
              <Button theme="borderless" icon={<Plus />}>新增</Button>
              <Button loading>加载中</Button>
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Tag 标签">
            <Space wrap>
              <Tag color="blue" size="large">蓝色</Tag>
              <Tag color="cyan" size="large">青色</Tag>
              <Tag color="green" size="large">绿色</Tag>
              <Tag color="orange" size="large">橙色</Tag>
              <Tag color="red" size="large">红色</Tag>
              <Tag color="violet" size="large">紫色</Tag>
              <Tag closable size="large">可关闭</Tag>
              <Tag type="solid" color="blue" size="large">实心</Tag>
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Input 输入框">
            <Space vertical style={{ width: '100%' }} align="start">
              <Input placeholder="默认输入框" style={{ width: 280 }} />
              <Input prefix={<Search />} placeholder="搜索" showClear style={{ width: 280 }} />
              <Input suffix={<Send />} placeholder="带后缀" style={{ width: 280 }} />
              <Input disabled placeholder="禁用状态" style={{ width: 280 }} />
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Select 选择器">
            <Space vertical style={{ width: '100%' }} align="start">
              <Select placeholder="请选择" style={{ width: 280 }}>
                <Select.Option value="react">React</Select.Option>
                <Select.Option value="vue">Vue</Select.Option>
                <Select.Option value="angular">Angular</Select.Option>
              </Select>
              <Select placeholder="多选" multiple style={{ width: 280 }} defaultValue={['react']}>
                <Select.Option value="react">React</Select.Option>
                <Select.Option value="vue">Vue</Select.Option>
                <Select.Option value="angular">Angular</Select.Option>
              </Select>
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Avatar & Badge 头像和徽标">
            <Space>
              <Badge count={5}>
                <Avatar color="blue">LS</Avatar>
              </Badge>
              <Badge count={99} overflowCount={99}>
                <Avatar color="green">WZ</Avatar>
              </Badge>
              <Badge dot>
                <Avatar color="orange" icon={<Bell />} />
              </Badge>
              <Avatar src="" color="red">ZS</Avatar>
              <Avatar style={{ background: 'var(--color-primary)' }} icon={<User />} />
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Switch & Rating">
            <Space vertical align="start">
              <Space>
                <Switch defaultChecked />
                <Switch checkedText="开" uncheckedText="关" />
                <Switch disabled />
              </Space>
              <Space>
                <Rating defaultValue={3} />
                <Rating defaultValue={4} character={<Star style={{ fontSize: 20 }} />} />
              </Space>
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Progress 进度条">
            <Space vertical style={{ width: '100%' }} align="start">
              <Progress percent={30} style={{ width: '80%' }} />
              <Progress percent={50} stroke="var(--color-primary)" style={{ width: '80%' }} />
              <Progress percent={80} stroke="#21b550" style={{ width: '80%' }} />
              <Space>
                <Progress percent={75} type="circle" width={48} />
                <Progress percent={100} type="circle" width={48} />
              </Space>
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Steps 步骤条">
            <Steps current={1} size="small">
              <Steps.Step title="提交申请" description="已完成" />
              <Steps.Step title="审核中" description="进行中" />
              <Steps.Step title="完成" description="待完成" />
            </Steps>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Tooltip 提示 & 反馈">
            <Space>
              <Tooltip content="这是一个提示">
                <Button icon={<Info />}>悬浮提示</Button>
              </Tooltip>
              <Button onClick={() => Toast.success('操作成功')}>Toast</Button>
              <Button
                onClick={() =>
                  Notification.success({ title: '通知', content: '这是一条通知消息', duration: 3 })
                }
              >
                Notification
              </Button>
            </Space>
          </Section>
        </Col>

        <Col span={12}>
          <Section title="Timeline 时间线">
            <Timeline>
              <Timeline.Item time="2024-01-15" type="ongoing">项目启动</Timeline.Item>
              <Timeline.Item time="2024-02-01" type="success">需求确认</Timeline.Item>
              <Timeline.Item time="2024-03-01" type="success">开发完成</Timeline.Item>
              <Timeline.Item time="2024-03-15" type="default">上线部署</Timeline.Item>
            </Timeline>
          </Section>
        </Col>
      </Row>
    </div>
  );
}
