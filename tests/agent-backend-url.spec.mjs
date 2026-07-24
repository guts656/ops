import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const hostSource = await readFile(new URL('../server/data/hosts.ts', import.meta.url), 'utf8')
const modalSource = await readFile(new URL('../src/components/hosts/AgentCredentialModal.tsx', import.meta.url), 'utf8')

const candidatesBlock = hostSource.match(/function agentBackendCandidates\(\) \{\n([\s\S]*?)\n\}/)?.[1] ?? ''
assert.ok(candidatesBlock.indexOf('process.env.OPS_AGENT_PUBLIC_URL') < candidatesBlock.indexOf('...localIpv4Urls()'), 'OPS_AGENT_PUBLIC_URL should be preferred over auto-detected API port URLs')

assert.match(modalSource, /function defaultAgentApiBaseUrl\(\)/, 'reinstall modal should centralize Agent API URL defaults')
assert.match(modalSource, /window\.location\.port === '5173'.*:3001/, 'local Vite development should still default Agent API calls to port 3001')
assert.match(modalSource, /return window\.location\.origin/, 'deployed UI should default Agent API calls to the current reachable origin')

console.log('agent-backend-url-ok')
