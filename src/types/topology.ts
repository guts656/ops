export type TopologyNodeType = 'business' | 'service' | 'host' | 'database' | 'middleware' | 'agent' | 'container' | 'note'

export interface TopologyItem {
  id: string
  name: string
  type: string
  remark: string
  createdAt: string
  updatedAt: string
}

export interface TopologyInput {
  name: string
  type: string
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
