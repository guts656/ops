import { runSshCommand } from './ssh'
import type { RemoteCommandResult, RemoteConnectionInput } from './types'
import { runWinrmCommand } from './winrm'

export interface HttpProbeInput {
  url: string
  method: 'GET' | 'POST' | 'HEAD'
  keyword: string
  timeoutMs: number
}

export interface HttpProbeResult {
  statusCode?: number
  latencyMs: number
  matched: boolean
  responseSnippet: string
  errorMessage?: string
}

const SNIPPET_LIMIT = 2000

function shSingle(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function psString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function payload(input: HttpProbeInput) {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64')
}

function linuxCommand(encoded: string) {
  const script = String.raw`
import base64, json, sys, time, urllib.error, urllib.request

payload = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
url = payload['url']
method = payload.get('method') or 'GET'
keyword = payload.get('keyword') or ''
timeout = max(1, int(payload.get('timeoutMs') or 8000) / 1000)
started = time.time()
status = None
body = ''
error = ''
try:
    request = urllib.request.Request(url, method=method, headers={'User-Agent': 'ops-platform-cgi-monitor/1.0'})
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
        status = response.getcode()
        if method != 'HEAD':
            body = response.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as exc:
        status = exc.code
        if method != 'HEAD':
            body = exc.read().decode('utf-8', 'replace')
    matched = keyword in body if keyword else True
except Exception as exc:
    matched = False
    error = str(exc)
latency = int((time.time() - started) * 1000)
print(json.dumps({
    'statusCode': status,
    'latencyMs': latency,
    'matched': matched,
    'responseSnippet': body.replace('\x00', '')[:2000],
    'errorMessage': error,
}, ensure_ascii=False, separators=(',', ':')))
`
  return `payload=${shSingle(encoded)}; if command -v python3 >/dev/null 2>&1; then python3 - "$payload" <<'PY'
${script}
PY
elif command -v python >/dev/null 2>&1; then python - "$payload" <<'PY'
${script}
PY
else printf '%s\n' '{"latencyMs":0,"matched":false,"responseSnippet":"","errorMessage":"远端主机缺少 python/python3，无法执行 URL 探测"}'; fi`
}

function windowsScript(encoded: string) {
  return `
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${psString(encoded)})) | ConvertFrom-Json
$url = [string]$payload.url
$method = if ($payload.method) { [string]$payload.method } else { 'GET' }
$keyword = if ($payload.keyword) { [string]$payload.keyword } else { '' }
$timeoutMs = if ($payload.timeoutMs) { [int]$payload.timeoutMs } else { 8000 }
$sw = [Diagnostics.Stopwatch]::StartNew()
$statusCode = $null
$body = ''
$errorMessage = ''
try {
  $request = [Net.HttpWebRequest]::Create($url)
  $request.Method = $method
  $request.Timeout = $timeoutMs
  $request.ReadWriteTimeout = $timeoutMs
  $request.UserAgent = 'ops-platform-cgi-monitor/1.0'
  try {
    $response = $request.GetResponse()
    $statusCode = [int]$response.StatusCode
    if ($method -ne 'HEAD') {
      $reader = New-Object IO.StreamReader($response.GetResponseStream())
      $body = $reader.ReadToEnd()
      $reader.Close()
    }
    $response.Close()
  } catch [Net.WebException] {
    if ($_.Exception.Response) {
      $response = $_.Exception.Response
      $statusCode = [int]$response.StatusCode
      if ($method -ne 'HEAD') {
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
      }
      $response.Close()
    } else {
      throw
    }
  }
  $matched = if ($keyword.Length -gt 0) { $body.Contains($keyword) } else { $true }
} catch {
  $matched = $false
  $errorMessage = $_.Exception.Message
}
$sw.Stop()
$snippet = if ($body.Length -gt ${SNIPPET_LIMIT}) { $body.Substring(0, ${SNIPPET_LIMIT}) } else { $body }
$result = [ordered]@{
  statusCode = $statusCode
  latencyMs = [int]$sw.ElapsedMilliseconds
  matched = [bool]$matched
  responseSnippet = ($snippet -replace [char]0, '')
  errorMessage = $errorMessage
}
$result | ConvertTo-Json -Compress
`
}

function parseProbeOutput(result: RemoteCommandResult): HttpProbeResult {
  const line = result.stdout.split(/\r?\n/).map((item) => item.trim()).reverse().find((item) => item.startsWith('{') && item.endsWith('}'))
  if (!line) {
    const message = result.stderr || result.summary || '远程 URL 探测未返回结果'
    return { latencyMs: 0, matched: false, responseSnippet: '', errorMessage: message }
  }
  try {
    const parsed = JSON.parse(line) as Partial<HttpProbeResult>
    return {
      statusCode: typeof parsed.statusCode === 'number' ? parsed.statusCode : undefined,
      latencyMs: typeof parsed.latencyMs === 'number' ? parsed.latencyMs : 0,
      matched: Boolean(parsed.matched),
      responseSnippet: typeof parsed.responseSnippet === 'string' ? parsed.responseSnippet.slice(0, SNIPPET_LIMIT) : '',
      errorMessage: typeof parsed.errorMessage === 'string' && parsed.errorMessage ? parsed.errorMessage : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { latencyMs: 0, matched: false, responseSnippet: '', errorMessage: `远程 URL 探测结果解析失败：${message}` }
  }
}

export async function probeHttpFromHost(connection: RemoteConnectionInput, input: HttpProbeInput): Promise<HttpProbeResult> {
  const timeoutMs = Math.min(120000, Math.max(input.timeoutMs + 10000, 15000))
  const nextConnection = { ...connection, timeoutMs }
  const encoded = payload(input)
  const result = connection.os === 'Windows'
    ? await runWinrmCommand(nextConnection, windowsScript(encoded))
    : await runSshCommand(nextConnection, linuxCommand(encoded))
  const parsed = parseProbeOutput(result)
  if (!result.success && !parsed.errorMessage) return { ...parsed, errorMessage: result.stderr || result.summary }
  return parsed
}
