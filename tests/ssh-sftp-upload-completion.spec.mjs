import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const ssh = await readFile(new URL('../server/remote/ssh.ts', import.meta.url), 'utf8')

assert.match(ssh, /createWriteStream\(remotePath, \{ mode: 0o600 \}\)/, 'Linux uploads should use SFTP write streams')
assert.match(ssh, /stream\.on\('close', \(\) => resolve\(\)\)/, 'SFTP uploads should complete on the ssh2 close event')
assert.doesNotMatch(ssh, /stream\.on\('finish', \(\) => resolve\(\)\)/, 'SFTP uploads should not wait on a finish event that ssh2 does not reliably emit')

console.log('ssh-sftp-upload-completion-ok')
