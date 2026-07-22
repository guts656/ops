import { CheckCircleOutlined, FileSearchOutlined, ImportOutlined, UploadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Checkbox, Col, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, Upload, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage } from '../api/http'
import { queryHosts } from '../api/hosts'
import { importXm2MonitorRules, previewXm2MonitorJson } from '../api/logs'
import type { Xm2ConvertedRulePreview, Xm2ConvertPreviewResult, Xm2SkippedItem } from '../types/log'
import type { Host } from '../types/host'

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024
const weekdayOptions = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
]

type HostScope = 'all' | 'single' | 'multiple' | 'group'

interface ImportFormValues {
  rawJson?: string
  hostScope: HostScope
  hostId?: string
  hostIds?: string[]
  hostGroup?: string
  daysOfWeek?: number[]
  holidayMode?: 'ignore' | 'include' | 'exclude'
  holidaysText?: string
}

async function readText(file: File) {
  const buffer = await file.arrayBuffer()
  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

function timeText(rule: Xm2ConvertedRulePreview['rule']) {
  if (!rule.timeRanges?.length) return '全天'
  return rule.timeRanges.map((range) => `${range.start}-${range.end}`).join('；')
}

function splitLines(value?: string) {
  return (value || '').split(/[\n,，;；]+/).map((item) => item.trim()).filter(Boolean)
}

export default function Xm2Converter() {
  const [form] = Form.useForm<ImportFormValues>()
  const navigate = useNavigate()
  const [hosts, setHosts] = useState<Host[]>([])
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [preview, setPreview] = useState<Xm2ConvertPreviewResult>()
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const hostScope = Form.useWatch('hostScope', form) ?? 'group'

  const hostOptions = useMemo(() => hosts.map((host) => ({ label: `${host.ip} / ${host.hostname}`, value: host.id })), [hosts])
  const groupOptions = useMemo(() => Array.from(new Set(hosts.map((host) => host.group).filter(Boolean))).sort().map((group) => ({ label: group, value: group })), [hosts])
  const selectedCandidates = useMemo(() => (preview?.candidates ?? []).filter((item) => selectedKeys.includes(item.key)), [preview, selectedKeys])

  useEffect(() => {
    form.setFieldsValue({ hostScope: 'group', daysOfWeek: [1, 2, 3, 4, 5], holidayMode: 'ignore' })
    queryHosts({}).then(setHosts).catch(() => setHosts([]))
  }, [form])

  const parsePreview = async () => {
    const rawJson = form.getFieldValue('rawJson')?.trim()
    if (!rawJson) {
      message.warning('请上传或粘贴 monitor.json 内容')
      return
    }
    setLoading(true)
    try {
      const result = await previewXm2MonitorJson({ rawJson })
      setPreview(result)
      setSelectedKeys(result.candidates.map((item) => item.key))
      message.success(`解析完成：可转换 ${result.summary.convertible} 条，跳过 ${result.summary.skipped} 条`)
    } catch (error) {
      message.error(getErrorMessage(error, 'xm2 解析失败'))
    } finally {
      setLoading(false)
    }
  }

  const validateHostScope = async () => {
    const values = await form.validateFields(['hostScope', 'hostId', 'hostIds', 'hostGroup'])
    if (values.hostScope === 'single' && !values.hostId) throw new Error('请选择主机')
    if (values.hostScope === 'multiple' && !values.hostIds?.length) throw new Error('请选择至少一台主机')
    if (values.hostScope === 'group' && !values.hostGroup) throw new Error('请选择主机组')
    return values
  }

  const submitImport = async () => {
    if (!selectedCandidates.length) {
      message.warning('请选择要导入的规则')
      return
    }
    let values: ImportFormValues
    try {
      values = await validateHostScope()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '请完善主机范围')
      return
    }

    Modal.confirm({
      title: '确认导入 xm2 日志监控规则？',
      content: `将导入 ${selectedCandidates.length} 条规则，导入后默认停用，统一应用当前主机范围。`,
      okText: '确认导入',
      cancelText: '取消',
      onOk: async () => {
        setImporting(true)
        try {
          const result = await importXm2MonitorRules({
            rules: selectedCandidates.map((item) => item.rule),
            hostScope: values.hostScope,
            hostId: values.hostId,
            hostIds: values.hostIds,
            hostGroup: values.hostGroup,
            daysOfWeek: values.daysOfWeek ?? [],
            holidayMode: values.holidayMode ?? 'ignore',
            holidays: splitLines(values.holidaysText),
          })
          if (result.failed.length) message.warning(`导入完成：成功 ${result.imported.length} 条，失败 ${result.failed.length} 条`)
          else message.success(`导入完成：成功 ${result.imported.length} 条，规则默认停用`)
        } catch (error) {
          message.error(getErrorMessage(error, 'xm2 导入失败'))
        } finally {
          setImporting(false)
        }
      },
    })
  }

  const candidateColumns: ColumnsType<Xm2ConvertedRulePreview> = [
    { title: '规则名称', dataIndex: ['rule', 'name'], width: 220, render: (_, record) => <Space direction="vertical" size={0}><Typography.Text strong>{record.rule.name}</Typography.Text><Typography.Text type="secondary">#{record.legacyKey || record.legacyIndex}</Typography.Text></Space> },
    { title: '日志路径', dataIndex: 'sourceFile', ellipsis: true, render: (value) => <Typography.Text code copyable={{ text: value }}>{value}</Typography.Text> },
    { title: '关键字', width: 180, render: (_, record) => record.rule.keywords.map((keyword) => <Tag key={keyword}>{keyword}</Tag>) },
    { title: '阈值/窗口', width: 130, render: (_, record) => `${record.rule.threshold} 次 / ${record.rule.windowMinutes} 分钟` },
    { title: '时间段', width: 180, render: (_, record) => timeText(record.rule) },
    { title: '状态', width: 100, render: () => <Tag color="default">默认停用</Tag> },
    { title: '提示', width: 180, render: (_, record) => record.warnings.length ? <Typography.Text type="warning">{record.warnings.join('；')}</Typography.Text> : '-' },
  ]

  const skippedColumns: ColumnsType<Xm2SkippedItem> = [
    { title: '序号', dataIndex: 'legacyIndex', width: 80 },
    { title: 'Key', dataIndex: 'legacyKey', width: 100, render: (value) => value || '-' },
    { title: '类型', dataIndex: 'type', width: 120, render: (value) => value || '-' },
    { title: '模式', dataIndex: 'mode', width: 100, render: (value) => value || '-' },
    { title: '日志路径', dataIndex: 'source', ellipsis: true, render: (value) => value || '-' },
    { title: '原因', dataIndex: 'reason', width: 260 },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Typography.Title level={3}>xm2 转换</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>上传或粘贴旧 monitor.json，只转换文件内容包含类日志监控，先预览再批量导入为停用规则。</Typography.Paragraph>
          </div>
          <Button icon={<FileSearchOutlined />} onClick={() => navigate('/log-monitoring')}>查看日志监控</Button>
        </div>
      </Card>

      <Alert type="info" showIcon message="安全策略" description="只转换 type=fileContent 且 mode=include 的规则；exclude 和非日志监控只进入跳过报告。导入后的规则统一默认停用，需要确认采集路径和阈值后再启用。" />

      <Form form={form} layout="vertical" initialValues={{ hostScope: 'group' }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Card title="1. 上传或粘贴 monitor.json">
              <Upload
                accept=".json,.txt"
                fileList={fileList}
                maxCount={1}
                beforeUpload={async (file) => {
                  if (file.size > MAX_UPLOAD_SIZE) {
                    message.error('文件不能超过 5MB')
                    return Upload.LIST_IGNORE
                  }
                  setFileList([file])
                  form.setFieldValue('rawJson', await readText(file))
                  return false
                }}
                onRemove={() => {
                  setFileList([])
                  form.setFieldValue('rawJson', '')
                }}
              >
                <Button icon={<UploadOutlined />}>选择 monitor.json</Button>
              </Upload>
              <Form.Item name="rawJson" label="JSON 内容" style={{ marginTop: 16 }}>
                <Input.TextArea rows={10} placeholder="也可以直接粘贴 monitor.json 内容" />
              </Form.Item>
              <Button type="primary" icon={<FileSearchOutlined />} loading={loading} onClick={parsePreview}>解析预览</Button>
            </Card>
          </Col>

          <Col xs={24} xl={10}>
            <Card title="2. 统一主机范围">
              <Form.Item name="hostScope" label="应用范围" rules={[{ required: true }]}>
                <Select options={[{ label: '全部主机', value: 'all' }, { label: '单台主机', value: 'single' }, { label: '多台主机', value: 'multiple' }, { label: '主机组', value: 'group' }]} />
              </Form.Item>
              {hostScope === 'single' ? <Form.Item name="hostId" label="主机" rules={[{ required: true, message: '请选择主机' }]}><Select showSearch optionFilterProp="label" options={hostOptions} /></Form.Item> : null}
              {hostScope === 'multiple' ? <Form.Item name="hostIds" label="多台主机" rules={[{ required: true, message: '请选择至少一台主机' }]}><Select mode="multiple" showSearch optionFilterProp="label" options={hostOptions} /></Form.Item> : null}
              {hostScope === 'group' ? <Form.Item name="hostGroup" label="主机组" rules={[{ required: true, message: '请选择主机组' }]}><Select showSearch optionFilterProp="label" options={groupOptions} /></Form.Item> : null}
              <Form.Item name="daysOfWeek" label="生效星期">
                <Checkbox.Group options={weekdayOptions} />
              </Form.Item>
              <Form.Item name="holidayMode" label="假日策略">
                <Select options={[{ label: '忽略假日设置', value: 'ignore' }, { label: '仅指定假日生效', value: 'include' }, { label: '指定假日不生效', value: 'exclude' }]} />
              </Form.Item>
              <Form.Item name="holidaysText" label="指定假日">
                <Input.TextArea rows={3} placeholder="每行一个日期，例如 2026-05-01" />
              </Form.Item>
              <Typography.Paragraph type="secondary">导入时会把主机范围、星期和假日策略应用到全部选中规则。日志采集规则不会自动创建，请确认对应主机或主机组已采集这些文件路径。</Typography.Paragraph>
            </Card>
          </Col>
        </Row>
      </Form>

      {preview ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Card><Statistic title="总规则" value={preview.summary.total} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="可转换" value={preview.summary.convertible} valueStyle={{ color: '#1677ff' }} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="已选中" value={selectedCandidates.length} valueStyle={{ color: '#52c41a' }} /></Card></Col>
            <Col xs={12} md={6}><Card><Statistic title="跳过" value={preview.summary.skipped} valueStyle={{ color: '#faad14' }} /></Card></Col>
          </Row>

          <Card title="3. 转换预览" extra={<Button type="primary" icon={<ImportOutlined />} loading={importing} disabled={!selectedCandidates.length} onClick={submitImport}>导入选中规则</Button>}>
            <Table
              rowKey="key"
              columns={candidateColumns}
              dataSource={preview.candidates}
              rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
              pagination={{ pageSize: 10 }}
            />
          </Card>

          <Card title="跳过报告" extra={<Space><Tag color="green" icon={<CheckCircleOutlined />}>非日志/不支持规则不会导入</Tag><Checkbox checked={selectedKeys.length === preview.candidates.length && preview.candidates.length > 0} indeterminate={selectedKeys.length > 0 && selectedKeys.length < preview.candidates.length} onChange={(event) => setSelectedKeys(event.target.checked ? preview.candidates.map((item) => item.key) : [])}>全选可转换规则</Checkbox></Space>}>
            <Table rowKey={(record) => `${record.legacyIndex}-${record.reason}`} columns={skippedColumns} dataSource={preview.skipped} pagination={{ pageSize: 8 }} />
          </Card>
        </>
      ) : null}
    </Space>
  )
}
