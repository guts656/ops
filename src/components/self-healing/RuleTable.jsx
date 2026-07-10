import { CopyOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Popconfirm, Progress, Space, Switch, Table, Tag, Typography } from 'antd'
import PermissionGate from '../auth/PermissionGate'
import { PERMISSIONS } from '../../config/permissions'

const priorityColor = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' }

function executionTag(rule) {
  if (rule.autoExecute && rule.executionMode === 'controlled') return <Tag color="orange">受控执行</Tag>
  return <Tag color="blue">安全模式</Tag>
}

export default function RuleTable({ rules, loading, onCreate, onEdit, onDelete, onCopy, onToggle, onEvaluate }) {
  return (
    <Card
      title="自愈规则列表"
      extra={
        <PermissionGate permission={PERMISSIONS.SELF_HEALING_MANAGE}>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            新建规则
          </Button>
        </PermissionGate>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rules}
        pagination={{ pageSize: 6 }}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            width: 240,
            render: (_, rule) => (
              <Space orientation="vertical" size={2}>
                <Space wrap>
                  <Typography.Text strong>{rule.name}</Typography.Text>
                  <Tag color={priorityColor[rule.priority]}>{rule.priority}</Tag>
                  {executionTag(rule)}
                </Space>
                <Typography.Text type="secondary">{rule.description}</Typography.Text>
              </Space>
            ),
          },
          { title: '触发条件描述', dataIndex: 'conditionText', width: 340 },
          {
            title: '状态',
            dataIndex: 'enabled',
            width: 100,
            render: (enabled, rule) => (
              <PermissionGate permission={PERMISSIONS.SELF_HEALING_MANAGE} mode="disable">
                <Switch checked={enabled} onChange={(checked) => onToggle(rule.id, checked)} />
              </PermissionGate>
            ),
          },
          { title: '触发次数', dataIndex: 'triggerCount', width: 100 },
          {
            title: '成功率',
            dataIndex: 'successRate',
            width: 150,
            render: (value) => <Progress percent={value} size="small" status={value >= 90 ? 'success' : 'normal'} />,
          },
          { title: '最后执行时间', dataIndex: 'lastExecutedAt', width: 170 },
          {
            title: '操作',
            width: 180,
            render: (_, rule) => (
              <PermissionGate permission={PERMISSIONS.SELF_HEALING_MANAGE}>
                <Space>
                  <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(rule)}>
                    编辑
                  </Button>
                  <Button type="link" icon={<CopyOutlined />} onClick={() => onCopy(rule)}>
                    复制
                  </Button>
                  <Button type="link" icon={<ExperimentOutlined />} onClick={() => onEvaluate(rule)}>
                    手动评估
                  </Button>
                  <Popconfirm title="确认删除该规则？" onConfirm={() => onDelete(rule.id)}>
                    <Button danger type="link" icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </PermissionGate>
            ),
          },
        ]}
      />
    </Card>
  )
}
