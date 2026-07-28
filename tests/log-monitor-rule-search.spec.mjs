import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../src/pages/LogMonitoring.tsx', import.meta.url), 'utf8')

assert.match(source, /ruleSearch/, 'log monitor page should keep rule search state')
assert.match(source, /useDeferredValue\(ruleSearch\)/, 'rule search should use deferred input to keep typing responsive')
assert.match(source, /搜索规则名\/关键字\/主机\/IP\/来源\/服务/, 'rule table should expose a practical search placeholder')
assert.match(source, /formatRuleHostScope\(rule, true\)/, 'rule search should include host scope text')
assert.match(source, /rule\.keywords/, 'rule search should include keywords')
assert.match(source, /hostLabelById\[hostId\]/, 'rule search should include host IP and hostname labels')
assert.match(source, /显示 \{filteredRules\.length\}\/\{rules\.length\}/, 'rule list should show filtered result count')

console.log('log-monitor-rule-search-ok')
