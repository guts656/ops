import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pages/LogMonitoring.tsx', import.meta.url), 'utf8')

assert.match(source, /`\$\{host\.hostname \|\| '未命名主机'\} - \$\{host\.ip\}`/)
assert.match(source, /主机已删除（请重新选择）/)
assert.match(source, /规则绑定的主机已删除/)
assert.doesNotMatch(source, /hostLabelById\[hostId\] \|\| hostId/)

console.log('log-monitor-host-label-ok')
