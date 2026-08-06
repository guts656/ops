import assert from 'node:assert/strict'
import { alertMetadataHostIds, formatAlertHost, formatAlertHostPrefix, prefixAlertContent } from '../server/services/alertHostContext.ts'

const host = { id: 'host-1', ip: '172.29.20.18', hostname: 'WIN-V7S082F60FC', tags: ['office_tcdata-test'], group: 'Windows' }
const second = { id: 'host-2', ip: '172.29.20.19', hostname: 'server-19', tags: [], group: 'Linux' }

assert.equal(formatAlertHost(host), 'office_tcdata-test--172.29.20.18--WIN-V7S082F60FC')
assert.equal(formatAlertHost(second), '无标签--172.29.20.19--server-19')
assert.equal(formatAlertHostPrefix([host, second]), 'office_tcdata-test--172.29.20.18--WIN-V7S082F60FC、无标签--172.29.20.19--server-19')
assert.equal(prefixAlertContent('内存使用率超过 80%。', [host]), 'office_tcdata-test--172.29.20.18--WIN-V7S082F60FC；内存使用率超过 80%。')
assert.equal(prefixAlertContent('office_tcdata-test--172.29.20.18--WIN-V7S082F60FC；内存使用率超过 80%。', [host]), 'office_tcdata-test--172.29.20.18--WIN-V7S082F60FC；内存使用率超过 80%。')
assert.equal(prefixAlertContent('平台级告警', []), '平台级告警')
assert.deepEqual(alertMetadataHostIds({ matchedHostIds: ['matched-1'], hostId: 'configured-1', hostIds: ['configured-1', 'configured-2'] }), ['matched-1'])
assert.deepEqual(alertMetadataHostIds({ sourceHostId: 'source-1', hostIds: ['configured-1', 'configured-2'] }), ['source-1'])
assert.deepEqual(alertMetadataHostIds({ hostIds: ['configured-1', 'configured-2'] }), ['configured-1', 'configured-2'])
assert.deepEqual(alertMetadataHostIds({ alertHostIds: ['persisted-1'], matchedHostIds: ['old-match'] }), ['persisted-1'])

console.log('alert-host-context-ok')
