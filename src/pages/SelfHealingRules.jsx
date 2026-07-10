import { CheckCircleOutlined, ThunderboltOutlined, ToolOutlined, WarningOutlined } from '@ant-design/icons'
import { Alert, Card, Col, Row, Space, Statistic, Tabs, Typography, message } from 'antd'
import { useEffect } from 'react'
import ExecutionHistory from '../components/self-healing/ExecutionHistory'
import RuleFormDrawer from '../components/self-healing/RuleFormDrawer'
import RuleTable from '../components/self-healing/RuleTable'
import { useSelfHealingStore } from '../stores/selfHealingStore'
import { getErrorMessage } from '../api/http'

export default function SelfHealingRules() {
  const {
    rules,
    history,
    loading,
    saving,
    drawerOpen,
    editingRule,
    historyRuleId,
    load,
    openCreate,
    openEdit,
    closeDrawer,
    saveRule,
    toggleRule,
    deleteRule,
    copyRule,
    evaluateRule,
    filterHistory,
    exportLogs,
  } = useSelfHealingStore()

  useEffect(() => {
    load()
  }, [load])

  const enabledCount = rules.filter((rule) => rule.enabled).length
  const totalTriggers = rules.reduce((sum, rule) => sum + rule.triggerCount, 0)
  const averageSuccess = rules.length
    ? Math.round(rules.reduce((sum, rule) => sum + rule.successRate, 0) / rules.length)
    : 0

  const handleEvaluate = async (rule) => {
    try {
      const execution = await evaluateRule(rule.id)
      if (execution) message.success(`规则已命中：${execution.ruleName}`)
      else message.info('本次手动评估未命中条件')
    } catch (error) {
      message.error(getErrorMessage(error, '手动评估失败'))
    }
  }

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Typography.Title level={3}>故障自愈规则引擎</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              基于真实主机指标、日志和服务事件评估自愈规则；默认安全模式只记录计划动作，显式开启后可受控执行服务启动/重启。
            </Typography.Paragraph>
          </div>
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-blue-200">
            React + Ant Design + TailwindCSS
          </div>
        </div>
      </Card>

      <Alert
        showIcon
        type="info"
        message="自愈规则默认安全模式，支持显式受控执行"
        description="规则会真实检测主机指标、日志和服务事件；未开启受控执行时只记录计划动作和执行历史。开启受控执行后，仅启动服务/重启服务会使用已保存 Pull 凭据执行 systemctl 或 Start-Service/Restart 流程；脚本、扩缩容和任意命令仍不会自动执行。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}>
          <Card><Statistic title="规则总数" value={rules.length} prefix={<ToolOutlined />} /></Card>
        </Col>
        <Col xs={24} md={6}>
          <Card><Statistic title="已启用" value={enabledCount} prefix={<ThunderboltOutlined />} styles={{ content: { color: '#52c41a' } }} /></Card>
        </Col>
        <Col xs={24} md={6}>
          <Card><Statistic title="累计触发" value={totalTriggers} prefix={<WarningOutlined />} /></Card>
        </Col>
        <Col xs={24} md={6}>
          <Card><Statistic title="平均成功率" value={averageSuccess} suffix="%" prefix={<CheckCircleOutlined />} styles={{ content: { color: averageSuccess >= 90 ? '#52c41a' : '#faad14' } }} /></Card>
        </Col>
      </Row>

      <Tabs
        items={[
          {
            key: 'rules',
            label: '规则列表',
            children: (
              <RuleTable
                rules={rules}
                loading={loading}
                onCreate={openCreate}
                onEdit={openEdit}
                onDelete={deleteRule}
                onCopy={copyRule}
                onToggle={toggleRule}
                onEvaluate={handleEvaluate}
              />
            ),
          },
          {
            key: 'history',
            label: '执行历史',
            children: (
              <ExecutionHistory
                rules={rules}
                history={history}
                selectedRuleId={historyRuleId}
                onFilterRule={filterHistory}
                onExport={exportLogs}
              />
            ),
          },
        ]}
      />

      <RuleFormDrawer open={drawerOpen} editingRule={editingRule} saving={saving} onClose={closeDrawer} onSubmit={saveRule} />
    </Space>
  )
}
