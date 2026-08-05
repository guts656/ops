import assert from 'node:assert/strict'
import net from 'node:net'
import { probeIpush } from '../server/services/ipushProbe.ts'

const baseConfig = {
  targetHost: '127.0.0.1',
  systemCode: 'ICE',
  serviceCode: 'QuoteSvcGQ',
  username: 'test_account',
  password: 'test_password',
  expectedGreeting: 'xinit',
  expectedLoginResult: 'xaucode 200_login_ok',
  connectTimeoutMs: 500,
  responseTimeoutMs: 200,
}

async function withServer(onConnection, run) {
  const server = net.createServer(onConnection)
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    return await run(address.port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const healthy = await withServer((socket) => {
  socket.write('xinit\r\n')
  socket.once('data', (data) => {
    assert.equal(data.toString('utf8'), 'xlogin ICE QuoteSvcGQ test_account test_password\r\n')
    socket.write('xaucode 200_login_ok\r\n')
  })
}, (port) => probeIpush({ ...baseConfig, port }))
assert.equal(healthy.ok, true)
assert.equal(healthy.stage, 'healthy')
assert.doesNotMatch(healthy.responseSnippet, /test_password/)

const echoedLogin = await withServer((socket) => {
  socket.write('xinit\r\n')
  socket.once('data', (data) => {
    socket.write(data)
    socket.end('xaucode 200_login_ok\r\n')
  })
}, (port) => probeIpush({ ...baseConfig, port }))
assert.equal(echoedLogin.ok, true)
assert.match(echoedLogin.responseSnippet, /xlogin \*\*\*\*\*\*/)
assert.doesNotMatch(echoedLogin.responseSnippet, /test_account|test_password/)
assert.doesNotMatch(echoedLogin.responseSnippet, /QuoteSvcGQ/)

const echoedLoginRejected = await withServer((socket) => {
  socket.write('xinit\r\n')
  socket.once('data', (data) => {
    socket.write(data)
    socket.end('xaucode 403_login_failed\r\n')
  })
}, (port) => probeIpush({ ...baseConfig, port }))
assert.equal(echoedLoginRejected.ok, false)
assert.doesNotMatch(echoedLoginRejected.responseSnippet, /test_account|test_password/)
assert.doesNotMatch(echoedLoginRejected.errorMessage, /test_account|test_password/)
assert.doesNotMatch(echoedLoginRejected.errorMessage, /QuoteSvcGQ/)

const noGreeting = await withServer((socket) => {
  socket.end('not-ready\r\n')
}, (port) => probeIpush({ ...baseConfig, port }))
assert.equal(noGreeting.ok, false)
assert.equal(noGreeting.stage, 'greeting')
assert.match(noGreeting.errorMessage, /未收到 xinit/)

const loginRejected = await withServer((socket) => {
  socket.write('xinit\r\n')
  socket.once('data', () => socket.end('xaucode 403_login_failed\r\n'))
}, (port) => probeIpush({ ...baseConfig, port }))
assert.equal(loginRejected.ok, false)
assert.equal(loginRejected.stage, 'login')
assert.match(loginRejected.errorMessage, /登录返回异常/)

const greetingTimeout = await withServer(() => {}, (port) => probeIpush({ ...baseConfig, port, responseTimeoutMs: 50 }))
assert.equal(greetingTimeout.ok, false)
assert.equal(greetingTimeout.stage, 'greeting')
assert.match(greetingTimeout.errorMessage, /未在 50ms 内收到 xinit/)

console.log('ipush-probe-ok')
