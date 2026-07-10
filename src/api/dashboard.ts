import { http } from './http'

export async function getDashboardData() {
  const response = await http.get('/dashboard')
  return response.data.data
}
