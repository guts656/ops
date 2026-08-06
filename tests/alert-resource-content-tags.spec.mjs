import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const [resourceRules, alertContext, ingestion, alertList] = await Promise.all([
  source('server/data/hostResourceMonitorRules.ts'),
  source('server/services/alertHostContext.ts'),
  source('server/services/alertIngestionService.ts'),
  source('src/components/AlertList.jsx'),
])

assert.doesNotMatch(resourceRules, /const hostInfo =/, 'resource alerts should delegate host prefixes to the shared ingestion layer')
assert.match(alertContext, /tags\.length \? tags\.join\('、'\) : '无标签'/, 'shared alert host prefix should use host tags without the host group')
assert.match(alertContext, /--\$\{target\.ip \|\| '未知IP'\}--/, 'shared alert host prefix should use compact tags-ip-host format')
assert.match(alertContext, /return `\$\{prefix\}；\$\{content\}`/, 'shared formatter should place the prefix before alert content')
assert.match(ingestion, /const content = prefixAlertContent\(input\.content, hostTargets\)/, 'all ingested alerts should use the shared host prefix')
assert.match(resourceRules, /metadata: \{[\s\S]*hostIp: host\.ip[\s\S]*group: host\.group[\s\S]*tags: host\.tags \|\| \[\]/, 'resource alert metadata should include ip, group and tags')
assert.doesNotMatch(alertList, /\[host\.group, \.\.\.\(host\.tags \|\| \[\]\)\]/, 'host group should not be rendered as an alert tag')
assert.equal((alertList.match(/<HostTargetTags item=\{item\} \/>/g) || []).length, 1, 'alert list should not render duplicated host tags')

console.log('alert-resource-content-tags-ok')
