import { ApiOutlined, CloudServerOutlined, DatabaseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Card, Col, Empty, Flex, Form, Input, Modal, Popconfirm, Radio, Row, Select, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PermissionGate from '../components/auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'
import { createTopology, createTopologyEdge, createTopologyNode, deleteTopology, deleteTopologyEdge, deleteTopologyNode, getTopologies, getTopology, syncDynamicTopology, updateTopology, updateTopologyCanvas, updateTopologyEdge, updateTopologyLayout, updateTopologyNode } from '../api/topology'
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
const topologyModeLabel = { structured: '结构化拓扑', canvas: '自由画板' }
const topologyModeOptions = [
  { value: 'structured', label: '结构化拓扑' },
  { value: 'canvas', label: '自由画板' },
]
const arrowLineStyleOptions = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
]
const arrowDirectionOptions = [
  { value: 'forward', label: '正向' },
  { value: 'backward', label: '反向' },
  { value: 'both', label: '双向' },
  { value: 'none', label: '无线头' },
]
const defaultCanvasData = { version: 1, items: [] }
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

function normalizeCanvasData(value) {
  return { version: Number(value?.version || 1), items: Array.isArray(value?.items) ? value.items : [] }
}

function canvasItemBounds(item) {
  if (item.type === 'arrow') {
    return { left: Math.min(item.x1 || 0, item.x2 || 0), top: Math.min(item.y1 || 0, item.y2 || 0), right: Math.max(item.x1 || 0, item.x2 || 0), bottom: Math.max(item.y1 || 0, item.y2 || 0) }
  }
  return { left: item.x || 0, top: item.y || 0, right: (item.x || 0) + (item.width || 160), bottom: (item.y || 0) + (item.height || 70) }
}

function bindingPoint(binding, items) {
  const item = items.find((candidate) => candidate.id === binding?.itemId && candidate.type === 'rect')
  if (!item) return undefined
  const x = item.x || 0
  const y = item.y || 0
  const width = item.width || 160
  const height = item.height || 70
  const ratio = clamp(Number(binding.ratio ?? 0.5), 0, 1)
  if (binding.side === 'top') return { x: x + width * ratio, y }
  if (binding.side === 'right') return { x: x + width, y: y + height * ratio }
  if (binding.side === 'bottom') return { x: x + width * ratio, y: y + height }
  if (binding.side === 'left') return { x, y: y + height * ratio }
  return undefined
}

function resolveCanvasArrow(item, items) {
  const start = bindingPoint(item.startBinding, items)
  const end = bindingPoint(item.endBinding, items)
  return {
    ...item,
    x1: Math.round(start?.x ?? item.x1 ?? 0),
    y1: Math.round(start?.y ?? item.y1 ?? 0),
    x2: Math.round(end?.x ?? item.x2 ?? 0),
    y2: Math.round(end?.y ?? item.y2 ?? 0),
  }
}

function nearestRectBinding(x, y, items, threshold = 32) {
  let nearest
  for (const item of items) {
    if (item.type !== 'rect') continue
    const left = item.x || 0
    const top = item.y || 0
    const width = item.width || 160
    const height = item.height || 70
    const right = left + width
    const bottom = top + height
    const candidates = [
      { side: 'top', x: clamp(x, left, right), y: top, ratio: width ? clamp((x - left) / width, 0, 1) : 0.5 },
      { side: 'right', x: right, y: clamp(y, top, bottom), ratio: height ? clamp((y - top) / height, 0, 1) : 0.5 },
      { side: 'bottom', x: clamp(x, left, right), y: bottom, ratio: width ? clamp((x - left) / width, 0, 1) : 0.5 },
      { side: 'left', x: left, y: clamp(y, top, bottom), ratio: height ? clamp((y - top) / height, 0, 1) : 0.5 },
    ]
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.x - x, candidate.y - y)
      if (distance <= threshold && (!nearest || distance < nearest.distance)) nearest = { ...candidate, itemId: item.id, distance }
    }
  }
  if (!nearest) return undefined
  return { point: { x: Math.round(nearest.x), y: Math.round(nearest.y) }, binding: { itemId: nearest.itemId, side: nearest.side, ratio: Number(nearest.ratio.toFixed(4)) } }
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character])
}

