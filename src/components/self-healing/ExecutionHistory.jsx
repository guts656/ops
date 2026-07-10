import { DownloadOutlined } from '@ant-design/icons'
import { Button, Card, DatePicker, Select, Space, Tag, Timeline, Typography } from 'antd'

const statusColor = { 成功: 'green', 失败: 'red', 执行中: 'blue' }
const resultColor = { 成功: 'green', 失败: 'red', 跳过: 'default' }

function modeTag(item) {
  if (item.mode === 'controlled') return <Tag color="orange">受控执行</Tag>
  return <Tag color="blue">安全模式</Tag>
}

export default function ExecutionHistory({ rules, history, selectedRuleId, onFilterRule, onExport }) {
  return (
    <Card
      title="执行历史（安全模式计划动作 / 受控执行结果）"
      extra={
        <Button icon={<DownloadOutlined />} onClick={onExport}>
          导出日志
        </Button>
      }
    >
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
        <Select
          allowClear
          value={selectedRuleId}
          placeholder="按规则筛选"
          style={{ minWidth: 260 }}
          options={rules.map((rule) => ({ label: rule.name, value: rule.id }))}
          onChange={onFilterRule}
        />
        <DatePicker.RangePicker showTime />
      </div>
      <Timeline
        items={history.map((item) => ({
          color: item.status === '成功' ? 'green' : 'red',
          children: (
            <div className="rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Typography.Text strong>{item.ruleName}</Typography.Text>
                <Tag color={statusColor[item.status]}>{item.status}</Tag>
                {modeTag(item)}
                <Typography.Text type="secondary">{item.triggeredAt}</Typography.Text>
              </div>
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text type="secondary">服务：{item.service} · 触发值：{item.triggerValue} · 耗时：{item.duration}</Typography.Text>
                {item.agentJobIds?.length > 0 && (
                  <Typography.Text type="secondary">Agent Job：{item.agentJobIds.join('，')}（stdout/stderr 请在主机任务日志中查看）</Typography.Text>
                )}
                {item.actionResults?.length > 0 && (
                  <div className="rounded border border-slate-700/70 bg-slate-900/40 p-3">
                    <Typography.Text strong>动作结果</Typography.Text>
                    <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 8 }}>
                      {item.actionResults.map((result, index) => (
                        <div key={`${result.action}-${result.target}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                          <Tag color={resultColor[result.status]}>{result.status}</Tag>
                          <Typography.Text>{result.action} → {result.serviceName || result.target}</Typography.Text>
                          {result.attempts !== undefined && <Typography.Text type="secondary">尝试 {result.attempts} 次</Typography.Text>}
                          {result.agentJobId && <Typography.Text type="secondary">Job {result.agentJobId}</Typography.Text>}
                          <Typography.Text type="secondary">{result.summary}</Typography.Text>
                        </div>
                      ))}
                    </Space>
                  </div>
                )}
                <pre className="self-healing-log">{item.logs.map((log, index) => `${index + 1}. ${log}`).join('\n')}</pre>
              </Space>
            </div>
          ),
        }))}
      />
    </Card>
  )
}
