import { ApiOutlined, CloudServerOutlined, DatabaseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Card, Col, Empty, Flex, Form, Input, Modal, Popconfirm, Row, Select, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PermissionGate from '../components/auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'
import { createTopology, createTopologyEdge, createTopologyNode, deleteTopology, deleteTopologyEdge, deleteTopologyNode, getTopologies, getTopology, syncDynamicTopology, updateTopology, updateTopologyEdge, updateTopologyLayout, updateTopologyNode } from '../api/topology'
import { getErrorMessage } from '../api/http'
import { useAuthStore } from '../stores/authStore'

const nodeTypeLabel = {
  business: '业务域',
  service: '应用服务',
  host: '主机资源',
  database: '数据库',
  middleware: '中间件',
  agent: 'Agent',
  container: '容器',
  note: '说明',
}

const nodeTypeColor = {
  business: 'blue',
  service: 'green',
  host: 'geekblue',
  database: 'volcano',
  middleware: 'gold',
  agent: 'cyan',
  container: 'magenta',
  note: 'purple',
}

const nodeTypeOptions = Object.entries(nodeTypeLabel).map(([value, label]) => ({ value, label }))
const statusFilterOptions = [
  { value: 'normal', label: '正常' },
  { value: 'abnormal', label: '异常 / 告警' },
]
const topologyTypeOptions = [
  { value: '业务拓扑', label: '业务拓扑' },
  { value: '主机拓扑', label: '主机拓扑' },
  { value: '应用拓扑', label: '应用拓扑' },
  { value: '数据库 / 中间件拓扑', label: '数据库 / 中间件拓扑' },
  { value: '告警拓扑', label: '告警拓扑' },
]
const nodeWidth = 180
const nodeHeight = 96
const minCanvasWidth = 980
const minCanvasHeight = 560
const canvasPadding = 80

function nodeCenter(node) {
  return { x: node.x + nodeWidth / 2, y: node.y + nodeHeight / 2 }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function uniqueOptions(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')).map((value) => ({ value, label: value }))
}

function isAbnormalNode(node) {
  return /异常|告警|严重|离线|停止|资源高|故障/.test(node.status)
}

function TopologyCanvas({ graph, selectedId, onSelect, onMove, readonly }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes])
  const canvasSize = useMemo(() => {
    const width = Math.max(minCanvasWidth, ...graph.nodes.map((node) => node.x + nodeWidth + canvasPadding))
    const height = Math.max(minCanvasHeight, ...graph.nodes.map((node) => node.y + nodeHeight + canvasPadding))
    return { width, height }
  }, [graph.nodes])

  function startDrag(event, node) {
    onSelect(node.id)
    if (readonly) return
    event.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    dragRef.current = { id: node.id, offsetX: event.clientX - rect.left - node.x, offsetY: event.clientY - rect.top - node.y }
  }

  function drag(event) {
    const dragState = dragRef.current
    if (!dragState || readonly) return
    const rect = canvasRef.current.getBoundingClientRect()
    onMove(dragState.id, {
      x: Math.round(clamp(event.clientX - rect.left - dragState.offsetX, 0, canvasSize.width - nodeWidth)),
      y: Math.round(clamp(event.clientY - rect.top - dragState.offsetY, 0, canvasSize.height - nodeHeight)),
    })
  }

  function stopDrag() {
    dragRef.current = null
  }

  return (
    <div ref={canvasRef} className="static-topology-canvas service-topology-canvas" style={{ width: canvasSize.width, height: canvasSize.height }} aria-label="可维护服务拓扑图" onMouseMove={drag} onMouseUp={stopDrag} onMouseLeave={stopDrag}>
      <svg className="static-topology-lines" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none">
        <defs>
          <marker id="topology-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="rgba(97, 218, 251, 0.78)" />
          </marker>
        </defs>
        {graph.edges.map((edge) => {
          const source = nodesById.get(edge.sourceId)
          const target = nodesById.get(edge.targetId)
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
      {graph.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className={`static-topology-node static-topology-node-${node.type} ${selectedId === node.id ? 'active' : ''}`}
          style={{ left: node.x, top: node.y }}
          onMouseDown={(event) => startDrag(event, node)}
          onClick={() => onSelect(node.id)}
        >
          <span className="static-topology-node-type">{nodeTypeLabel[node.type]}</span>
          <span className="static-topology-node-name">{node.name}</span>
          <span className="static-topology-node-status">{node.status}</span>
          <span className="static-topology-node-note-text">{node.description || '暂无说明'}</span>
        </button>
      ))}
    </div>
  )
}

export default function ServiceTopology() {
  const [topologies, setTopologies] = useState([])
  const [currentTopologyId, setCurrentTopologyId] = useState()
  const [editingTopology, setEditingTopology] = useState()
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [selectedId, setSelectedId] = useState()
  const [topologyModalOpen, setTopologyModalOpen] = useState(false)
  const [nodeModalOpen, setNodeModalOpen] = useState(false)
  const [edgeModalOpen, setEdgeModalOpen] = useState(false)
  const [editingNode, setEditingNode] = useState()
  const [editingEdge, setEditingEdge] = useState()
  const [filters, setFilters] = useState({ groups: [], environments: [], statuses: [], types: [], tags: [] })
  const [topologyForm] = Form.useForm()
  const [nodeForm] = Form.useForm()
  const [edgeForm] = Form.useForm()
  const canManageTopology = useAuthStore((state) => state.hasPermission(PERMISSIONS.TOPOLOGY_MANAGE))

  const currentTopology = topologies.find((topology) => topology.id === currentTopologyId)
  const hasCurrentTopology = Boolean(currentTopologyId)
  const filterOptions = useMemo(() => ({
    groups: uniqueOptions(graph.nodes.map((node) => node.group)),
    environments: uniqueOptions(graph.nodes.map((node) => node.environment)),
    types: Object.entries(nodeTypeLabel).map(([value, label]) => ({ value, label })),
    tags: uniqueOptions(graph.nodes.flatMap((node) => node.tags ?? [])),
  }), [graph.nodes])
  const visibleGraph = useMemo(() => {
    const nodes = graph.nodes.filter((node) => {
      if (filters.groups.length && !filters.groups.includes(node.group)) return false
      if (filters.environments.length && !filters.environments.includes(node.environment)) return false
      if (filters.statuses.length) {
        const abnormal = isAbnormalNode(node)
        if (filters.statuses.includes('normal') && !filters.statuses.includes('abnormal') && abnormal) return false
        if (filters.statuses.includes('abnormal') && !filters.statuses.includes('normal') && !abnormal) return false
      }
      if (filters.types.length && !filters.types.includes(node.type)) return false
      if (filters.tags.length && !filters.tags.some((tag) => node.tags?.includes(tag))) return false
      return true
    })
    const visibleIds = new Set(nodes.map((node) => node.id))
    return { nodes, edges: graph.edges.filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId)) }
  }, [filters, graph])
  const selectedNode = visibleGraph.nodes.find((node) => node.id === selectedId) ?? visibleGraph.nodes[0]
  const relatedEdges = selectedNode ? visibleGraph.edges.filter((edge) => edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id) : []
  const nodesById = useMemo(() => new Map(visibleGraph.nodes.map((node) => [node.id, node])), [visibleGraph.nodes])
  const nodeOptions = graph.nodes.map((node) => ({ value: node.id, label: node.name }))

  const load = useCallback(async (topologyId) => {
    setLoading(true)
    try {
      const topologyItems = await getTopologies()
      const nextTopologyId = topologyId || topologyItems[0]?.id
      const data = nextTopologyId ? await getTopology(nextTopologyId) : { nodes: [], edges: [] }
      setTopologies(topologyItems)
      setCurrentTopologyId(nextTopologyId)
      setGraph(data)
      setSelectedId((current) => current && data.nodes.some((node) => node.id === current) ? current : data.nodes[0]?.id)
      setLayoutDirty(false)
    } catch (error) {
      message.error(getErrorMessage(error, '服务拓扑加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function resetFilters() {
    setFilters({ groups: [], environments: [], statuses: [], types: [], tags: [] })
  }

  async function selectTopology(topologyId) {
    if (topologyId === currentTopologyId) return
    setCurrentTopologyId(topologyId)
    setSelectedId(undefined)
    setFilters({ groups: [], environments: [], statuses: [], types: [], tags: [] })
    await load(topologyId)
  }

  function openCreateTopology() {
    setEditingTopology(undefined)
    topologyForm.setFieldsValue({ name: '', type: '业务拓扑', remark: '' })
    setTopologyModalOpen(true)
  }

  function openEditTopology(topology) {
    setEditingTopology(topology)
    topologyForm.setFieldsValue(topology)
    setTopologyModalOpen(true)
  }

  async function submitTopology(values) {
    setSubmitting(true)
    try {
      const topology = editingTopology ? await updateTopology(editingTopology.id, values) : await createTopology(values)
      setTopologies((current) => editingTopology ? current.map((item) => item.id === topology.id ? topology : item) : [topology, ...current])
      setCurrentTopologyId((current) => current || topology.id)
      if (!editingTopology) await load(topology.id)
      setTopologyModalOpen(false)
      setEditingTopology(undefined)
      message.success(editingTopology ? '拓扑已更新' : '拓扑已创建')
    } catch (error) {
      message.error(getErrorMessage(error, editingTopology ? '拓扑更新失败' : '拓扑创建失败'))
    } finally {
      setSubmitting(false)
    }
  }

  async function removeTopology(topologyId) {
    setSubmitting(true)
    try {
      await deleteTopology(topologyId)
      const nextTopologies = topologies.filter((topology) => topology.id !== topologyId)
      setTopologies(nextTopologies)
      if (currentTopologyId === topologyId) {
        const nextId = nextTopologies[0]?.id
        const data = nextId ? await getTopology(nextId) : { nodes: [], edges: [] }
        setCurrentTopologyId(nextId)
        setSelectedId(data.nodes[0]?.id)
        setGraph(data)
        setFilters({ groups: [], environments: [], statuses: [], types: [], tags: [] })
        setLayoutDirty(false)
      }
      message.success('拓扑已删除')
    } catch (error) {
      message.error(getErrorMessage(error, '拓扑删除失败'))
    } finally {
      setSubmitting(false)
    }
  }

  function moveNode(id, position) {
    setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...position } : node) }))
    setLayoutDirty(true)
  }

  function openCreateNode() {
    if (!currentTopologyId) return
    setEditingNode(undefined)
    nodeForm.setFieldsValue({ name: '', type: 'service', status: '稳定', description: '', x: 80, y: 80 })
    setNodeModalOpen(true)
  }

  function openEditNode(node) {
    setEditingNode(node)
    nodeForm.setFieldsValue(node)
    setNodeModalOpen(true)
  }

  function openCreateEdge() {
    if (!currentTopologyId) return
    setEditingEdge(undefined)
    edgeForm.setFieldsValue({ sourceId: selectedNode?.id, targetId: undefined, label: '' })
    setEdgeModalOpen(true)
  }

  function openEditEdge(edge) {
    setEditingEdge(edge)
    edgeForm.setFieldsValue(edge)
    setEdgeModalOpen(true)
  }

  async function submitNode(values) {
    if (!currentTopologyId) return
    setSubmitting(true)
    try {
      const node = editingNode ? await updateTopologyNode(currentTopologyId, editingNode.id, values) : await createTopologyNode(currentTopologyId, values)
      setGraph((current) => ({ ...current, nodes: editingNode ? current.nodes.map((item) => item.id === node.id ? node : item) : [...current.nodes, node] }))
      setSelectedId(node.id)
      setNodeModalOpen(false)
      message.success(editingNode ? '节点已更新' : '节点已新增')
    } catch (error) {
      message.error(getErrorMessage(error, '节点保存失败'))
    } finally {
      setSubmitting(false)
    }
  }

  async function removeNode(id) {
    if (!currentTopologyId) return
    try {
      await deleteTopologyNode(currentTopologyId, id)
      setGraph((current) => ({ nodes: current.nodes.filter((node) => node.id !== id), edges: current.edges.filter((edge) => edge.sourceId !== id && edge.targetId !== id) }))
      setSelectedId((current) => current === id ? undefined : current)
      message.success('节点已删除')
    } catch (error) {
      message.error(getErrorMessage(error, '节点删除失败'))
    }
  }

  async function submitEdge(values) {
    if (!currentTopologyId) return
    setSubmitting(true)
    try {
      const edge = editingEdge ? await updateTopologyEdge(currentTopologyId, editingEdge.id, values) : await createTopologyEdge(currentTopologyId, values)
      setGraph((current) => ({ ...current, edges: editingEdge ? current.edges.map((item) => item.id === edge.id ? edge : item) : [...current.edges, edge] }))
      setEdgeModalOpen(false)
      message.success(editingEdge ? '依赖线已更新' : '依赖线已新增')
    } catch (error) {
      message.error(getErrorMessage(error, '依赖线保存失败'))
    } finally {
      setSubmitting(false)
    }
  }

  async function removeEdge(id) {
    if (!currentTopologyId) return
    try {
      await deleteTopologyEdge(currentTopologyId, id)
      setGraph((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== id) }))
      message.success('依赖线已删除')
    } catch (error) {
      message.error(getErrorMessage(error, '依赖线删除失败'))
    }
  }

  async function saveLayout() {
    if (!currentTopologyId) return
    setSubmitting(true)
    try {
      const data = await updateTopologyLayout(currentTopologyId, graph.nodes.map(({ id, x, y }) => ({ id, x, y })))
      setGraph(data)
      setLayoutDirty(false)
      message.success('布局已保存')
    } catch (error) {
      message.error(getErrorMessage(error, '布局保存失败'))
    } finally {
      setSubmitting(false)
    }
  }

  async function syncDynamic() {
    if (!currentTopologyId) return
    setSubmitting(true)
    try {
      const data = await syncDynamicTopology(currentTopologyId)
      setGraph(data)
      setSelectedId(data.nodes[0]?.id)
      setLayoutDirty(false)
      message.success('动态拓扑已同步')
    } catch (error) {
      message.error(getErrorMessage(error, '动态拓扑同步失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const topologyColumns = [
    { title: '拓扑名称', dataIndex: 'name', render: (value, record) => <Button type="link" onClick={() => selectTopology(record.id)}>{value}</Button> },
    { title: '拓扑类型', dataIndex: 'type', width: 180, render: (value) => <Tag color="cyan">{value}</Tag> },
    { title: '备注', dataIndex: 'remark', render: (value) => value || '-' },
    {
      title: '操作',
      width: 240,
      render: (_, record) => (
        <Space>
          <Button size="small" disabled={record.id === currentTopologyId} onClick={() => selectTopology(record.id)}>查看</Button>
          <PermissionGate permission={PERMISSIONS.TOPOLOGY_MANAGE}>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditTopology(record)}>编辑</Button>
            <Popconfirm title="删除该拓扑会同时删除它的节点和依赖线，确认删除？" onConfirm={() => removeTopology(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ]

  const edgeColumns = [
    { title: '来源', render: (_, record) => nodesById.get(record.sourceId)?.name || '-' },
    { title: '目标', render: (_, record) => nodesById.get(record.targetId)?.name || '-' },
    { title: '依赖说明', dataIndex: 'label' },
    {
      title: '操作',
      width: 150,
      render: (_, record) => (
        <PermissionGate permission={PERMISSIONS.TOPOLOGY_MANAGE}>
          <Space>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditEdge(record)}>编辑</Button>
            <Popconfirm title="删除这条依赖线？" onConfirm={() => removeEdge(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        </PermissionGate>
      ),
    },
  ]

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card className="static-topology-hero">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} xl={14}>
            <Typography.Text className="static-topology-kicker">SERVICE TOPOLOGY</Typography.Text>
            <Typography.Title level={2}>服务拓扑维护</Typography.Title>
            <Typography.Paragraph type="secondary">
              当前拓扑：{currentTopology ? `${currentTopology.name}（${currentTopology.type}）` : '暂无'}。维护静态架构图中的业务、服务、主机、数据库和中间件节点，手动沉淀依赖关系并保存拖拽布局。
            </Typography.Paragraph>
          </Col>
          <Col xs={24} xl={10}>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title="节点" value={visibleGraph.nodes.length} suffix={`/ ${graph.nodes.length}`} /></Col>
              <Col span={8}><Statistic title="依赖线" value={visibleGraph.edges.length} suffix={`/ ${graph.edges.length}`} /></Col>
              <Col span={8}><Statistic title="节点类型" value={new Set(visibleGraph.nodes.map((node) => node.type)).size} /></Col>
            </Row>
          </Col>
        </Row>
      </Card>

      <Card
        title="拓扑列表"
        extra={(
          <PermissionGate permission={PERMISSIONS.TOPOLOGY_MANAGE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateTopology}>创建拓扑</Button>
          </PermissionGate>
        )}
      >
        <Table rowKey="id" columns={topologyColumns} dataSource={topologies} pagination={false} rowClassName={(record) => record.id === currentTopologyId ? 'service-topology-current-row' : ''} locale={{ emptyText: '暂无拓扑，请先创建' }} />
      </Card>

      <Card title="筛选区" extra={<Button onClick={resetFilters}>重置筛选</Button>}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8} xl={5}>
            <Select mode="multiple" allowClear placeholder="按主机组" style={{ width: '100%' }} options={filterOptions.groups} value={filters.groups} onChange={(value) => updateFilter('groups', value)} />
          </Col>
          <Col xs={24} md={8} xl={5}>
            <Select mode="multiple" allowClear placeholder="按环境：生产 / 测试" style={{ width: '100%' }} options={filterOptions.environments} value={filters.environments} onChange={(value) => updateFilter('environments', value)} />
          </Col>
          <Col xs={24} md={8} xl={4}>
            <Select mode="multiple" allowClear placeholder="按状态" style={{ width: '100%' }} options={statusFilterOptions} value={filters.statuses} onChange={(value) => updateFilter('statuses', value)} />
          </Col>
          <Col xs={24} md={8} xl={5}>
            <Select mode="multiple" allowClear placeholder="按节点类型" style={{ width: '100%' }} options={filterOptions.types} value={filters.types} onChange={(value) => updateFilter('types', value)} />
          </Col>
          <Col xs={24} md={8} xl={5}>
            <Select mode="multiple" allowClear placeholder="按标签" style={{ width: '100%' }} options={filterOptions.tags} value={filters.tags} onChange={(value) => updateFilter('tags', value)} />
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={17}>
          <Card
            title="拓扑图"
            extra={(
              <PermissionGate permission={PERMISSIONS.TOPOLOGY_MANAGE}>
                <Space>
                  <Button icon={<PlusOutlined />} disabled={!hasCurrentTopology} onClick={openCreateNode}>新增节点</Button>
                  <Button icon={<PlusOutlined />} disabled={!hasCurrentTopology || graph.nodes.length < 2} onClick={openCreateEdge}>新增依赖线</Button>
                  <Button disabled={!hasCurrentTopology} loading={submitting} onClick={syncDynamic}>同步动态拓扑</Button>
                  <Button type="primary" icon={<SaveOutlined />} disabled={!hasCurrentTopology || !layoutDirty} loading={submitting} onClick={saveLayout}>保存布局</Button>
                </Space>
              </PermissionGate>
            )}
          >
            <Spin spinning={loading}>
              {visibleGraph.nodes.length ? <div className="static-topology-viewport"><TopologyCanvas graph={visibleGraph} selectedId={selectedNode?.id} onSelect={setSelectedId} onMove={moveNode} readonly={!canManageTopology} /></div> : <Empty description={graph.nodes.length ? '当前筛选条件下暂无节点' : '暂无拓扑节点，请先新增节点'} />}
            </Spin>
          </Card>
        </Col>
        <Col xs={24} xl={7}>
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Card title="节点说明" extra={selectedNode ? <Tag color={nodeTypeColor[selectedNode.type]}>{nodeTypeLabel[selectedNode.type]}</Tag> : null}>
              {selectedNode ? (
                <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                  <div>
                    <Typography.Title level={4}>{selectedNode.name}</Typography.Title>
                    <Typography.Paragraph type="secondary">{selectedNode.description || '暂无说明'}</Typography.Paragraph>
                  </div>
                  <Flex gap="small" wrap>
                    <Tag color="processing">状态：{selectedNode.status}</Tag>
                    {selectedNode.group && <Tag>主机组：{selectedNode.group}</Tag>}
                    {selectedNode.environment && <Tag color={selectedNode.environment === '生产' ? 'red' : 'blue'}>环境：{selectedNode.environment}</Tag>}
                    {selectedNode.tags?.map((tag) => <Tag key={tag}>{tag}</Tag>)}
                    <Tag>坐标：{selectedNode.x}, {selectedNode.y}</Tag>
                  </Flex>
                  <PermissionGate permission={PERMISSIONS.TOPOLOGY_MANAGE}>
                    <Space>
                      <Button icon={<EditOutlined />} onClick={() => openEditNode(selectedNode)}>编辑节点</Button>
                      <Popconfirm title="删除该节点会同时删除相关依赖线，确认删除？" onConfirm={() => removeNode(selectedNode.id)}>
                        <Button danger icon={<DeleteOutlined />}>删除节点</Button>
                      </Popconfirm>
                    </Space>
                  </PermissionGate>
                  <div>
                    <Typography.Text strong>关联关系</Typography.Text>
                    {relatedEdges.length ? relatedEdges.map((edge) => (
                      <div key={edge.id} className="static-topology-edge-row">
                        <span>{nodesById.get(edge.sourceId)?.name} → {nodesById.get(edge.targetId)?.name}</span>
                        <Tag>{edge.label}</Tag>
                      </div>
                    )) : <Typography.Paragraph type="secondary">暂无关联依赖</Typography.Paragraph>}
                  </div>
                </Space>
              ) : <Empty description="请选择或新增节点" />}
            </Card>

            <Card title="依赖线清单">
              <Table rowKey="id" size="small" columns={edgeColumns} dataSource={visibleGraph.edges} pagination={false} />
            </Card>
          </Space>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card className="static-topology-summary-card">
            <CloudServerOutlined />
            <div><strong>资源侧</strong><span>用主机资源节点沉淀运行位置和依赖入口。</span></div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="static-topology-summary-card">
            <ApiOutlined />
            <div><strong>应用侧</strong><span>用服务节点维护调用链路和上下游关系。</span></div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="static-topology-summary-card">
            <DatabaseOutlined />
            <div><strong>数据侧</strong><span>用数据库和中间件节点标记关键依赖。</span></div>
          </Card>
        </Col>
      </Row>

      <Modal title={editingTopology ? '编辑拓扑' : '创建拓扑'} open={topologyModalOpen} onCancel={() => { setTopologyModalOpen(false); setEditingTopology(undefined) }} onOk={() => topologyForm.submit()} confirmLoading={submitting} destroyOnHidden>
        <Form form={topologyForm} layout="vertical" onFinish={submitTopology}>
          <Form.Item name="name" label="拓扑名称" rules={[{ required: true, message: '请输入拓扑名称' }]}><Input maxLength={80} placeholder="例如：核心交易链路拓扑" /></Form.Item>
          <Form.Item name="type" label="拓扑类型" rules={[{ required: true, message: '请选择拓扑类型' }]}><Select options={topologyTypeOptions} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={4} maxLength={500} placeholder="说明该拓扑覆盖的系统、场景或维护范围" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={editingNode ? '编辑节点' : '新增节点'} open={nodeModalOpen} onCancel={() => setNodeModalOpen(false)} onOk={() => nodeForm.submit()} confirmLoading={submitting} destroyOnHidden>
        <Form form={nodeForm} layout="vertical" onFinish={submitNode}>
          <Form.Item name="name" label="节点名称" rules={[{ required: true, message: '请输入节点名称' }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="type" label="节点类型" rules={[{ required: true, message: '请选择节点类型' }]}><Select options={nodeTypeOptions} /></Form.Item>
          <Form.Item name="status" label="状态"><Input maxLength={30} placeholder="例如：稳定、重点、异常" /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={4} maxLength={500} /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="x" label="X 坐标"><Input type="number" /></Form.Item></Col>
            <Col span={12}><Form.Item name="y" label="Y 坐标"><Input type="number" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal title={editingEdge ? '编辑依赖线' : '新增依赖线'} open={edgeModalOpen} onCancel={() => setEdgeModalOpen(false)} onOk={() => edgeForm.submit()} confirmLoading={submitting} destroyOnHidden>
        <Form form={edgeForm} layout="vertical" onFinish={submitEdge}>
          <Form.Item name="sourceId" label="来源节点" rules={[{ required: true, message: '请选择来源节点' }]}><Select options={nodeOptions} /></Form.Item>
          <Form.Item name="targetId" label="目标节点" rules={[{ required: true, message: '请选择目标节点' }]}><Select options={nodeOptions} /></Form.Item>
          <Form.Item name="label" label="依赖说明" rules={[{ required: true, message: '请输入依赖说明' }]}><Input maxLength={80} placeholder="例如：HTTPS、读写数据、采集上报" /></Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
