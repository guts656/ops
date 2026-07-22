import tls from 'node:tls'

export type SslCertificateStatus = 'normal' | 'expiring' | 'expired' | 'failed'
export type SslAlertLevel = 'none' | 'warning30' | 'warning15' | 'warning7' | 'critical'

export interface SslCheckResult {
  issuer: string
  validFrom?: Date
  validTo?: Date
  remainingDays: number | null
  domainMatched: boolean
  status: SslCertificateStatus
  alertLevel: SslAlertLevel
  errorMessage?: string
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase()
}

export function isValidSslDomain(value: string) {
  const domain = normalizeDomain(value)
  if (!domain || domain.includes('/') || domain.includes(':') || domain.startsWith('.') || domain.endsWith('.')) return false
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(domain)) return false
  return /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)
}

function parseAltNames(value?: string) {
  if (!value) return []
  return value.split(',').map((item) => item.trim().replace(/^DNS:/i, '').toLowerCase()).filter(Boolean)
}

function matchesPattern(domain: string, pattern: string) {
  const normalized = normalizeDomain(pattern)
  if (normalized === domain) return true
  if (!normalized.startsWith('*.')) return false
  const suffix = normalized.slice(2)
  return domain.endsWith(`.${suffix}`) && domain.split('.').length === suffix.split('.').length + 1
}

function domainMatches(domain: string, subjectaltname?: string, cn?: string) {
  const names = parseAltNames(subjectaltname)
  if (names.length) return names.some((name) => matchesPattern(domain, name))
  return cn ? matchesPattern(domain, cn) : false
}

function alertLevel(status: SslCertificateStatus, remainingDays: number | null): SslAlertLevel {
  if (status === 'expired' || status === 'failed') return 'critical'
  if (status !== 'expiring' || remainingDays === null) return 'none'
  if (remainingDays <= 7) return 'warning7'
  if (remainingDays <= 15) return 'warning15'
  return 'warning30'
}

function statusFromDays(remainingDays: number | null, thresholds: number[], domainMatched: boolean): SslCertificateStatus {
  if (!domainMatched) return 'failed'
  if (remainingDays === null) return 'failed'
  if (remainingDays < 0) return 'expired'
  if (remainingDays <= Math.max(...thresholds, 30)) return 'expiring'
  return 'normal'
}

function issuerValue(issuer: tls.DetailedPeerCertificate['issuer']) {
  if (!issuer) return ''
  return [issuer.O, issuer.CN].filter(Boolean).join(' / ')
}

function compactError(message: string) {
  const clean = message.replace(/\0/g, '')
  return clean.length > 300 ? `${clean.slice(0, 300)}...` : clean
}

function emptyFailure(message: string): SslCheckResult {
  return {
    issuer: '',
    remainingDays: null,
    domainMatched: false,
    status: 'failed',
    alertLevel: 'critical',
    errorMessage: compactError(message),
  }
}

export async function checkSslCertificate(domainInput: string, port: number, thresholds: number[], timeoutMs = 10000): Promise<SslCheckResult> {
  const domain = normalizeDomain(domainInput)
  if (!isValidSslDomain(domain)) return emptyFailure('域名格式无效')

  return new Promise((resolve) => {
    let resolved = false
    const done = (result: SslCheckResult) => {
      if (resolved) return
      resolved = true
      resolve(result)
    }
    const socket = tls.connect({ host: domain, port, servername: domain, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const certificate = socket.getPeerCertificate(true)
      if (!certificate || !certificate.valid_to) {
        socket.end()
        done(emptyFailure('未获取到服务端证书'))
        return
      }

      const validFrom = new Date(certificate.valid_from)
      const validTo = new Date(certificate.valid_to)
      const remainingDays = Math.ceil((validTo.getTime() - Date.now()) / 86400000)
      const subjectAltName = Array.isArray(certificate.subjectaltname) ? certificate.subjectaltname.join(',') : certificate.subjectaltname
      const commonName = Array.isArray(certificate.subject?.CN) ? certificate.subject.CN[0] : certificate.subject?.CN
      const matched = domainMatches(domain, subjectAltName, commonName)
      const status = statusFromDays(remainingDays, thresholds, matched)
      socket.end()
      done({
        issuer: issuerValue(certificate.issuer),
        validFrom: Number.isNaN(validFrom.getTime()) ? undefined : validFrom,
        validTo: Number.isNaN(validTo.getTime()) ? undefined : validTo,
        remainingDays,
        domainMatched: matched,
        status,
        alertLevel: alertLevel(status, remainingDays),
        errorMessage: matched ? undefined : '证书域名与监控域名不匹配',
      })
    })

    socket.on('timeout', () => {
      socket.destroy()
      done(emptyFailure('TLS 连接超时'))
    })
    socket.on('error', (error) => {
      socket.destroy()
      done(emptyFailure(error.message))
    })
  })
}
