import { Alert, Button, Card, Checkbox, Col, Descriptions, Form, Input, Row, Space, Switch, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { getErrorMessage } from '../api/http'
import { getOutboundNotificationSettings, saveOutboundNotificationSettings, testOutboundNotification } from '../api/settings'
import PermissionGate from '../components/auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'
import { useAppStore } from '../stores/appStore'
import { useAuthStore } from '../stores/authStore'

const defaultSettings = {
  defaultChannels: ['站内告警'],
  dingTalk: { enabled: false, webhookUrl: '', receivers: '' },
  weCom: { enabled: false, webhookUrl: '', receivers: '' },
}

export default function Settings() {
  const { autoRefresh, setAutoRefresh, collapsed } = useAppStore()
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canManage = hasPermission(PERMISSIONS.SETTINGS_MANAGE)
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testingChannel, setTestingChannel] = useState('')
  const [testResults, setTestResults] = useState([])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const settings = await getOutboundNotificationSettings()
      form.setFieldsValue(settings)
    } catch (error) {
      message.error(getErrorMessage(error, '加载全局告警通知设置失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    void getOutboundNotificationSettings()
      .then((settings) => {
        if (mounted) form.setFieldsValue(settings)
      })
      .catch((error) => message.error(getErrorMessage(error, '加载全局告警通知设置失败')))
    return () => { mounted = false }
  }, [form])

  const saveSettings = async (values) => {
    setSaving(true)
    try {
      const settings = await saveOutboundNotificationSettings(values)
      form.setFieldsValue(settings)
      message.success('全局告警通知设置已保存')
    } catch (error) {
      message.error(getErrorMessage(error, '保存全局告警通知设置失败'))
    } finally {
      setSaving(false)
    }
  }

  const runTest = async (channel) => {
    const values = form.getFieldsValue(true)
    const channelValues = channel === '钉钉' ? values.dingTalk : values.weCom
    setTestingChannel(channel)
    try {
      const result = await testOutboundNotification({ channel, webhookUrl: channelValues?.webhookUrl })
      setTestResults(result.results)
      const failed = result.results.some((item) => item.includes('发送失败') || item.includes('未配置'))
      if (failed) message.warning(result.results.join('；'))
      else message.success(result.results.join('；'))
    } catch (error) {
      message.error(getErrorMessage(error, `${channel}测试发送失败`))
    } finally {
      setTestingChannel('')
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={3}>设置</Typography.Title>
        <Typography.Paragraph type="secondary">平台基础偏好、全局告警通知和运行信息。</Typography.Paragraph>
      </Card>

      <Card title="全局告警通知" loading={loading} extra={<Button onClick={loadSettings}>刷新</Button>}>
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          message="统一配置钉钉/企业微信机器人"
          description="监控规则未单独填写 Webhook 时，将使用这里的全局配置。钉钉机器人如开启关键词校验，请确保测试消息或告警标题包含机器人关键词。"
        />
        <Form form={form} layout="vertical" initialValues={defaultSettings} onFinish={saveSettings} disabled={!canManage}>
          <Form.Item name="defaultChannels" label="默认通知渠道" rules={[{ required: true, message: '请选择默认通知渠道' }]}>
            <Checkbox.Group options={['站内告警', '企业微信', '钉钉']} />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <Card size="small" title="钉钉机器人">
                <Form.Item name={['dingTalk', 'enabled']} label="启用钉钉" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name={['dingTalk', 'webhookUrl']} label="Webhook URL"><Input.Password placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." visibilityToggle={false} /></Form.Item>
                <Form.Item name={['dingTalk', 'receivers']} label="接收群/备注"><Input placeholder="例如：SRE 值班群" /></Form.Item>
                <PermissionGate permission={PERMISSIONS.SETTINGS_MANAGE}>
                  <Button onClick={() => runTest('钉钉')} loading={testingChannel === '钉钉'}>发送测试</Button>
                </PermissionGate>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="企业微信机器人">
                <Form.Item name={['weCom', 'enabled']} label="启用企业微信" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name={['weCom', 'webhookUrl']} label="Webhook URL"><Input.Password placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." visibilityToggle={false} /></Form.Item>
                <Form.Item name={['weCom', 'receivers']} label="接收群/备注"><Input placeholder="例如：运维值班群" /></Form.Item>
                <PermissionGate permission={PERMISSIONS.SETTINGS_MANAGE}>
                  <Button onClick={() => runTest('企业微信')} loading={testingChannel === '企业微信'}>发送测试</Button>
                </PermissionGate>
              </Card>
            </Col>
          </Row>
          {testResults.length > 0 && <Alert style={{ marginTop: 16 }} type="warning" showIcon message="最近测试结果" description={testResults.join('；')} />}
          <Space style={{ marginTop: 16 }}>
            <PermissionGate permission={PERMISSIONS.SETTINGS_MANAGE}>
              <Button type="primary" htmlType="submit" loading={saving}>保存全局通知设置</Button>
            </PermissionGate>
            {!canManage && <Typography.Text type="secondary">当前账号只有查看权限，不能修改或发送测试。</Typography.Text>}
          </Space>
        </Form>
      </Card>

      <Card title="偏好设置">
        <Descriptions column={1} bordered>
          <Descriptions.Item label="自动刷新">
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          </Descriptions.Item>
          <Descriptions.Item label="侧边栏折叠状态">{collapsed ? '已折叠' : '已展开'}</Descriptions.Item>
          <Descriptions.Item label="主题">Ant Design 深色算法</Descriptions.Item>
          <Descriptions.Item label="数据源">后端 API + 本地 UI 偏好</Descriptions.Item>
          <Descriptions.Item label="HTTP 封装">src/api/http.ts</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  )
}
