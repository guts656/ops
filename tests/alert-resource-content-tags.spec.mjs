import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const [resourceRules, alertList] = await Promise.all([
  source('server/data/hostResourceMonitorRules.ts'),
  source('src/components/AlertList.jsx'),
])

assert.match(resourceRules, /function hostTagText\(host: HostTarget\)/, 'host resource alerts should format host tags')
assert.match(resourceRules, /const labels = \(host\.tags \|\| \[\]\)\.filter\(Boolean\)/, 'resource alert tag text should not mix host group into tags')
assert.match(resourceRules, /const hostInfo = `\$\{hostTagText\(host\)\}--\$\{host\.ip\}--\$\{hostNameText\(host\)\}`/, 'resource alert body should use compact tags-ip-host prefix')
assert.match(resourceRules, /metadata: \{[\s\S]*hostIp: host\.ip[\s\S]*group: host\.group[\s\S]*tags: host\.tags \|\| \[\]/, 'resource alert metadata should include ip, group and tags')
assert.equal((alertList.match(/<HostTargetTags item=\{item\} \/>/g) || []).length, 1, 'alert list should not render duplicated host tags')

console.log('alert-resource-content-tags-ok')
