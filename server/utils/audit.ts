import type { HostAction, HostAuditLog } from '../types/host'
import { shanghaiDate, shanghaiTime } from './time'

function simpleHash(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

export function buildHostAuditHashChain(logs: Omit<HostAuditLog, 'previousHash' | 'hash'>[]): HostAuditLog[] {
  return logs.map((log, index) => {
    const previousHash = index === 0 ? 'HOST-GENESIS-2026' : simpleHash(JSON.stringify(logs[index - 1]))
    const hash = simpleHash(`${previousHash}:${JSON.stringify(log)}`)
    return { ...log, previousHash, hash }
  })
}

export function createHostAudit(operator: string, action: HostAction, target: string, result: '成功' | '失败' = '成功', detail = ''): Omit<HostAuditLog, 'previousHash' | 'hash'> {
  const retention = new Date()
  retention.setFullYear(retention.getFullYear() + 7)

  return {
    id: `HAUD-${Date.now()}`,
    time: shanghaiTime(new Date()),
    operator,
    action,
    target,
    result,
    detail,
    retentionUntil: shanghaiDate(retention),
  }
}
