import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../server/data/hosts.ts', import.meta.url), 'utf8')
const addHostsBody = source.match(/export async function addHosts\(values: AddHostFormValues, operator: string\) \{([\s\S]*?)\n\}\n\nexport async function updateHost/)?.[1] ?? ''
const updateHostBody = source.match(/export async function updateHost\(id: string, values: EditHostValues, operator: string\) \{([\s\S]*?)\n\}\n\nexport async function deleteHost/)?.[1] ?? ''

assert.match(addHostsBody, /以下 IP 已存在，不能重复纳管/, 'addHosts should reject duplicate managed IPs with a clear message')
assert.match(addHostsBody, /void runInstallJob\(hostItem, credentials, operator, 'install_agent'\)\.catch/, 'addHosts should install Agent in the background with validated credentials')
assert.doesNotMatch(addHostsBody, /const installed = await runInstallJob/, 'addHosts should not block the request while installing Agent')
assert.doesNotMatch(addHostsBody, /marketType:/, 'addHosts should not write fields missing from the deployed Host model')
assert.doesNotMatch(updateHostBody, /marketType:/, 'updateHost should not write fields missing from the deployed Host model')

console.log('host-add-background-install-ok')
