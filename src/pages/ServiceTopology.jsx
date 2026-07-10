import { ApiOutlined, CloudServerOutlined, DatabaseOutlined } from '@ant-design/icons'
import { Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd'
import { useMemo, useState } from 'react'

const nodeTypeLabel = {
  business: '业务域',
  service: '应用服务',
  host: '主机资源',
  database: '数据库',
  middleware: '中间件',
  note: '说明',
}

const nodeTypeColor = {
  business: 'blue',
  service: 'green',
  host: 'geekblue',
  database: 'volcano',
  middleware: 'gold',
  note: 'purple',
}

const topology = {
  nodes: [
    { id: 'business', type: 'business', name: '核心业务入口', status: '稳定', x: 80, y: 88, note: '用户门户、API 调用与管理端统一入口' },
    { id: 'gateway', type: 'middleware', name: '网关 / 负载均衡', status: '稳定', x: 300, y: 88, note: 'HTTPS 接入、路由转发、限流与健康检查' },
    { id: 'ops-app', type: 'service', name: '运维平台应用', status: '重点', x: 535, y: 88, note: '告警、主机、日志、自愈、批处理等平台能力' },
    { id: 'agent-hosts', type: 'host', name: '纳管主机集群', status: '稳定', x: 300, y: 285, note: 'Windows / Linux 主机与 Agent 采集端' },
    { id: 'observability', type: 'service', name: '监控与日志链路', status: '稳定', x: 535, y: 285, note: '指标、日志、事件、通知与周报生成' },
    { id: 'postgres', type: 'database', name: 'PostgreSQL', status: '核心', x: 760, y: 188, note: '业务数据、审计数据、配置与执行记录' },
    { id: 'static-note', type: 'note', name: '静态说明', status: '只读', x: 80, y: 320, note: '该拓扑为静态展示页，不再调用后端拓扑接口。' },
  ],
  edges: [
    { id: 'e1', source: 'business', target: 'gateway', label: 'HTTPS' },
    { id: 'e2', source: 'gateway', target: 'ops-app', label: 'API 路由' },
    { id: 'e3', source: 'ops-app', target: 'postgres', label: '读写数据' },
    { id: 'e4', source: 'agent-hosts', target: 'observability', label: '采集上报' },
    { id: 'e5', source: 'observability', target: 'ops-app', label: '告警 / 周报' },
    { id: 'e6', source: 'observability', target: 'postgres', label: '留痕存储' },
  ],
}

const impactItems = [
  { label: '入口链路', value: '业务入口 → 网关 → 运维平台应用' },
  { label: '采集链路', value: '纳管主机集群 → 监控与日志链路 → 平台应用' },
  { label: '数据链路', value: '平台应用 / 日志链路 → PostgreSQL' },
]

function nodeCenter(node) {
  return { x: node.x + 90, y: node.y + 34 }
}

function StaticTopologyCanvas({ selectedId, onSelect }) {
  const nodesById = useMemo(() => new Map(topology.nodes.map((node) => [node.id, node])), [])

  return (
    <div className="static-topology-canvas" aria-label="静态服务拓扑图">
      <svg className="static-topology-lines" viewBox="0 0 980 560" preserveAspectRatio="none">
        <defs>
          <marker id="topology-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="rgba(97, 218, 251, 0.78)" />
          </marker>
        </defs>
        {topology.edges.map((edge) => {
          const source = nodesById.get(edge.source)
          const target = nodesById.get(edge.target)
          if (!source || !target) return null
          const a = nodeCenter(source)
          const b = nodeCenter(target)
          return (
            <g key={edge.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(97, 218, 251, 0.58)" strokeWidth="3" markerEnd="url(#topology-arrow)" />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} className="static-topology-edge-label">{edge.label}</text>
            </g>
          )
        })}
      </svg>
      {topology.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className={`static-topology-node static-topology-node-${node.type} ${selectedId === node.id ? 'active' : ''}`}
          style={{ left: node.x, top: node.y }}
          onClick={() => onSelect(node.id)}
        >
          <span className="static-topology-node-type">{nodeTypeLabel[node.type]}</span>
          <span className="static-topology-node-name">{node.name}</span>
          <span className="static-topology-node-status">{node.status}</span>
          <span className="static-topology-node-note-text">{node.note}</span>
        </button>
      ))}
    </div>
  )
}

export default function ServiceTopology() {
  const [selectedId, setSelectedId] = useState(topology.nodes[0].id)
  const selectedNode = topology.nodes.find((node) => node.id === selectedId) ?? topology.nodes[0]
  const relatedEdges = topology.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card className="static-topology-hero">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} xl={14}>
            <Typography.Text className="static-topology-kicker">STATIC SERVICE MAP</Typography.Text>
            <Typography.Title level={2}>服务拓扑静态展示</Typography.Title>
            <Typography.Paragraph type="secondary">
              当前页面只保留架构关系展示与节点说明，不再读取后端拓扑接口，也不提供在线编辑入口，适合用于演示、汇报和固定架构说明。
            </Typography.Paragraph>
          </Col>
          <Col xs={24} xl={10}>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title="静态节点" value={topology.nodes.length} /></Col>
              <Col span={8}><Statistic title="依赖关系" value={topology.edges.length} /></Col>
              <Col span={8}><Statistic title="核心链路" value={impactItems.length} /></Col>
            </Row>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={17}>
          <Card title="静态拓扑图" extra={<Tag color="cyan">只读展示</Tag>}>
            <StaticTopologyCanvas selectedId={selectedId} onSelect={setSelectedId} />
          </Card>
        </Col>
        <Col xs={24} xl={7}>
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Card title="节点说明" extra={<Tag color={nodeTypeColor[selectedNode.type]}>{nodeTypeLabel[selectedNode.type]}</Tag>}>
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                <div>
                  <Typography.Title level={4}>{selectedNode.name}</Typography.Title>
                  <Typography.Paragraph type="secondary">{selectedNode.note}</Typography.Paragraph>
                </div>
                <Tag color="processing">状态：{selectedNode.status}</Tag>
                <div>
                  <Typography.Text strong>关联关系</Typography.Text>
                  {relatedEdges.map((edge) => {
                    const source = topology.nodes.find((node) => node.id === edge.source)
                    const target = topology.nodes.find((node) => node.id === edge.target)
                    return <div key={edge.id} className="static-topology-edge-row"><span>{source?.name} → {target?.name}</span><Tag>{edge.label}</Tag></div>
                  })}
                </div>
              </Space>
            </Card>

            <Card title="链路清单">
              <Space orientation="vertical" size="small" style={{ width: '100%' }}>
                {impactItems.map((item) => (
                  <div key={item.label} className="static-topology-route-card">
                    <Typography.Text strong>{item.label}</Typography.Text>
                    <Typography.Text type="secondary">{item.value}</Typography.Text>
                  </div>
                ))}
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card className="static-topology-summary-card">
            <CloudServerOutlined />
            <div><strong>资源侧</strong><span>纳管主机与 Agent 作为采集入口。</span></div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="static-topology-summary-card">
            <ApiOutlined />
            <div><strong>应用侧</strong><span>平台能力统一收敛到运维应用。</span></div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="static-topology-summary-card">
            <DatabaseOutlined />
            <div><strong>数据侧</strong><span>核心数据与审计记录集中落库。</span></div>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
