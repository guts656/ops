import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { agentTokenPepper, legacyAgentTokenPeppers } from '../config/env'

export function generateAgentToken() {
  return randomBytes(32).toString('base64url')
}

export function hashAgentToken(token: string) {
  return createHmac('sha256', agentTokenPepper).update(token).digest('hex')
}

function hashWithPepper(token: string, pepper: string) {
  return createHmac('sha256', pepper).update(token).digest('hex')
}

function matchesHash(token: string, expectedHash: string, pepper: string) {
  const actual = Buffer.from(hashWithPepper(token, pepper), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function verifyAgentToken(token: string, expectedHash: string) {
  return [agentTokenPepper, ...legacyAgentTokenPeppers].some((pepper) => matchesHash(token, expectedHash, pepper))
}
