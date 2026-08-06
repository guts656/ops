import assert from 'node:assert/strict'
import { convertXm2MonitorJson } from '../server/services/xm2MonitorJsonConverter.ts'

function convert(more) {
  const result = convertXm2MonitorJson([{
    key: 'xm2-defaults',
    type: 'fileContent',
    interval: 60,
    more: { mode: 'include', file: 'C:\\logs\\app.log', word: 'ERROR', ...more },
  }])
  assert.equal(result.candidates.length, 1)
  return result.candidates[0].rule
}

const defaults = convert({})
assert.equal(defaults.cooldownMinutes, 3)
assert.equal(defaults.description, '')

const described = convert({ describe: '业务错误日志', handle: '联系值班人员' })
assert.equal(described.description, '业务错误日志\n处理建议：联系值班人员')

console.log('xm2-converter-defaults-ok')
