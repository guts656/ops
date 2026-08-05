import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const route = await readFile(new URL('../server/routes/batchJobs.ts', import.meta.url), 'utf8')
const data = await readFile(new URL('../server/data/batchJobs.ts', import.meta.url), 'utf8')
const installer = await readFile(new URL('../server/remote/agentInstaller.ts', import.meta.url), 'utf8')

assert.match(route, /value\.fileContentBase64 === undefined/, 'API should distinguish a missing upload from a zero-byte file')
assert.doesNotMatch(data, /上传文件不能为空/, 'batch execution should not reject zero-byte files')
assert.match(data, /input\.fileContentBase64 !== undefined \? Buffer\.from\(input\.fileContentBase64, 'base64'\)/, 'batch execution should decode an empty Base64 payload')
assert.match(data, /uploadContent !== undefined \? md5Hex\(uploadContent\)/, 'zero-byte uploads should retain their standard MD5')
assert.match(data, /fileContentBase64: content !== undefined \? content\.toString\('base64'\) : undefined/, 'Windows jobs should send an explicit empty Base64 payload')
assert.match(data, /result\.contentBase64 !== undefined/, 'empty download results should be persisted as artifacts')
assert.doesNotMatch(installer, /Is-Blank \$contentBase64\) \{ throw 'missing file content'/, 'Windows Agent should write zero-byte files')
assert.match(installer, /if \(\$action -eq 'download_file' -and \$success\) \{ \$payload\.contentBase64 = \$contentBase64 \}/, 'Windows Agent should return an explicit empty Base64 payload for zero-byte downloads')

console.log('batch-empty-file-upload-ok')