function exportTextLines(value, maxLength = 18, maxLines = 2) {
  const text = String(value || '')
  const lines = []
  for (let index = 0; index < text.length && lines.length < maxLines; index += maxLength) lines.push(text.slice(index, index + maxLength))
  if (text.length > maxLength * maxLines && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`
  return lines
}

function exportText(value, x, y, options = {}) {
  const { anchor = 'middle', fill = '#edf7ff', fontSize = 14, fontWeight = 600, maxLength = 18, maxLines = 2, lineHeight = 20 } = options
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="${fontSize}" font-weight="${fontWeight}">${exportTextLines(value, maxLength, maxLines).map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`
}

function topologyExportSvg(topology, graph) {
  const titleHeight = 72
  const exportPadding = 48
  const canvas = normalizeCanvasData(topology.canvasData)
  const contentBounds = topology.mode === 'canvas'
    ? canvas.items.map((item) => canvasItemBounds(item.type === 'arrow' ? resolveCanvasArrow(item, canvas.items) : item))
    : graph.nodes.map((node) => ({ left: node.x, top: node.y, right: node.x + nodeWidth, bottom: node.y + nodeHeight }))
  const hasContent = contentBounds.length > 0
  const minLeft = hasContent ? Math.min(...contentBounds.map((item) => item.left)) : 0
  const minTop = hasContent ? Math.min(...contentBounds.map((item) => item.top)) : 0
  const maxRight = hasContent ? Math.max(...contentBounds.map((item) => item.right)) : 0
  const maxBottom = hasContent ? Math.max(...contentBounds.map((item) => item.bottom)) : 0
  const contentWidth = hasContent ? maxRight - minLeft : 360
  const contentHeight = hasContent ? maxBottom - minTop : 120
  const titleWidth = Math.max(String(topology.name || '').length * 24, `${topology.type} · ${topologyModeLabel[topology.mode]}`.length * 12) + 56
  const width = Math.ceil(Math.max(360, titleWidth, contentWidth + exportPadding * 2))
  const exportContentHeight = Math.ceil(contentHeight + exportPadding * 2)
  const height = titleHeight + exportContentHeight
  const offsetX = exportPadding - minLeft
  const offsetY = exportPadding - minTop
  const markerId = `topology-export-arrow-${topology.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const background = `<rect width="${width}" height="${height}" fill="#071021"/><defs><pattern id="export-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#61dafb" stroke-opacity="0.055" stroke-width="1"/></pattern><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#61dafb" fill-opacity="0.88"/></marker><marker id="${markerId}-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#61dafb" fill-opacity="0.88"/></marker></defs><rect y="${titleHeight}" width="${width}" height="${exportContentHeight}" fill="url(#export-grid)"/><line x1="0" y1="${titleHeight}" x2="${width}" y2="${titleHeight}" stroke="#61dafb" stroke-opacity="0.26"/>${exportText(topology.name, 28, 32, { anchor: 'start', fontSize: 22, fontWeight: 700, maxLength: 48, maxLines: 1 })}${exportText(`${topology.type} · ${topologyModeLabel[topology.mode]}`, 28, 56, { anchor: 'start', fill: '#8fb7da', fontSize: 12, maxLength: 60, maxLines: 1 })}`

  let content
  if (topology.mode === 'canvas') {
    const arrows = canvas.items.filter((item) => item.type === 'arrow').map((item) => {
      const resolvedItem = resolveCanvasArrow(item, canvas.items)
      const direction = resolvedItem.direction || 'forward'
      const x1 = resolvedItem.x1 || 0
      const y1 = (resolvedItem.y1 || 0) + titleHeight
      const x2 = resolvedItem.x2 || 0
      const y2 = (resolvedItem.y2 || 0) + titleHeight
      const labelX = (x1 + x2) / 2
      const labelY = (y1 + y2) / 2 - 8
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeXml(resolvedItem.stroke || '#61dafb')}" stroke-width="3" ${resolvedItem.lineStyle === 'dashed' ? 'stroke-dasharray="8 6"' : ''} ${['backward', 'both'].includes(direction) ? `marker-start="url(#${markerId}-start)"` : ''} ${['forward', 'both'].includes(direction) ? `marker-end="url(#${markerId})"` : ''}/>${resolvedItem.text ? exportText(resolvedItem.text, labelX, labelY, { fill: '#c8f5ff', fontSize: 12, maxLength: 20, maxLines: 1 }) : ''}`
    }).join('')
    const items = canvas.items.filter((item) => item.type !== 'arrow').map((item) => {
      const x = item.x || 0
      const y = (item.y || 0) + titleHeight
      const itemWidth = item.width || 160
      const itemHeight = item.height || 70
      if (item.type === 'text') return exportText(item.text, x, y + 18, { anchor: 'start', fill: '#dbe7ff', fontSize: 14, maxLength: Math.max(8, Math.floor(itemWidth / 14)), maxLines: Math.max(1, Math.floor(itemHeight / 20)) })
      return `<rect x="${x}" y="${y}" width="${itemWidth}" height="${itemHeight}" rx="14" fill="${escapeXml(item.fill || '#10233f')}" stroke="${escapeXml(item.stroke || '#1677ff')}"/>${item.text ? exportText(item.text, x + itemWidth / 2, y + itemHeight / 2, { maxLength: Math.max(8, Math.floor(itemWidth / 14)), maxLines: 2 }) : ''}`
    }).join('')
    content = arrows + items
  } else {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
    const edges = graph.edges.map((edge) => {
      const source = nodesById.get(edge.sourceId)
      const target = nodesById.get(edge.targetId)
      if (!source || !target) return ''
      const a = nodeCenter(source)
      const b = nodeCenter(target)
      return `<line x1="${a.x}" y1="${a.y + titleHeight}" x2="${b.x}" y2="${b.y + titleHeight}" stroke="#61dafb" stroke-opacity="0.58" stroke-width="3" marker-end="url(#${markerId})"/>${exportText(edge.label, (a.x + b.x) / 2, (a.y + b.y) / 2 + titleHeight - 8, { fill: '#c8f5ff', fontSize: 12, maxLength: 20, maxLines: 1 })}`
    }).join('')
    const nodes = graph.nodes.map((node) => {
      const x = node.x
      const y = node.y + titleHeight
      return `<rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="16" fill="#0a1226" fill-opacity="0.96" stroke="#61dafb" stroke-opacity="0.5"/>${exportText(nodeTypeLabel[node.type] || node.type, x + 14, y + 20, { anchor: 'start', fill: '#8fb7da', fontSize: 11, fontWeight: 700, maxLength: 18, maxLines: 1 })}${exportText(node.name, x + 14, y + 43, { anchor: 'start', fontSize: 15, fontWeight: 700, maxLength: 18, maxLines: 1 })}${exportText(node.status, x + 14, y + 66, { anchor: 'start', fill: '#c8f5ff', fontSize: 11, maxLength: 20, maxLines: 1 })}${exportText(node.description || '暂无说明', x + 14, y + 85, { anchor: 'start', fill: '#aebbd5', fontSize: 11, maxLength: 22, maxLines: 1 })}`
    }).join('')
    content = edges + nodes
  }

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}<g transform="translate(${offsetX} ${offsetY})">${content}</g></svg>`, width, height }
}

async function downloadTopologyPng(topology, graph) {
  const { svg, width, height } = topologyExportSvg(topology, graph)
  const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = sourceUrl
    await image.decode()
    const scale = Math.min(2, 8192 / width, 8192 / height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('图片生成失败')
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = `${topology.name || '拓扑图'}.png`.replace(/[\\/:*?"<>|]/g, '-')
    link.click()
    URL.revokeObjectURL(downloadUrl)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function isTextInsideRect(text, rect) {
  const centerX = (text.x || 0) + (text.width || 0) / 2
  const centerY = (text.y || 0) + (text.height || 0) / 2
  return centerX >= (rect.x || 0) && centerX <= (rect.x || 0) + (rect.width || 0) && centerY >= (rect.y || 0) && centerY <= (rect.y || 0) + (rect.height || 0)
}

function createCanvasItemId(type) {
  return `${type}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function createCanvasItem(type, offset = 0) {
  const id = createCanvasItemId(type)
  const position = 120 + offset * 28
  if (type === 'arrow') return { id, type, x1: position, y1: position, x2: position + 200, y2: position, text: '调用', stroke: '#61dafb', lineStyle: 'solid', direction: 'forward' }
  if (type === 'text') return { id, type, x: position, y: position, width: 180, height: 48, text: '说明文字', fill: 'transparent', stroke: 'rgba(97, 218, 251, 0.42)' }
  return { id, type: 'rect', x: position, y: position, width: 180, height: 80, text: '', fill: '#10233f', stroke: '#1677ff' }
}

function FreeCanvasBoard({ data, selectedId, onSelect, onMove, onTextChange, readonly }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const resolvedItems = useMemo(() => data.items.map((item) => item.type === 'arrow' ? resolveCanvasArrow(item, data.items) : item), [data.items])
  const canvasSize = useMemo(() => {
    const bounds = resolvedItems.map(canvasItemBounds)
    return {
      width: Math.max(minCanvasWidth, ...bounds.map((item) => item.right + canvasPadding)),
      height: Math.max(minCanvasHeight, ...bounds.map((item) => item.bottom + canvasPadding)),
    }
  }, [resolvedItems])

  function startDrag(event, item) {
    onSelect(item.id)
    if (readonly) return
    event.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const resolvedItem = item.type === 'arrow' ? resolveCanvasArrow(item, data.items) : item
    dragRef.current = {
      item: resolvedItem,
      offsetX: event.clientX - rect.left - (resolvedItem.x ?? Math.min(resolvedItem.x1 || 0, resolvedItem.x2 || 0)),
      offsetY: event.clientY - rect.top - (resolvedItem.y ?? Math.min(resolvedItem.y1 || 0, resolvedItem.y2 || 0)),
    }
  }

  function startEndpointDrag(event, item, endpoint) {
    onSelect(item.id)
    if (readonly) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { item: resolveCanvasArrow(item, data.items), endpoint }
  }

  function drag(event) {
    const dragState = dragRef.current
    if (!dragState || readonly) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = Math.round(clamp(event.clientX - rect.left - dragState.offsetX, 0, canvasSize.width - 40))
    const y = Math.round(clamp(event.clientY - rect.top - dragState.offsetY, 0, canvasSize.height - 40))
    const { item } = dragState
    if (item.type === 'arrow' && dragState.endpoint) {
      const pointerX = Math.round(clamp(event.clientX - rect.left, 0, canvasSize.width))
      const pointerY = Math.round(clamp(event.clientY - rect.top, 0, canvasSize.height))
      const snap = nearestRectBinding(pointerX, pointerY, data.items)
      const prefix = dragState.endpoint === 'start' ? '1' : '2'
      const bindingKey = dragState.endpoint === 'start' ? 'startBinding' : 'endBinding'
      const point = snap?.point || { x: pointerX, y: pointerY }
      const values = { [`x${prefix}`]: point.x, [`y${prefix}`]: point.y, [bindingKey]: snap?.binding }
      onMove(item.id, values)
      dragRef.current.item = { ...item, ...values }
      return
    }
    if (item.type === 'arrow') {
      const minX = Math.min(item.x1 || 0, item.x2 || 0)
      const minY = Math.min(item.y1 || 0, item.y2 || 0)
      const values = { x1: (item.x1 || 0) + x - minX, y1: (item.y1 || 0) + y - minY, x2: (item.x2 || 0) + x - minX, y2: (item.y2 || 0) + y - minY, startBinding: undefined, endBinding: undefined }
      onMove(item.id, values)
      dragRef.current.item = { ...item, ...values }
      return
    }
    onMove(item.id, { x, y })
    dragRef.current.item = { ...item, x, y }
  }

  function stopDrag() {
    dragRef.current = null
  }

  return (
    <div ref={canvasRef} className="free-topology-canvas" style={{ width: canvasSize.width, height: canvasSize.height }} onMouseMove={drag} onMouseUp={stopDrag} onMouseLeave={stopDrag}>
      <svg className="static-topology-lines" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none">
        <defs>
          <marker id="canvas-arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="rgba(97, 218, 251, 0.88)" />
          </marker>
          <marker id="canvas-arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="rgba(97, 218, 251, 0.88)" />
          </marker>
        </defs>
        {resolvedItems.filter((item) => item.type === 'arrow').map((item) => (
          <g key={item.id} className={selectedId === item.id ? 'free-canvas-arrow active' : 'free-canvas-arrow'} onMouseDown={(event) => startDrag(event, item)} onClick={() => onSelect(item.id)}>
            <line
              x1={item.x1}
              y1={item.y1}
              x2={item.x2}
              y2={item.y2}
              stroke={item.stroke || '#61dafb'}
              strokeWidth="3"
              strokeDasharray={item.lineStyle === 'dashed' ? '8 6' : undefined}
              markerStart={['backward', 'both'].includes(item.direction || 'forward') ? 'url(#canvas-arrow-start)' : undefined}
              markerEnd={['forward', 'both'].includes(item.direction || 'forward') ? 'url(#canvas-arrow-end)' : undefined}
            />
            {item.text && selectedId !== item.id && <text x={((item.x1 || 0) + (item.x2 || 0)) / 2} y={((item.y1 || 0) + (item.y2 || 0)) / 2 - 8} className="static-topology-edge-label">{item.text}</text>}
            {selectedId === item.id && !readonly ? (
              <>
                <circle className={item.startBinding ? 'free-canvas-endpoint attached' : 'free-canvas-endpoint'} cx={item.x1} cy={item.y1} r="7" onMouseDown={(event) => startEndpointDrag(event, item, 'start')} />
                <circle className={item.endBinding ? 'free-canvas-endpoint attached' : 'free-canvas-endpoint'} cx={item.x2} cy={item.y2} r="7" onMouseDown={(event) => startEndpointDrag(event, item, 'end')} />
              </>
            ) : null}
          </g>
        ))}
      </svg>
      {resolvedItems.filter((item) => item.type === 'arrow' && item.id === selectedId && !readonly).map((item) => (
        <input
          key={`${item.id}-label`}
          className="free-canvas-arrow-label-input"
          style={{ left: ((item.x1 || 0) + (item.x2 || 0)) / 2 - 50, top: ((item.y1 || 0) + (item.y2 || 0)) / 2 - 30 }}
          value={item.text || ''}
          maxLength={80}
          onChange={(event) => onTextChange(item.id, event.target.value)}
        />
      ))}
      {data.items.filter((item) => item.type !== 'arrow').map((item) => (
        item.type === 'text' && selectedId === item.id && !readonly ? (
          <div key={item.id} className="free-canvas-item free-canvas-item-text free-canvas-text-wrapper active" style={{ left: item.x, top: item.y, width: item.width, height: item.height, background: item.fill, borderColor: item.stroke === 'transparent' ? 'rgba(97, 218, 251, 0.42)' : item.stroke }} onMouseDown={(event) => startDrag(event, item)}>
            <textarea
              className="free-canvas-text-editor"
              value={item.text || ''}
              onChange={(event) => onTextChange(item.id, event.target.value)}
              onMouseDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                const nearEdge = event.clientX - rect.left <= 8 || rect.right - event.clientX <= 8 || event.clientY - rect.top <= 8 || rect.bottom - event.clientY <= 8
                if (nearEdge) startDrag(event, item)
                else event.stopPropagation()
              }}
            />
          </div>
        ) : (
          <button key={item.id} type="button" className={`free-canvas-item free-canvas-item-${item.type} ${selectedId === item.id ? 'active' : ''}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, background: item.fill, borderColor: item.type === 'text' && item.stroke === 'transparent' ? 'rgba(97, 218, 251, 0.42)' : item.stroke }} onMouseDown={(event) => startDrag(event, item)} onClick={() => onSelect(item.id)}>
            {item.type === 'text' ? item.text || '点击编辑文字' : item.text || ''}
          </button>
        )
      ))}
    </div>
  )
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
  const [canvasData, setCanvasData] = useState(defaultCanvasData)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [exportingTopologyId, setExportingTopologyId] = useState()
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [canvasDirty, setCanvasDirty] = useState(false)
  const [selectedId, setSelectedId] = useState()
  const [selectedCanvasId, setSelectedCanvasId] = useState()
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
  const isCanvasTopology = currentTopology?.mode === 'canvas'
  const selectedCanvasItem = canvasData.items.find((item) => item.id === selectedCanvasId)
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
      const nextTopology = topologyItems.find((topology) => topology.id === nextTopologyId)
      const data = nextTopologyId && nextTopology?.mode !== 'canvas' ? await getTopology(nextTopologyId) : { nodes: [], edges: [] }
      const nextCanvasData = normalizeCanvasData(nextTopology?.canvasData)
      setTopologies(topologyItems)
      setCurrentTopologyId(nextTopologyId)
      setGraph(data)
      setCanvasData(nextCanvasData)
      setSelectedId((current) => current && data.nodes.some((node) => node.id === current) ? current : data.nodes[0]?.id)
      setSelectedCanvasId((current) => current && nextCanvasData.items.some((item) => item.id === current) ? current : nextCanvasData.items[0]?.id)
      setLayoutDirty(false)
      setCanvasDirty(false)
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
    topologyForm.setFieldsValue({ name: '', type: '业务拓扑', mode: 'structured', remark: '' })
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
      if (editingTopology?.id === currentTopologyId) setCanvasData(normalizeCanvasData(topology.canvasData))
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
        const nextTopology = nextTopologies.find((topology) => topology.id === nextId)
        const data = nextId && nextTopology?.mode !== 'canvas' ? await getTopology(nextId) : { nodes: [], edges: [] }
        const nextCanvasData = normalizeCanvasData(nextTopology?.canvasData)
        setCurrentTopologyId(nextId)
        setSelectedId(data.nodes[0]?.id)
        setSelectedCanvasId(nextCanvasData.items[0]?.id)
        setGraph(data)
        setCanvasData(nextCanvasData)
        setFilters({ groups: [], environments: [], statuses: [], types: [], tags: [] })
        setLayoutDirty(false)
        setCanvasDirty(false)
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

  function addCanvasItem(type) {
    const item = createCanvasItem(type, canvasData.items.length)
    setCanvasData((current) => ({ ...current, items: [...current.items, item] }))
    setSelectedCanvasId(item.id)
    setCanvasDirty(true)
  }

  function updateCanvasItem(id, values) {
    setCanvasData((current) => {
      const movingItem = current.items.find((item) => item.id === id)
      const deltaX = movingItem?.type === 'rect' && values.x !== undefined ? Number(values.x) - (movingItem.x || 0) : 0
      const deltaY = movingItem?.type === 'rect' && values.y !== undefined ? Number(values.y) - (movingItem.y || 0) : 0
      return {
        ...current,
        items: current.items.map((item) => {
          if (item.id === id) return { ...item, ...values }
          if (movingItem?.type === 'rect' && item.type === 'text' && (deltaX || deltaY) && isTextInsideRect(item, movingItem)) return { ...item, x: (item.x || 0) + deltaX, y: (item.y || 0) + deltaY }
          return item
        }),
      }
    })
    setCanvasDirty(true)
  }

  function removeCanvasItem(id) {
    const removedItem = canvasData.items.find((item) => item.id === id)
    const resolvedArrows = new Map(canvasData.items.filter((item) => item.type === 'arrow').map((item) => [item.id, resolveCanvasArrow(item, canvasData.items)]))
    const items = canvasData.items.filter((item) => item.id !== id).map((item) => {
      if (removedItem?.type !== 'rect' || item.type !== 'arrow') return item
      const resolved = resolvedArrows.get(item.id)
      return {
        ...item,
        ...(item.startBinding?.itemId === id ? { x1: resolved.x1, y1: resolved.y1, startBinding: undefined } : {}),
        ...(item.endBinding?.itemId === id ? { x2: resolved.x2, y2: resolved.y2, endBinding: undefined } : {}),
      }
    })
    setCanvasData((current) => ({ ...current, items }))
    setSelectedCanvasId(items[0]?.id)
    setCanvasDirty(true)
  }

  async function saveCanvas() {
    if (!currentTopologyId) return
    setSubmitting(true)
    try {
      const topology = await updateTopologyCanvas(currentTopologyId, canvasData)
      setTopologies((current) => current.map((item) => item.id === topology.id ? topology : item))
      setCanvasData(normalizeCanvasData(topology.canvasData))
      setCanvasDirty(false)
      message.success('画板已保存')
    } catch (error) {
      message.error(getErrorMessage(error, '画板保存失败'))
    } finally {
      setSubmitting(false)
    }
  }

  async function exportTopology(topology) {
    setExportingTopologyId(topology.id)
    try {
      const exportGraph = topology.mode === 'canvas' ? { nodes: [], edges: [] } : await getTopology(topology.id)
      await downloadTopologyPng(topology, exportGraph)
      message.success('拓扑图已导出')
    } catch (error) {
      message.error(getErrorMessage(error, '拓扑图导出失败'))
    } finally {
      setExportingTopologyId(undefined)
    }
  }

  const topologyColumns = [
    { title: '拓扑名称', dataIndex: 'name', render: (value, record) => <Button type="link" onClick={() => selectTopology(record.id)}>{value}</Button> },
    { title: '拓扑类型', dataIndex: 'type', width: 180, render: (value) => <Tag color="cyan">{value}</Tag> },
    { title: '模式', dataIndex: 'mode', width: 130, render: (value) => <Tag color={value === 'canvas' ? 'purple' : 'blue'}>{topologyModeLabel[value] || value}</Tag> },
    { title: '备注', dataIndex: 'remark', render: (value) => value || '-' },
    {
      title: '操作',
      width: 320,
      render: (_, record) => (
        <Space>
          <Button size="small" disabled={record.id === currentTopologyId} onClick={() => selectTopology(record.id)}>查看</Button>
          <Button size="small" icon={<DownloadOutlined />} loading={exportingTopologyId === record.id} disabled={Boolean(exportingTopologyId && exportingTopologyId !== record.id)} onClick={() => exportTopology(record)}>导出</Button>
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
              当前拓扑：{currentTopology ? `${currentTopology.name}（${currentTopology.type} / ${topologyModeLabel[currentTopology.mode]}）` : '暂无'}。结构化拓扑用于运维实体和动态同步，自由画板用于手工绘制架构草图、流程图和说明图。
            </Typography.Paragraph>
          </Col>
          <Col xs={24} xl={10}>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title={isCanvasTopology ? '画板元素' : '节点'} value={isCanvasTopology ? canvasData.items.length : visibleGraph.nodes.length} suffix={isCanvasTopology ? undefined : `/ ${graph.nodes.length}`} /></Col>
              <Col span={8}><Statistic title={isCanvasTopology ? '箭头' : '依赖线'} value={isCanvasTopology ? canvasData.items.filter((item) => item.type === 'arrow').length : visibleGraph.edges.length} suffix={isCanvasTopology ? undefined : `/ ${graph.edges.length}`} /></Col>
              <Col span={8}><Statistic title="拓扑模式" value={currentTopology ? topologyModeLabel[currentTopology.mode] : '-'} /></Col>
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

      {isCanvasTopology ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={17}>
            <Card
              title="自由画板"
              extra={(
                <PermissionGate permission={PERMISSIONS.TOPOLOGY_MANAGE}>
                  <Space wrap>
                    <Button icon={<PlusOutlined />} disabled={!hasCurrentTopology} onClick={() => addCanvasItem('rect')}>矩形</Button>
                    <Button icon={<PlusOutlined />} disabled={!hasCurrentTopology} onClick={() => addCanvasItem('text')}>文本</Button>
                    <Button icon={<PlusOutlined />} disabled={!hasCurrentTopology} onClick={() => addCanvasItem('arrow')}>箭头</Button>
                    <Button type="primary" icon={<SaveOutlined />} disabled={!hasCurrentTopology || !canvasDirty} loading={submitting} onClick={saveCanvas}>保存画板</Button>
                  </Space>
                </PermissionGate>
              )}
            >
              <Spin spinning={loading}>
                {canvasData.items.length ? <div className="static-topology-viewport"><FreeCanvasBoard data={canvasData} selectedId={selectedCanvasId} onSelect={setSelectedCanvasId} onMove={updateCanvasItem} onTextChange={(id, text) => updateCanvasItem(id, { text })} readonly={!canManageTopology} /></div> : <Empty description="暂无画板元素，请先添加矩形、文本或箭头" />}
              </Spin>
            </Card>
          </Col>
          <Col xs={24} xl={7}>
            <Card title="画板属性" extra={selectedCanvasItem ? <Tag color="purple">{selectedCanvasItem.type}</Tag> : null}>
              {selectedCanvasItem ? (
                <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                  <Form layout="vertical" disabled={!canManageTopology}>
                    <Form.Item label="文字">
                      <Input value={selectedCanvasItem.text} maxLength={80} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { text: event.target.value })} />
                    </Form.Item>
                    {selectedCanvasItem.type === 'arrow' ? (
                      <>
                        <Typography.Paragraph type="secondary">选中箭头后拖动两端圆点，靠近矩形边缘会自动吸附；绿色圆点表示已绑定。</Typography.Paragraph>
                        <Flex gap="small" wrap>
                          <Tag color={selectedCanvasItem.startBinding ? 'green' : 'default'}>起点：{selectedCanvasItem.startBinding ? '已吸附' : '自由'}</Tag>
                          <Tag color={selectedCanvasItem.endBinding ? 'green' : 'default'}>终点：{selectedCanvasItem.endBinding ? '已吸附' : '自由'}</Tag>
                        </Flex>
                        <Row gutter={12}>
                          <Col span={12}><Form.Item label="起点 X"><Input type="number" value={resolveCanvasArrow(selectedCanvasItem, canvasData.items).x1} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { x1: Number(event.target.value), startBinding: undefined })} /></Form.Item></Col>
                          <Col span={12}><Form.Item label="起点 Y"><Input type="number" value={resolveCanvasArrow(selectedCanvasItem, canvasData.items).y1} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { y1: Number(event.target.value), startBinding: undefined })} /></Form.Item></Col>
                          <Col span={12}><Form.Item label="终点 X"><Input type="number" value={resolveCanvasArrow(selectedCanvasItem, canvasData.items).x2} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { x2: Number(event.target.value), endBinding: undefined })} /></Form.Item></Col>
                          <Col span={12}><Form.Item label="终点 Y"><Input type="number" value={resolveCanvasArrow(selectedCanvasItem, canvasData.items).y2} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { y2: Number(event.target.value), endBinding: undefined })} /></Form.Item></Col>
                        </Row>
                        <Form.Item label="线条样式">
                          <Radio.Group
                            options={arrowLineStyleOptions}
                            optionType="button"
                            buttonStyle="solid"
                            value={selectedCanvasItem.lineStyle || 'solid'}
                            onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { lineStyle: event.target.value })}
                          />
                        </Form.Item>
                        <Form.Item label="箭头方向">
                          <Radio.Group
                            options={arrowDirectionOptions}
                            optionType="button"
                            buttonStyle="solid"
                            value={selectedCanvasItem.direction || 'forward'}
                            onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { direction: event.target.value })}
                          />
                        </Form.Item>
                      </>
                    ) : (
                      <Row gutter={12}>
                        <Col span={12}><Form.Item label="X"><Input type="number" value={selectedCanvasItem.x} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { x: Number(event.target.value) })} /></Form.Item></Col>
                        <Col span={12}><Form.Item label="Y"><Input type="number" value={selectedCanvasItem.y} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { y: Number(event.target.value) })} /></Form.Item></Col>
                        <Col span={12}><Form.Item label="宽"><Input type="number" value={selectedCanvasItem.width} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { width: Number(event.target.value) })} /></Form.Item></Col>
                        <Col span={12}><Form.Item label="高"><Input type="number" value={selectedCanvasItem.height} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { height: Number(event.target.value) })} /></Form.Item></Col>
                      </Row>
                    )}
                    <Row gutter={12}>
                      <Col span={12}><Form.Item label="填充色"><Input value={selectedCanvasItem.fill} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { fill: event.target.value })} /></Form.Item></Col>
                      <Col span={12}><Form.Item label="线条色"><Input value={selectedCanvasItem.stroke} onChange={(event) => updateCanvasItem(selectedCanvasItem.id, { stroke: event.target.value })} /></Form.Item></Col>
                    </Row>
                  </Form>
                  <PermissionGate permission={PERMISSIONS.TOPOLOGY_MANAGE}>
                    <Popconfirm title="删除该画板元素？" onConfirm={() => removeCanvasItem(selectedCanvasItem.id)}>
                      <Button danger icon={<DeleteOutlined />}>删除元素</Button>
                    </Popconfirm>
                  </PermissionGate>
                </Space>
              ) : <Empty description="请选择或新增画板元素" />}
            </Card>
          </Col>
        </Row>
      ) : (
        <>
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
        </>
      )}

      <Modal title={editingTopology ? '编辑拓扑' : '创建拓扑'} open={topologyModalOpen} onCancel={() => { setTopologyModalOpen(false); setEditingTopology(undefined) }} onOk={() => topologyForm.submit()} confirmLoading={submitting} destroyOnHidden>
        <Form form={topologyForm} layout="vertical" onFinish={submitTopology}>
          <Form.Item name="name" label="拓扑名称" rules={[{ required: true, message: '请输入拓扑名称' }]}><Input maxLength={80} placeholder="例如：核心交易链路拓扑" /></Form.Item>
          <Form.Item name="type" label="拓扑类型" rules={[{ required: true, message: '请选择拓扑类型' }]}><Select options={topologyTypeOptions} /></Form.Item>
          <Form.Item name="mode" label="拓扑模式" rules={[{ required: true, message: '请选择拓扑模式' }]}><Radio.Group options={topologyModeOptions} optionType="button" buttonStyle="solid" /></Form.Item>
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
