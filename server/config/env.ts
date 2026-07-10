import 'dotenv/config'

type SecretName = 'JWT_SECRET' | 'OPS_AGENT_TOKEN_PEPPER' | 'CREDENTIAL_ENCRYPTION_KEY'

const placeholderValues = new Set([
  'admin123',
  'change-this-admin-password',
  'change-this-password',
  'default-secret',
  'local-dev-secret-change-me',
  'ops-platform-agent-token-dev-secret',
  'replace-with-a-long-random-secret',
  'replace-with-at-least-32-random-characters',
  'replace-with-a-strong-initial-admin-password',
  'replace-with-random-secret',
])

const devDefaults: Record<SecretName, string> = {
  JWT_SECRET: 'local-dev-secret-change-me',
  OPS_AGENT_TOKEN_PEPPER: 'ops-platform-agent-token-dev-secret',
  CREDENTIAL_ENCRYPTION_KEY: 'local-dev-credential-encryption-key',
}

const devCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']

export const isProduction = process.env.NODE_ENV === 'production'

function compact(value?: string) {
  return value?.trim() || ''
}

function isPlaceholder(value: string) {
  return placeholderValues.has(value.trim().toLowerCase())
}

function assertUsableSecret(name: SecretName, value: string) {
  if (value.length < 32 || isPlaceholder(value)) {
    const message = `${name} 必须配置为至少 32 位的随机密钥，不能使用默认值或占位值`
    if (isProduction) throw new Error(message)
    console.warn(`[security] ${message}`)
  }
  return value
}

function readSecret(name: SecretName) {
  const value = compact(process.env[name])
  if (value) return assertUsableSecret(name, value)
  if (isProduction) throw new Error(`${name} is required in production`)
  console.warn(`[security] ${name} 未配置，当前仅在开发环境使用本地默认值`)
  return devDefaults[name]
}

function parseOrigins(value?: string) {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function readLegacySecrets(name: string) {
  return Array.from(new Set(parseOrigins(process.env[name])))
}

export const jwtSecret = readSecret('JWT_SECRET')
export const agentTokenPepper = readSecret('OPS_AGENT_TOKEN_PEPPER')
export const credentialEncryptionKey = readSecret('CREDENTIAL_ENCRYPTION_KEY')
export const legacyAgentTokenPeppers = readLegacySecrets('LEGACY_AGENT_TOKEN_PEPPERS')
export const legacyCredentialEncryptionKeys = readLegacySecrets('LEGACY_CREDENTIAL_ENCRYPTION_KEYS')
export const jwtExpiresIn = compact(process.env.JWT_EXPIRES_IN) || '2h'
export const corsOrigins = parseOrigins(process.env.CORS_ORIGINS)

if (isProduction && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS is required in production')
}

export function isAllowedOrigin(origin?: string) {
  if (!origin) return true
  const allowedOrigins = corsOrigins.length ? corsOrigins : devCorsOrigins
  return allowedOrigins.includes(origin)
}

export function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (isAllowedOrigin(origin)) return callback(null, true)
  return callback(null, false)
}

export function requireInitialAdminPassword() {
  const password = compact(process.env.INITIAL_ADMIN_PASSWORD)
  if (!password) throw new Error('INITIAL_ADMIN_PASSWORD is required for database seed')
  if (password.length < 12 || isPlaceholder(password) || password === compact(process.env.INITIAL_ADMIN_USERNAME)) {
    throw new Error('INITIAL_ADMIN_PASSWORD 必须至少 12 位，且不能使用默认值、占位值或与用户名相同')
  }
  return password
}

export function validateSecurityEnv() {
  void jwtSecret
  void agentTokenPepper
  void credentialEncryptionKey
  void jwtExpiresIn
  void corsOrigins
}
