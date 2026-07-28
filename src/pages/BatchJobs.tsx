import { CodeOutlined, DownloadOutlined, FileAddOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Progress, Radio, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, Upload, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { useEffect, useMemo, useState } from 'react'
import PermissionGate from '../components/auth/PermissionGate'
import { createBatchJob, downloadBatchArtifact, listBatchJobs } from '../api/batchJobs'
import { queryHosts } from '../api/hosts'
import { PERMISSIONS } from '../config/permissions'
import type { BatchJob, BatchJobTarget, BatchJobType, CreateBatchJobValues } from '../types/batchJob'
import type { Host } from '../types/host'
import { getErrorMessage } from '../api/http'

const statusColor: Record<string, string> = { running: 'blue', success: 'green', failed: 'red', partial: 'gold' }
const typeLabel: Record<BatchJobType, string> = { upload_file: '批量上传文件', run_script: '批量执行脚本', compare_file: '小文件对比', download_file: '小文件下载' }
const MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024
const DEFAULT_FILE_READ_LIMIT = 1024 * 1024
const targetStatusOrder: Record<string, number> = { failed: 0, running: 1, partial: 2, success: 3 }

function outputText(value: string) {
  return value?.trim() || '-'
}

function statusText(value: string) {
  if (value === 'running') return '执行中'
  if (value === 'success') return '成功'
  if (value === 'failed') return '失败'
  if (value === 'partial') return '部分成功'
  return value
}

function jobProgress(job: BatchJob) {
  if (!job.totalTargets) return 0
  return Math.round(((job.successTargets + job.failedTargets) / job.totalTargets) * 100)
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function isFileJob(type: BatchJobType) {
  return type === 'upload_file' || type === 'compare_file' || type === 'download_file'
}

function canUseBatchHost(host: Host) {
  return host.os === 'Linux' || Boolean(host.pullCredential?.enabled)
}

function batchHostLabel(host: Host) {
  if (host.os === 'Linux' && !host.pullCredential?.enabled) return `${host.ip} · ${host.hostname}（平台 SSH 密钥）`
  if (host.pullCredential?.enabled) return `${host.ip} · ${host.hostname}`
  return `${host.ip} · ${host.hostname}（未保存 WinRM Pull 凭据）`
}

function canUseBatchHostForType(host: Host, jobType: BatchJobType) {
  if (host.os === 'Linux') return true
  if (jobType === 'run_script') return host.status === '在线' && host.agentStatus === '正常'
  return Boolean(host.pullCredential?.enabled)
}

function batchHostLabelForType(host: Host, jobType: BatchJobType) {
  if (host.os === 'Linux' && !host.pullCredential?.enabled) return `${host.ip} / ${host.hostname}（平台 SSH 密钥）`
  if (host.os === 'Windows' && jobType === 'run_script' && host.status === '在线' && host.agentStatus === '正常') return `${host.ip} / ${host.hostname}（Agent 通道）`
  if (host.os === 'Windows' && jobType === 'run_script') return `${host.ip} / ${host.hostname}（Agent 未在线/未正常）`
  if (host.pullCredential?.enabled) return `${host.ip} / ${host.hostname}`
  return `${host.ip} / ${host.hostname}（文件类任务需历史 WinRM Pull 凭据）`
}

function formatBytes(bytes?: number) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function md5Of(stdout: string) {
  return stdout.match(/MD5=([a-f0-9]{32})/i)?.[1]
}

function bytesOf(stdout: string) {
  const value = Number(stdout.match(/BYTES=(\d+)/)?.[1])
  return Number.isFinite(value) ? value : undefined
}

export default function BatchJobs() {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [hosts, setHosts] = useState<Host[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedJob, setSelectedJob] = useState<BatchJob>()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [form] = Form.useForm<CreateBatchJobValues>()
  const jobType = Form.useWatch('type', form) ?? 'upload_file'
  const targetMode = Form.useWatch('targetMode', form) ?? 'hosts'
  const targetOs = Form.useWatch('targetOs', form) ?? 'Linux'
  const targetHosts = useMemo(() => hosts.filter((host) => host.os === targetOs), [hosts, targetOs])
  const selectableHosts = useMemo(() => targetHosts.filter((host) => canUseBatchHostForType(host, jobType)), [targetHosts, jobType])
  const hostGroups = useMemo(() => Array.from(new Set(selectableHosts.map((host) => host.group).filter(Boolean))).sort(), [selectableHosts])

  const load = async () => {
    setLoading(true)
    try {
      const [nextJobs, nextHosts] = await Promise.all([listBatchJobs(), queryHosts({})])
      setJobs(nextJobs)
      setSelectedJob((current) => current ? nextJobs.find((job) => job.id === current.id) ?? current : undefined)
      setHosts(nextHosts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!jobs.some((job) => job.status === 'running')) return undefined
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [jobs])

  const stats = useMemo(() => ({
    total: jobs.length,
    success: jobs.filter((job) => job.status === 'success').length,
    running: jobs.filter((job) => job.status === 'running').length,
    failed: jobs.filter((job) => job.status === 'failed' || job.status === 'partial').length,
  }), [jobs])

  const submit = async (values: CreateBatchJobValues) => {
    setSubmitting(true)
    try {
      let payload: CreateBatchJobValues = { ...values, targetMode: values.targetMode || 'hosts' }
      if (payload.targetMode === 'group') payload.hostIds = []
      if (values.type === 'upload_file') {
        const originFile = fileList[0]?.originFileObj
        if (!originFile) throw new Error('请上传文件')
        if (originFile.size > MAX_UPLOAD_FILE_SIZE) throw new Error('单个上传文件不能超过 5MB')
        payload = { ...payload, fileName: values.fileName || originFile.name, fileContentBase64: await fileToBase64(originFile) }
      }
      if (values.type === 'compare_file' || values.type === 'download_file') {
        payload = { ...payload, maxFileSize: values.maxFileSize || DEFAULT_FILE_READ_LIMIT }
      }
      const job = await createBatchJob(payload)
      message.success(`批处理已提交：${job.summary}`)
      setModalOpen(false)
      form.resetFields()
      setFileList([])
      await load()
      setSelectedJob(job)
    } catch (error) {
      message.error(getErrorMessage(error, '批处理提交失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const jobColumns: ColumnsType<BatchJob> = [
    { title: '任务名称', dataIndex: 'name', render: (_, record) => <Space direction="vertical" size={0}><Typography.Text strong>{record.name}</Typography.Text><Typography.Text type="secondary">{typeLabel[record.type]}</Typography.Text></Space> },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={statusColor[value]}>{statusText(value)}</Tag> },
    { title: '进度', width: 150, render: (_, record) => <Progress percent={jobProgress(record)} size="small" status={record.status === 'failed' ? 'exception' : record.status === 'success' ? 'success' : 'active'} /> },
    { title: '目标', render: (_, record) => `${record.successTargets}/${record.totalTargets} 成功，${record.failedTargets} 失败` },
    {
      title: '文件/目录',
      render: (_, record) => isFileJob(record.type)
        ? <Space direction="vertical" size={0}><Typography.Text>{record.fileName} → {record.targetDirectory}</Typography.Text>{record.fileMd5 || record.baselineMd5 ? <Typography.Text type="secondary" code>MD5 {record.fileMd5 || record.baselineMd5}</Typography.Text> : null}{record.hostGroup ? <Typography.Text type="secondary">主机组：{record.hostGroup}</Typography.Text> : null}</Space>
        : '-',
    },
    { title: '操作人', dataIndex: 'operator' },
    { title: '开始时间', dataIndex: 'startedAt', width: 180 },
    { title: '摘要', dataIndex: 'summary' },
    { title: '操作', width: 100, render: (_, record) => <Button type="link" onClick={() => setSelectedJob(record)}>日志</Button> },
  ]

  const targetColumns: ColumnsType<BatchJobTarget> = [
    { title: '主机', render: (_, record) => <Space direction="vertical" size={0}><Typography.Text>{record.hostIp}</Typography.Text><Typography.Text type="secondary">{record.hostname}</Typography.Text></Space> },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={statusColor[value]}>{statusText(value)}</Tag> },
    { title: '远端路径', dataIndex: 'remotePath', render: (value) => value || '-' },
    { title: '退出码', dataIndex: 'exitCode', render: (value) => value ?? '-' },
    { title: '摘要', dataIndex: 'summary' },
    { title: '完成时间', dataIndex: 'completedAt', width: 180, render: (value) => value || '-' },
  ]

  const selectedTargets = selectedJob ? [...selectedJob.targets].sort((a, b) => (targetStatusOrder[a.status] ?? 9) - (targetStatusOrder[b.status] ?? 9)) : []

  const resultColumns: ColumnsType<BatchJobTarget> = [
    {
      title: '主机',
      width: 190,
      render: (_, record) => <Space direction="vertical" size={0}><Typography.Text strong>{record.hostIp}</Typography.Text><Typography.Text type="secondary">{record.hostname}</Typography.Text></Space>,
    },
    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag color={statusColor[value]}>{statusText(value)}</Tag> },
    {
      title: '文件信息',
      width: 260,
      render: (_, record) => selectedJob && (selectedJob.type === 'compare_file' || selectedJob.type === 'download_file') ? (
        <Space direction="vertical" size={0}>
          <Typography.Text>大小：{formatBytes(bytesOf(record.stdout) ?? record.artifacts?.[0]?.size)}</Typography.Text>
          <Typography.Text code copyable={{ text: md5Of(record.stdout) || record.artifacts?.[0]?.md5 || '' }}>MD5 {md5Of(record.stdout) || record.artifacts?.[0]?.md5 || '-'}</Typography.Text>
          {selectedJob.type === 'download_file' && record.artifacts?.[0] ? <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadBatchArtifact(selectedJob.id, record.artifacts![0])}>下载</Button> : null}
        </Space>
      ) : <Typography.Text type="secondary">退出码：{record.exitCode ?? '-'}</Typography.Text>,
    },
    {
      title: '执行结果',
      render: (_, record) => (
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Typography.Text type={record.status === 'failed' ? 'danger' : 'secondary'}>{record.summary}</Typography.Text>
          <Row gutter={12}>
            <Col span={12}>
              <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
                <Typography.Text strong>stdout</Typography.Text>
                <Button size="small" onClick={() => navigator.clipboard.writeText(record.stdout || '')}>复制</Button>
              </Flex>
              <pre className="self-healing-log" style={{ maxHeight: 180, overflow: 'auto' }}>{outputText(record.stdout)}</pre>
            </Col>
            <Col span={12}>
              <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
                <Typography.Text strong>stderr</Typography.Text>
                <Button size="small" onClick={() => navigator.clipboard.writeText(record.stderr || '')}>复制</Button>
              </Flex>
              <pre className="self-healing-log" style={{ maxHeight: 180, overflow: 'auto' }}>{outputText(record.stderr)}</pre>
            </Col>
          </Row>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Typography.Title level={3}>批处理</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>面向已纳管主机批量上传文件、执行脚本、小文件对比和下载，并集中查看执行记录和输出日志。</Typography.Paragraph>
          </div>
          <PermissionGate permission={PERMISSIONS.BATCH_EXECUTE}>
            <Button type="primary" icon={<FileAddOutlined />} onClick={() => setModalOpen(true)}>新建批处理</Button>
          </PermissionGate>
        </div>
      </Card>

      <Alert type="warning" showIcon message="批处理不会在 API 中传主机密码：Linux 默认使用平台 SSH 密钥；Windows 仅支持历史上已保存 WinRM Pull 凭据的主机。文件对比/下载仅支持小文件，平台会先校验大小并记录 MD5。" />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><Card><Statistic title="任务总数" value={stats.total} prefix={<FileAddOutlined />} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="执行中" value={stats.running} valueStyle={{ color: stats.running ? '#1677ff' : undefined }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="成功任务" value={stats.success} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="需关注任务" value={stats.failed} valueStyle={{ color: stats.failed ? '#faad14' : '#52c41a' }} /></Card></Col>
      </Row>

      <Card title="执行记录" extra={<Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>}>
        <Table rowKey="id" loading={loading} columns={jobColumns} dataSource={jobs} pagination={{ pageSize: 8 }} />
      </Card>

      <Modal title="新建批处理" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} confirmLoading={submitting} width={820} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ type: 'upload_file', targetMode: 'hosts', targetOs: 'Linux', maxFileSize: DEFAULT_FILE_READ_LIMIT }} onFinish={submit}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}><Input placeholder="例如：批量对比配置文件" /></Form.Item>
          <Form.Item name="type" label="任务类型" rules={[{ required: true }]}><Radio.Group optionType="button" buttonStyle="solid" options={[{ label: '批量上传文件', value: 'upload_file' }, { label: '批量执行脚本', value: 'run_script' }, { label: '小文件对比', value: 'compare_file' }, { label: '小文件下载', value: 'download_file' }]} /></Form.Item>
          <Form.Item name="targetOs" label="目标系统" rules={[{ required: true }]}><Radio.Group optionType="button" buttonStyle="solid" onChange={() => form.setFieldsValue({ hostIds: [], hostGroup: undefined })} options={[{ label: 'Linux', value: 'Linux' }, { label: 'Windows', value: 'Windows' }]} /></Form.Item>
          <Form.Item name="targetMode" label="目标范围" rules={[{ required: true }]}><Radio.Group optionType="button" buttonStyle="solid" onChange={() => form.setFieldsValue({ hostIds: [], hostGroup: undefined })} options={[{ label: '指定主机', value: 'hosts' }, { label: '主机组', value: 'group' }]} /></Form.Item>
          {targetMode === 'hosts' ? (
            <Form.Item
              name="hostIds"
              label="目标主机"
              rules={[{ required: true, message: '请选择目标主机' }]}
              extra={targetHosts.length && !selectableHosts.length ? (targetOs === 'Windows' ? (jobType === 'run_script' ? 'Windows 脚本批处理通过 Agent 通道执行，请确认目标主机在线且 Agent 正常。' : 'Windows 文件类批处理暂时仍需要历史 WinRM Pull 凭据；建议优先使用脚本任务。') : 'Linux 批处理默认使用平台 SSH 密钥，请确认目标机已安装平台公钥。') : undefined}
            >
              <Select
                mode="multiple"
                placeholder={`选择 ${targetOs} 主机`}
                options={targetHosts.map((host) => ({
                  label: batchHostLabelForType(host, jobType),
                  value: host.id,
                  disabled: !canUseBatchHostForType(host, jobType),
                }))}
              />
            </Form.Item>
          ) : (
            <Form.Item name="hostGroup" label="主机组" rules={[{ required: true, message: '请选择主机组' }]} extra="按主机组执行时，服务端会自动解析该组内已纳管主机。">
              <Select placeholder={`选择 ${targetOs} 主机组`} options={hostGroups.map((group) => ({ label: group, value: group }))} />
            </Form.Item>
          )}

          {isFileJob(jobType) ? (
            <>
              <Form.Item name="targetDirectory" label="目标目录" rules={[{ required: true, message: targetOs === 'Windows' ? '请输入 Windows 盘符绝对路径' : '请输入 Linux 绝对路径' }]}><Input placeholder={targetOs === 'Windows' ? 'C:\\Temp\\ops-upload' : '/tmp/ops-upload'} /></Form.Item>
              <Form.Item name="fileName" label={jobType === 'upload_file' ? '远端文件名' : '文件名'} rules={jobType === 'upload_file' ? undefined : [{ required: true, message: '请输入文件名' }]}><Input placeholder={jobType === 'upload_file' ? '默认使用上传文件名' : '例如 app.conf'} /></Form.Item>
              {jobType === 'upload_file' ? (
                <Form.Item label="上传文件" required>
                  <Upload
                    beforeUpload={(file) => {
                      if (file.size > MAX_UPLOAD_FILE_SIZE) {
                        message.error('单个上传文件不能超过 5MB')
                        return Upload.LIST_IGNORE
                      }
                      return false
                    }}
                    maxCount={1}
                    fileList={fileList}
                    onChange={({ fileList }) => setFileList(fileList)}
                  >
                    <Button icon={<UploadOutlined />}>选择文件</Button>
                  </Upload>
                </Form.Item>
              ) : (
                <Form.Item name="maxFileSize" label="单文件大小限制" extra="默认 1MB，最大 5MB；超过限制会在远端读取前失败。">
                  <InputNumber min={1} max={MAX_UPLOAD_FILE_SIZE} step={1024} style={{ width: '100%' }} addonAfter="bytes" />
                </Form.Item>
              )}
            </>
          ) : (
            <Form.Item name="script" label="脚本内容" rules={[{ required: true, message: '请输入脚本内容' }]}>
              <Input.TextArea rows={10} placeholder={targetOs === 'Windows' ? 'Write-Output $env:COMPUTERNAME\nGet-Date\nGet-PSDrive C' : '#!/bin/bash\nset -e\nhostname\ndf -h /'} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title={selectedJob ? `执行日志：${selectedJob.name}` : '执行日志'} open={Boolean(selectedJob)} onCancel={() => setSelectedJob(undefined)} footer={null} width={1200}>
        {selectedJob && (
          <Tabs items={[{
            key: 'results',
            label: '执行结果',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert showIcon type={selectedJob.status === 'failed' ? 'error' : selectedJob.status === 'partial' ? 'warning' : selectedJob.status === 'running' ? 'info' : 'success'} message={`${statusText(selectedJob.status)}：${selectedJob.summary}`} description={selectedJob.status === 'running' ? '任务执行中，页面会每 5 秒自动刷新。' : '这里直接展示每台主机的 stdout/stderr；原始明细日志仍保留在“主机明细”页签。'} />
                <Table rowKey="id" columns={resultColumns} dataSource={selectedTargets} pagination={false} />
              </Space>
            ),
          }, {
            key: 'targets',
            label: '主机明细/日志',
            children: <Table rowKey="id" columns={targetColumns} dataSource={selectedTargets} pagination={false} expandable={{ expandedRowRender: (record) => <Space direction="vertical" style={{ width: '100%' }}><Typography.Text strong>stdout</Typography.Text><pre className="self-healing-log">{outputText(record.stdout)}</pre><Typography.Text strong>stderr</Typography.Text><pre className="self-healing-log">{outputText(record.stderr)}</pre></Space> }} />,
          }, {
            key: 'script',
            label: '脚本/参数',
            children: <pre className="self-healing-log">{selectedJob.type === 'run_script' ? selectedJob.script : `类型：${typeLabel[selectedJob.type]}\n目标范围：${selectedJob.targetMode === 'group' ? `主机组 ${selectedJob.hostGroup}` : '指定主机'}\n文件：${selectedJob.fileName || '-'}\n目标目录：${selectedJob.targetDirectory || '-'}\nMD5：${selectedJob.fileMd5 || selectedJob.baselineMd5 || '-'}`}</pre>,
          }]} />
        )}
      </Modal>
    </Space>
  )
}
