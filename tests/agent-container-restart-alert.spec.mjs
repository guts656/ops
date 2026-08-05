import assert from 'node:assert/strict'
import { containerRestartAlertLevel, detectContainerRestartEvents } from '../server/data/hostContainers.ts'

const serviceName = 'ss2-bo'
const swarmLabels = (slot, taskId) => ({
  'com.docker.swarm.service.name': serviceName,
  'com.docker.swarm.task.name': `${serviceName}.${slot}.${taskId}`,
})

function existing({ id, slot = 1, taskId = 'old', state = 'running', restartCount = 0 }) {
  return {
    containerId: id,
    name: `${serviceName}.${slot}.${taskId}`,
    labels: swarmLabels(slot, taskId),
    logicalKey: `swarm:${serviceName}`,
    state,
    restartCount,
    isCurrent: true,
  }
}

function incoming({ id, slot = 1, taskId, state = 'running', status = 'Up 1 second', restartCount = 0 }) {
  return {
    containerId: id,
    name: `${serviceName}.${slot}.${taskId}`,
    image: 'reg.server:5000/ss2-bo:3.1.0',
    labels: swarmLabels(slot, taskId),
    state,
    status,
    restartCount,
  }
}

const replacement = detectContainerRestartEvents(
  [existing({ id: 'old-container' })],
  [
    incoming({ id: 'old-container', taskId: 'old', state: 'exited', status: 'Exited (3) 2 seconds ago' }),
    incoming({ id: 'new-container', taskId: 'new' }),
  ],
)
assert.deepEqual(replacement.replacementPairs, [{ previousContainerId: 'old-container', currentContainerId: 'new-container' }])
assert.deepEqual(replacement.restartCountPairs, [])
assert.equal(containerRestartAlertLevel('Exited (3) 2 seconds ago'), '严重')
assert.equal(containerRestartAlertLevel('Exited (0) 2 seconds ago'), '警告')

const delayedReplacement = detectContainerRestartEvents(
  [existing({ id: 'already-exited', state: 'exited' })],
  [incoming({ id: 'delayed-new', taskId: 'new' })],
)
assert.deepEqual(delayedReplacement.replacementPairs, [{ previousContainerId: 'already-exited', currentContainerId: 'delayed-new' }])

const restarted = detectContainerRestartEvents(
  [existing({ id: 'same-container', restartCount: 0 })],
  [incoming({ id: 'same-container', taskId: 'old', restartCount: 2 })],
)
assert.deepEqual(restarted.restartCountPairs, [{ previousContainerId: 'same-container', currentContainerId: 'same-container' }])

const scaleOut = detectContainerRestartEvents(
  [existing({ id: 'slot-1', slot: 1 })],
  [incoming({ id: 'slot-1', slot: 1, taskId: 'old' }), incoming({ id: 'slot-2', slot: 2, taskId: 'new' })],
)
assert.deepEqual(scaleOut.replacementPairs, [], 'adding a new replica must not be reported as a restart')

const firstSnapshot = detectContainerRestartEvents([], [incoming({ id: 'first', taskId: 'first', restartCount: 3 })])
assert.deepEqual(firstSnapshot, { replacementPairs: [], restartCountPairs: [] }, 'initial discovery must not report historical restarts')

console.log('agent-container-restart-alert-ok')
