import { Alert, Button, Card, Col, Empty, List, Progress, Row, Space, Table, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AIChat from '../components/AIChat'
import { downloadHealthReport, generateWeeklyHealthReport, getHealthReport, healthReportPreviewUrl, listHealthReports } from '../api/healthReports'
import { getErrorMessage } from '../api/http'
import { formatShanghaiTime } from '../utils/time'

const healthLevelMeta = {
  excellent: { label: '优秀', color: 'green', status: 'success' },
  good: { label: '良好', color: 'blue', status: 'normal' },
  warning: { label: '需关注', color: 'gold', status: 'exception' },
  critical: { label: '高风险', color: 'red', status: 'exception' },
}

const severityColor = { success: 'green', info: 'blue', warning: 'gold', error: 'red' }
const priorityColor = { high: 'red', medium: 'gold', low: 'blue' }

function formatTime(value) {
  return formatShanghaiTime(value)
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}

function ReportDetail({ report }) {
  if (!report) return <Empty description="暂无健康周报，点击生成按钮创建第一份报告" />
  const meta = healthLevelMeta[report.healthLevel] || healthLevelMeta.good
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert type={report.healthLevel === 'critical' ? 'error' : report.healthLevel === 'warning' ? 'warning' : 'success'} showIcon message={report.title} description={report.summary} />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}><Card><Progress type="dashboard" percent={report.healthScore} status={meta.status} /><Typography.Title level={4} style={{ textAlign: 'center' }}><Tag color={meta.color}>{meta.label}</Tag></Typography.Title></Card></Col>
        <Col xs={24} md={16}>
          <Card title="报告信息">
            <Space direction="vertical">
              <Typography.Text>周期：{formatDate(report.periodStart)} 至 {formatDate(report.periodEnd)}</Typography.Text>
              <Typography.Text>生成时间：{formatTime(report.generatedAt)}</Typography.Text>
              <Typography.Text>生成方式：{report.generatedBy === 'system' ? '系统自动生成' : report.generatedBy}</Typography.Text>
              <Space wrap>
                <Button href={healthReportPreviewUrl(report.id)} target="_blank">预览 HTML 文件</Button>
                <Button onClick={() => downloadHealthReport(report)}>下载 HTML 文件</Button>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>
      <Card title="健康度低的原因">
        {report.causes.length ? (
          <List dataSource={report.causes} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><Tag color={severityColor[item.severity]}>{item.severity === 'error' ? '高风险' : '需关注'}</Tag><Typography.Text strong>{item.title}</Typography.Text></Space>} description={<Space direction="vertical">{item.evidence.map((text) => <Typography.Text key={text} type="secondary">{text}</Typography.Text>)}</Space>} /></List.Item>} />
        ) : <Empty description="未发现明显风险原因" />}
      </Card>
      <Card title="报告章节">
        <Space direction="vertical" style={{ width: '100%' }}>
          {report.sections.map((section) => (
            <Card key={section.key} size="small" title={<Space><Tag color={severityColor[section.severity]}>{section.title}</Tag><Typography.Text>{section.summary}</Typography.Text></Space>}>
              <ul style={{ marginBottom: 0 }}>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
            </Card>
          ))}
        </Space>
      </Card>
      <Card title="后续优化建议">
        <List dataSource={report.suggestions} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><Tag color={priorityColor[item.priority]}>{item.priority === 'high' ? '高' : item.priority === 'medium' ? '中' : '低'}优先级</Tag><Typography.Text strong>{item.title}</Typography.Text></Space>} description={<Space direction="vertical"><Typography.Text type="secondary">{item.rationale}</Typography.Text><ul style={{ marginBottom: 0 }}>{item.actions.map((action) => <li key={action}>{action}</li>)}</ul></Space>} /></List.Item>} />
      </Card>
    </Space>
  )
}

export default function AIAssistant() {
  const [searchParams] = useSearchParams()
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState()
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const loadReports = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listHealthReports({ pageSize: 20 })
      setReports(result.items)
      const reportId = searchParams.get('reportId')
      if (reportId) {
        const detail = await getHealthReport(reportId)
        setSelectedReport(detail)
      } else {
        setSelectedReport((current) => current ?? result.items[0])
      }
    } catch (error) {
      message.error(getErrorMessage(error, '健康周报加载失败'))
    } finally {
      setLoading(false)
    }
  }, [searchParams])

  useEffect(() => {
    void Promise.resolve().then(loadReports)
  }, [loadReports])

  const generateReport = async (force = false) => {
    setGenerating(true)
    try {
      const report = await generateWeeklyHealthReport({ force })
      message.success(force ? '健康周报已重新生成' : '健康周报已生成')
      setSelectedReport(report)
      await loadReports()
    } catch (error) {
      message.error(getErrorMessage(error, '健康周报生成失败'))
    } finally {
      setGenerating(false)
    }
  }

  const columns = useMemo(() => [
    { title: '报告周期', render: (_, record) => <Typography.Text>{formatDate(record.periodStart)} 至 {formatDate(record.periodEnd)}</Typography.Text> },
    { title: '健康度', dataIndex: 'healthScore', width: 100, render: (value, record) => <Space><Typography.Text strong>{value}</Typography.Text><Tag color={healthLevelMeta[record.healthLevel]?.color}>{healthLevelMeta[record.healthLevel]?.label}</Tag></Space> },
    { title: '生成时间', dataIndex: 'generatedAt', width: 180, render: formatTime },
    { title: '操作', width: 90, render: (_, record) => <Button type="link" onClick={() => setSelectedReport(record)}>查看</Button> },
  ], [])

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={3}>AI 助手</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          面向运维场景的对话窗口，可用于告警分析、巡检建议、应急处理步骤生成；系统健康周报基于真实运行数据自动生成，并可推送站内通知和企业微信/钉钉机器人。
        </Typography.Paragraph>
      </Card>

      <Card title="系统健康周报" extra={<Space><Button type="primary" loading={generating} onClick={() => generateReport(false)}>生成本周健康周报</Button><Button loading={generating} onClick={() => generateReport(true)}>重新生成</Button></Space>} loading={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={15}><ReportDetail report={selectedReport} /></Col>
          <Col xs={24} xl={9}>
            <Card title="历史周报" size="small">
              <Table rowKey="id" columns={columns} dataSource={reports} pagination={{ pageSize: 6 }} size="small" />
            </Card>
          </Col>
        </Row>
      </Card>

      <AIChat />
    </Space>
  )
}
