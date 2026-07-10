import { Button, Card, Flex, Form, Input, Select, Switch } from 'antd'

const levels = ['紧急', '严重', '警告', '提示']
const statuses = ['待处理', '处理中', '已解决']

export default function AlertFilters({ filters, onChange, onSearch, loading }) {
  const update = (values) => onChange?.({ ...filters, ...values })

  return (
    <Card size="small">
      <Form layout="vertical">
        <Flex gap={12} wrap align="end">
          <Form.Item label="关键字" style={{ minWidth: 220, marginBottom: 0 }}>
            <Input.Search allowClear placeholder="搜索标题、内容、服务、来源" value={filters.keyword} onChange={(event) => update({ keyword: event.target.value || undefined })} onSearch={() => onSearch?.()} />
          </Form.Item>
          <Form.Item label="级别" style={{ minWidth: 130, marginBottom: 0 }}>
            <Select allowClear placeholder="全部级别" value={filters.level} onChange={(level) => update({ level })} options={levels.map((level) => ({ label: level, value: level }))} />
          </Form.Item>
          <Form.Item label="状态" style={{ minWidth: 130, marginBottom: 0 }}>
            <Select allowClear placeholder="全部状态" value={filters.status} onChange={(status) => update({ status })} options={statuses.map((status) => ({ label: status, value: status }))} />
          </Form.Item>
          <Form.Item label="来源" style={{ minWidth: 160, marginBottom: 0 }}>
            <Input allowClear placeholder="如 日志监控" value={filters.source} onChange={(event) => update({ source: event.target.value || undefined })} />
          </Form.Item>
          <Form.Item label="包含已抑制" style={{ marginBottom: 0 }}>
            <Switch checked={Boolean(filters.includeSuppressed)} onChange={(includeSuppressed) => update({ includeSuppressed })} />
          </Form.Item>
          <Button type="primary" loading={loading} onClick={() => onSearch?.()}>查询</Button>
          <Button onClick={() => { onChange?.({ includeSuppressed: false }); setTimeout(() => onSearch?.(), 0) }}>重置</Button>
        </Flex>
      </Form>
    </Card>
  )
}
