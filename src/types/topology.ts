export type TopologyMode = 'structured' | 'canvas'
export type TopologyCanvasArrowLineStyle = 'solid' | 'dashed'
export type TopologyCanvasArrowDirection = 'forward' | 'backward' | 'both' | 'none'
export type TopologyCanvasBindingSide = 'top' | 'right' | 'bottom' | 'left'
export type TopologyNodeType = 'business' | 'service' | 'host' | 'database' | 'middleware' | 'agent' | 'container' | 'note'

export interface TopologyCanvasBinding {
  itemId: string
  side: TopologyCanvasBindingSide
  ratio: number
}

export interface TopologyCanvasItem {
  id: string
  type: 'rect' | 'text' | 'arrow'
  x?: number
  y?: number
  width?: number
  height?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  text?: string
  fill?: string
  stroke?: string
  lineStyle?: TopologyCanvasArrowLineStyle
  direction?: TopologyCanvasArrowDirection
  startBinding?: TopologyCanvasBinding
  endBinding?: TopologyCanvasBinding
}

export interface TopologyCanvasData {
  version: number
  items: TopologyCanvasItem[]
}

export interface TopologyItem {
  id: string
  name: string
  type: string
  mode: TopologyMode
  remark: string
  canvasData: TopologyCanvasData
  createdAt: string
  updatedAt: string
}

export interface TopologyInput {
  name: string
  type: string
  mode?: TopologyMode
  remark?: string
}

export interface TopologyNode {
  id: string
  topologyId: string
  name: string
  type: TopologyNodeType
  status: string
  description: string
  x: number
  y: number
  hostId?: string
  group?: string
  environment?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export interface TopologyEdge {
  id: string
  topologyId: string
  sourceId: string
  targetId: string
  label: string
  createdAt: string
  updatedAt: string
}

export interface TopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export interface TopologyNodeInput {
  name: string
  type: TopologyNodeType
  status?: string
  description?: string
  x?: number
  y?: number
}

export interface TopologyEdgeInput {
  sourceId: string
  targetId: string
  label: string
}

export interface TopologyNodePositionInput {
  id: string
  x: number
  y: number
}
