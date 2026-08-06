import assert from 'node:assert/strict'
import { CHINA_HOLIDAYS_2026 } from '../src/constants/chinaHolidays.ts'
import { isLogMonitorScheduleActive, shanghaiScheduleParts } from '../server/services/logMonitorSchedule.ts'
import { convertXm2MonitorJson } from '../server/services/xm2MonitorJsonConverter.ts'

const fridayOvernight = {
  daysOfWeek: [1, 2, 3, 4, 5],
  timeRanges: [
    { start: '21:00', end: '23:59' },
    { start: '00:00', end: '02:30', dayOffset: 1 },
  ],
  holidayMode: 'ignore',
  holidays: [],
}

assert.deepEqual(shanghaiScheduleParts(new Date('2026-08-07T15:00:00Z')), {
  date: '2026-08-07',
  time: '23:00',
  weekday: 5,
})
assert.equal(isLogMonitorScheduleActive(fridayOvernight, new Date('2026-08-07T15:00:00Z')), true)
assert.equal(isLogMonitorScheduleActive(fridayOvernight, new Date('2026-08-07T17:30:00Z')), true)
assert.equal(isLogMonitorScheduleActive(fridayOvernight, new Date('2026-08-07T19:00:00Z')), false)

const saturdayOnlyRange = {
  ...fridayOvernight,
  timeRanges: [{ start: '00:00', end: '03:00', daysOfWeek: [6] }],
}
assert.equal(isLogMonitorScheduleActive(saturdayOnlyRange, new Date('2026-08-07T17:30:00Z')), true)
assert.equal(isLogMonitorScheduleActive(saturdayOnlyRange, new Date('2026-08-06T17:30:00Z')), false)

const excludedHoliday = {
  daysOfWeek: [],
  timeRanges: [],
  holidayMode: 'exclude',
  holidays: ['2026-01-02'],
}
assert.equal(isLogMonitorScheduleActive(excludedHoliday, new Date('2026-01-02T02:00:00Z')), false)
assert.equal(isLogMonitorScheduleActive(excludedHoliday, new Date('2026-01-04T02:00:00Z')), true)

const converted = convertXm2MonitorJson([{
  key: 'friday-night',
  type: 'fileContent',
  hhmm: '2100-0230',
  interval: 60,
  more: { mode: 'include', file: 'C:\\logs\\mux.log', word: 'ERROR' },
}])
assert.deepEqual(converted.candidates[0].rule.timeRanges, [
  { start: '21:00', end: '23:59' },
  { start: '00:00', end: '02:30', dayOffset: 1 },
])
assert.equal(converted.candidates[0].rule.cooldownMinutes, 3)
assert.equal(converted.candidates[0].rule.description, '')

const described = convertXm2MonitorJson([{
  key: 'described-rule',
  type: 'fileContent',
  interval: 60,
  more: { mode: 'include', file: 'C:\\logs\\described.log', word: 'ERROR', describe: '业务错误日志', handle: '联系值班人员' },
}])
assert.equal(described.candidates[0].rule.description, '业务错误日志\n处理建议：联系值班人员')

assert.equal(CHINA_HOLIDAYS_2026.length, 33)
assert.equal(CHINA_HOLIDAYS_2026[0], '2026-01-01')
assert.equal(CHINA_HOLIDAYS_2026.at(-1), '2026-10-07')

console.log('log-monitor-overnight-schedule-ok')
