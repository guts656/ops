import { http } from './http'
import type { AccountFormValues, AccountMetadata, AccountUser } from '../types/account'

export async function listAccounts(): Promise<AccountUser[]> {
  const response = await http.get<{ data: AccountUser[] }>('/accounts')
  return response.data.data
}

export async function getAccountMetadata(): Promise<AccountMetadata> {
  const response = await http.get<AccountMetadata>('/accounts/metadata')
  return response.data
}

export async function createAccount(values: AccountFormValues): Promise<AccountUser> {
  const response = await http.post<{ data: AccountUser }>('/accounts', values)
  return response.data.data
}

export async function updateAccount(id: string, values: AccountFormValues): Promise<AccountUser> {
  const response = await http.patch<{ data: AccountUser }>(`/accounts/${id}`, values)
  return response.data.data
}

export async function setAccountEnabled(id: string, enabled: boolean): Promise<AccountUser> {
  const response = await http.patch<{ data: AccountUser }>(`/accounts/${id}/enabled`, { enabled })
  return response.data.data
}

export async function resetAccountPassword(id: string, password: string): Promise<AccountUser> {
  const response = await http.post<{ data: AccountUser }>(`/accounts/${id}/reset-password`, { password })
  return response.data.data
}

export async function deleteAccount(id: string): Promise<{ success: boolean; id: string }> {
  const response = await http.delete<{ success: boolean; id: string }>(`/accounts/${id}`)
  return response.data
}
