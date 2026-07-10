import { Alert, Card, Col, Flex, Form, Input, InputNumber, Row, Select, Space, Switch, Typography, message } from 'antd'
import type { FormInstance } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { getHostServices } from '../../api/hosts'
import { getErrorMessage } from '../../api/http'
import type { Host } from '../../types/host'
import type { HostServiceItem } from '../../types/service'

interface SelfHealingBindingCardProps {
  form: FormInstance<any>
  namePath?: (string | number)[]
  hosts: Host[]
  description?: string
  safeDescription?: string
  controlledDescription?: string
}

function pathOf(base: (string | number)[], key: string) {
  return [...base, key]
}

export default function SelfHealingBindingCard({
  form,
  namePath = ['selfHealingBinding'],
  hosts,
  description = '开启后系统自动维护自愈规则和告警自动处理映射，监控异常告警会触发对应动作。',
  safeDescription = '异常后会自动写入自愈执行历史和计划动作，不会执行远程命令。',
  controlledDescription = '只允许启动服务/重启服务；不会执行脚本、扩缩容或任意命令。请确认目标主机 Pull 凭据可用且服务选择准确。',
}: SelfHealingBindingCardProps) {
  const [services, setServices] = useState<HostServiceItem[]>([])
  const [loadingServices, setLoadingServices] = useState(false)
  const enabled = Form.useWatch(pathOf(namePath, 'enabled'), form)
  const autoExecute = Form.useWatch(pathOf(namePath, 'autoExecute'), form)
  const targetHostId = Form.useWatch(pathOf(namePath, 'targetHostId'), form)

  const hostOptions = useMemo(() => hosts.map((host) => ({
    label: `${host.ip} · ${host.hostname}${host.pullCredential?.enabled ? '' : '（未启用Pull凭据）'}`,
    value: host.id,
    disabled: !host.pullCredential?.enabled,
  })), [hosts])

  useEffect(() => {
    if (!enabled || !targetHostId) {
      setServices([])
      return
    }
    let cancelled = false
    setLoadingServices(true)
    getHostServices(targetHostId)
      .then((items) => {
        if (!cancelled) setServices(items)
      })
      .catch((error) => {
        if (!cancelled) {
          setServices([])
          message.warning(getErrorMessage(error, '加载目标主机服务清单失败，可手工填写服务名'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingServices(false)
      })
    return () => { cancelled = true }
  }, [enabled, targetHostId])

  const serviceOptions = services.map((service) => ({
    label: `${service.name}${service.port ? ` · ${service.port}` : ''}${service.status ? ` · ${service.status}` : ''}`,
    value: service.id,
    service,
  }))

  return (
    <Card size="small" title="异常自愈绑定" style={{ marginBottom: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Form.Item name={pathOf(namePath, 'executionMode')} hidden><Input /></Form.Item>
        <div className="rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
          <Flex justify="space-between" align="center" gap="middle">
            <div>
              <Typography.Text strong>启用异常后自愈</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{description}</Typography.Paragraph>
            </div>
            <Form.Item name={pathOf(namePath, 'enabled')} valuePropName="checked" noStyle>
              <Switch checkedChildren="已绑定" unCheckedChildren="未绑定" />
            </Form.Item>
          </Flex>
        </div>

        {enabled && (
          <>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name={pathOf(namePath, 'actionType')} label="动作类型" rules={[{ required: true }]}>
                  <Select options={['重启服务', '启动服务'].map((value) => ({ label: value, value }))} />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name={pathOf(namePath, 'targetHostId')} label="自愈目标主机" extra="探测/日志来源主机和自愈目标主机可以不同；受控执行必须选择明确目标主机。">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={hostOptions}
                    placeholder="请选择要执行启动/重启动作的主机"
                    onChange={() => {
                      form.setFieldValue(pathOf(namePath, 'targetServiceId'), undefined)
                      form.setFieldValue(pathOf(namePath, 'targetServiceName'), '')
                    }}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name={pathOf(namePath, 'targetServiceId')} label="目标服务（服务清单）" extra="优先按服务记录 ID 精确定位；服务清单为空时可在右侧手工填写服务名。">
                  <Select
                    allowClear
                    showSearch
                    loading={loadingServices}
                    optionFilterProp="label"
                    options={serviceOptions}
                    placeholder={targetHostId ? '选择目标主机上的服务' : '请先选择目标主机'}
                    onChange={(serviceId) => {
                      const service = services.find((item) => item.id === serviceId)
                      if (service) form.setFieldValue(pathOf(namePath, 'targetServiceName'), service.name)
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name={pathOf(namePath, 'targetServiceName')} label="目标服务名" rules={[{ required: true, message: '请输入目标服务名或选择服务记录' }]}>
                  <Input placeholder="例如 nginx.service、tomcat.service" />
                </Form.Item>
              </Col>
            </Row>

            {targetHostId && !loadingServices && !services.length && (
              <Alert showIcon type="info" message="服务清单为空时仍可填写服务名" description="保存后执行会限定在所选目标主机内按服务名查找，不会按全局服务名重启。" />
            )}

            <Row gutter={16}>
              <Col span={8}><Form.Item name={pathOf(namePath, 'cooldownMinutes')} label="自愈冷却期"><InputNumber min={1} max={1440} style={{ width: '100%' }} addonAfter="分钟" /></Form.Item></Col>
              <Col span={8}><Form.Item name={pathOf(namePath, 'retries')} label="重试次数"><InputNumber min={0} max={2} style={{ width: '100%' }} addonAfter="次" /></Form.Item></Col>
              <Col span={8}><Form.Item name={pathOf(namePath, 'priority')} label="自愈优先级"><Select allowClear options={['P0', 'P1', 'P2', 'P3'].map((value) => ({ label: value, value }))} placeholder="按告警级别自动" /></Form.Item></Col>
            </Row>

            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4">
              <Flex justify="space-between" align="center" gap="middle">
                <div>
                  <Typography.Text strong>允许受控自动执行</Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    关闭时只记录计划动作；开启后才会真实执行启动/重启服务，且要求目标主机明确、服务唯一、Pull 凭据可用、主机不在维护中。
                  </Typography.Paragraph>
                </div>
                <Form.Item name={pathOf(namePath, 'autoExecute')} valuePropName="checked" noStyle>
                  <Switch
                    checkedChildren="受控执行"
                    unCheckedChildren="安全模式"
                    onChange={(checked) => form.setFieldValue(pathOf(namePath, 'executionMode'), checked ? 'controlled' : 'safe')}
                  />
                </Form.Item>
              </Flex>
            </div>
            <Alert
              showIcon
              type={autoExecute ? 'warning' : 'info'}
              message={autoExecute ? '受控执行会真实启动/重启服务' : '当前为安全模式'}
              description={autoExecute ? controlledDescription : safeDescription}
            />
          </>
        )}
      </Space>
    </Card>
  )
}
