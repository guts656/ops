import { create } from 'zustand'
import { createAccount, deleteAccount, getAccountMetadata, listAccounts, resetAccountPassword, setAccountEnabled, updateAccount } from '../api/accounts'
import type { AccountFormValues, AccountMetadata, AccountUser } from '../types/account'
import { useAuthStore } from './authStore'

interface AccountStore {
  accounts: AccountUser[]
  metadata?: AccountMetadata
  loading: boolean
  saving: boolean
  load: () => Promise<void>
  saveAccount: (id: string | undefined, values: AccountFormValues) => Promise<void>
  toggleAccount: (id: string, enabled: boolean) => Promise<void>
  resetPassword: (id: string, password: string) => Promise<void>
  removeAccount: (id: string) => Promise<void>
}

function replaceAccount(accounts: AccountUser[], updated: AccountUser) {
  return accounts.map((account) => (account.id === updated.id ? updated : account))
}

function refreshCurrentUserIfNeeded(accountId: string) {
  const auth = useAuthStore.getState()
  if (auth.user?.id === accountId) void auth.loadCurrentUser()
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  accounts: [],
  loading: false,
  saving: false,
  async load() {
    set({ loading: true })
    const [accounts, metadata] = await Promise.all([listAccounts(), getAccountMetadata()])
    set({ accounts, metadata, loading: false })
  },
  async saveAccount(id, values) {
    set({ saving: true })
    const account = id ? await updateAccount(id, values) : await createAccount(values)
    set((state) => ({
      accounts: id ? replaceAccount(state.accounts, account) : [account, ...state.accounts],
      saving: false,
    }))
    refreshCurrentUserIfNeeded(account.id)
  },
  async toggleAccount(id, enabled) {
    set({ saving: true })
    const account = await setAccountEnabled(id, enabled)
    set((state) => ({ accounts: replaceAccount(state.accounts, account), saving: false }))
    refreshCurrentUserIfNeeded(account.id)
  },
  async resetPassword(id, password) {
    set({ saving: true })
    const account = await resetAccountPassword(id, password)
    set((state) => ({ accounts: replaceAccount(state.accounts, account), saving: false }))
    refreshCurrentUserIfNeeded(account.id)
  },
  async removeAccount(id) {
    set({ saving: true })
    await deleteAccount(id)
    set((state) => ({ accounts: state.accounts.filter((account) => account.id !== id), saving: false }))
    if (useAuthStore.getState().user?.id === id) useAuthStore.getState().logout()
  },
}))
