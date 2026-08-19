import type { TopologyCanvasData, TopologyEdge, TopologyEdgeInput, TopologyGraph, TopologyInput, TopologyItem, TopologyNode, TopologyNodeInput, TopologyNodePositionInput } from '../types/topology'
import { http } from './http'

export async function getTopologies(): Promise<TopologyItem[]> {
  const response = await http.get<{ data: TopologyItem[] }>('/topology/items')
  return response.data.data
}

export async function createTopology(values: TopologyInput): Promise<TopologyItem> {
  const response = await http.post<{ data: TopologyItem }>('/topology/items', values)
  return response.data.data
}

export async function updateTopology(id: string, values: TopologyInput): Promise<TopologyItem> {
  const response = await http.put<{ data: TopologyItem }>(`/topology/items/${id}`, values)
  return response.data.data
}

export async function deleteTopology(id: string): Promise<void> {
  await http.delete(`/topology/items/${id}`)
}

export async function getTopology(topologyId: string): Promise<TopologyGraph> {
  const response = await http.get<{ data: TopologyGraph }>(`/topology/items/${topologyId}/graph`)
  return response.data.data
}

export async function updateTopologyCanvas(topologyId: string, values: TopologyCanvasData): Promise<TopologyItem> {
  const response = await http.put<{ data: TopologyItem }>(`/topology/items/${topologyId}/canvas`, values)
  return response.data.data
}

export async function createTopologyNode(topologyId: string, values: TopologyNodeInput): Promise<TopologyNode> {
  const response = await http.post<{ data: TopologyNode }>(`/topology/items/${topologyId}/nodes`, values)
  return response.data.data
}

export async function updateTopologyNode(topologyId: string, id: string, values: TopologyNodeInput): Promise<TopologyNode> {
  const response = await http.put<{ data: TopologyNode }>(`/topology/items/${topologyId}/nodes/${id}`, values)
  return response.data.data
}

export async function deleteTopologyNode(topologyId: string, id: string): Promise<void> {
  await http.delete(`/topology/items/${topologyId}/nodes/${id}`)
}

export async function createTopologyEdge(topologyId: string, values: TopologyEdgeInput): Promise<TopologyEdge> {
  const response = await http.post<{ data: TopologyEdge }>(`/topology/items/${topologyId}/edges`, values)
  return response.data.data
}

export async function updateTopologyEdge(topologyId: string, id: string, values: TopologyEdgeInput): Promise<TopologyEdge> {
  const response = await http.put<{ data: TopologyEdge }>(`/topology/items/${topologyId}/edges/${id}`, values)
  return response.data.data
}

export async function deleteTopologyEdge(topologyId: string, id: string): Promise<void> {
  await http.delete(`/topology/items/${topologyId}/edges/${id}`)
}

export async function updateTopologyLayout(topologyId: string, positions: TopologyNodePositionInput[]): Promise<TopologyGraph> {
  const response = await http.put<{ data: TopologyGraph }>(`/topology/items/${topologyId}/layout`, { positions })
  return response.data.data
}

export async function syncDynamicTopology(topologyId: string): Promise<TopologyGraph> {
  const response = await http.post<{ data: TopologyGraph }>(`/topology/items/${topologyId}/sync`)
  return response.data.data
}
