import jwt, { type SignOptions } from 'jsonwebtoken'
import { jwtExpiresIn, jwtSecret } from '../config/env'
import type { AuthUser, TokenPayload } from '../types/auth'

export function signToken(user: AuthUser) {
  const payload: TokenPayload = { username: user.username, role: user.role, tokenVersion: user.tokenVersion }
  const options: SignOptions = { expiresIn: jwtExpiresIn as SignOptions['expiresIn'] }
  return jwt.sign(payload, jwtSecret, options)
}

export function verifyToken(token: string) {
  return jwt.verify(token, jwtSecret) as TokenPayload
}
