import type { AgentBackendCandidateResult, AgentInstallOptions, AgentOperationResult, RemoteCommandResult, RemoteConnectionInput, RemoteMetricsResult } from './types'
import { runSshCommand, testSshConnection } from './ssh.ts'
import { runWinrmCommand, testWinrmConnection } from './winrm.ts'

export const AGENT_VERSION = 'v2.10.3'

function toOperationResult(result: RemoteCommandResult): AgentOperationResult {
  return { ...result, status: result.success ? 'success' : 'failed' }
}

function shSingle(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function psSingle(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function linuxInstallCommand(hostIp: string, options: AgentInstallOptions) {
  const info = JSON.stringify({ version: AGENT_VERSION, hostIp, hostId: options.hostId, installedBy: 'ops-platform' })
  return `set -e
if [ "$(id -u)" -ne 0 ]; then echo "需要 root 权限安装 Agent" >&2; exit 10; fi
mkdir -p /opt/ops-platform-agent
printf '%s\n' ${shSingle(info)} > /opt/ops-platform-agent/agent-info.json
cat >/opt/ops-platform-agent/agent.env <<'ENV'
HOST_ID=${options.hostId}
AGENT_VERSION=${AGENT_VERSION}
AGENT_TOKEN=${options.agentToken}
API_BASE_URL=${options.apiBaseUrl.replace(/\/$/, '')}
INTERVAL_SECONDS=${options.intervalSeconds}
ENV
chown root:root /opt/ops-platform-agent/agent.env
chmod 600 /opt/ops-platform-agent/agent.env
cat >/usr/local/bin/ops-platform-agent <<'PY'
#!/usr/bin/env python3
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = Path('/opt/ops-platform-agent')
ENV_FILE = BASE / 'agent.env'
STATE_FILE = BASE / 'state.json'
LOG_CANDIDATES = [Path('/var/log/syslog'), Path('/var/log/messages')]

def load_env():
    values = {}
    for line in ENV_FILE.read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            values[key] = value
    return values

ENV = load_env()
HOST_ID = ENV['HOST_ID']
AGENT_TOKEN = ENV['AGENT_TOKEN']
API_BASE_URL = ENV['API_BASE_URL'].rstrip('/')
INTERVAL_SECONDS = int(ENV.get('INTERVAL_SECONDS') or '60')
HEADERS = {'Authorization': 'Bearer ' + AGENT_TOKEN, 'Content-Type': 'application/json'}
LOG_BATCH_SIZE = 100
MAX_FILE_LINES_PER_RUN = 500
MAX_CONFIGURED_FILES = 50
MAX_CONTAINERS_PER_RUN = 50
MAX_INITIAL_CONTAINER_LINES = 500
MAX_CONTAINER_LINES_PER_RUN = 1000

def now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

def parse_docker_time(value):
    if not value:
        return now_iso()
    raw = str(value).replace('Z', '+00:00')
    if '.' in raw:
        head, tail = raw.split('.', 1)
        offset = ''
        if '+' in tail:
            fraction, offset = tail.split('+', 1)
            offset = '+' + offset
        elif '-' in tail:
            fraction, offset = tail.split('-', 1)
            offset = '-' + offset
        else:
            fraction = tail
        raw = head + '.' + fraction[:6] + offset
    try:
        return datetime.fromisoformat(raw).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except Exception:
        return now_iso()

def compact_text(value, max_length=2000):
    text = str(value or '').strip()
    return text[:max_length]

def load_state():
    if not STATE_FILE.exists():
        return {'offsets': {}, 'failed_services': []}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {'offsets': {}, 'failed_services': []}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state), encoding='utf-8')
    os.chmod(STATE_FILE, 0o600)

def post(path, payload):
    data = json.dumps(compact_payload(payload), ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(API_BASE_URL + path, data=data, headers=HEADERS, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')
        raise RuntimeError('HTTP ' + str(exc.code) + ' ' + detail)

def post_log_batches(logs):
    for index in range(0, len(logs), LOG_BATCH_SIZE):
        post('/api/agent/hosts/' + HOST_ID + '/logs', {'logs': logs[index:index + LOG_BATCH_SIZE]})

def get_json(path):
    req = urllib.request.Request(API_BASE_URL + path, headers=HEADERS, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8') or '{}')
    except Exception:
        return {}

def run(command):
    return subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False).stdout

def run_combined(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
    return result.stdout or ''

def run_json_lines(command):
    items = []
    for line in run(command).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except Exception:
            continue
    return items

def parse_percent(value):
    if value is None:
        return None
    match = re.search(r'([0-9.]+)', str(value))
    if not match:
        return None
    return max(0, min(100, int(round(float(match.group(1))))))

def parse_bytes(value):
    if value is None:
        return None
    raw = str(value).strip().replace(',', '')
    match = re.search(r'([0-9.]+)\s*([KMGTPE]?i?B|B)?', raw, re.IGNORECASE)
    if not match:
        return None
    number = float(match.group(1))
    unit = (match.group(2) or 'B').lower()
    multipliers = {'b': 1, 'kb': 1000, 'kib': 1024, 'mb': 1000 ** 2, 'mib': 1024 ** 2, 'gb': 1000 ** 3, 'gib': 1024 ** 3, 'tb': 1000 ** 4, 'tib': 1024 ** 4}
    return int(number * multipliers.get(unit, 1))

def split_pair(value):
    parts = [part.strip() for part in str(value or '').split('/')]
    return parts[0] if parts else '', parts[1] if len(parts) > 1 else ''

def compact_payload(value):
    if isinstance(value, dict):
        return {key: compact_payload(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [compact_payload(item) for item in value]
    return value

def log_file():
    for candidate in LOG_CANDIDATES:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None

def log_level(message, default=None):
    if re.search(r'error|exception|failed|fatal|panic', message, re.IGNORECASE):
        return 'ERROR'
    if re.search(r'warn|warning', message, re.IGNORECASE):
        return 'WARN'
    if re.search(r'info|notice', message, re.IGNORECASE):
        return 'INFO'
    return default

def expand_date_template(value):
    try:
        return datetime.now().strftime(str(value))
    except Exception:
        return str(value)

def read_file_log(path, state, service_name=None, system_only=False, default_level=None):
    if not path or not path.exists() or not path.is_file():
        return []
    offsets = state.setdefault('offsets', {})
    key = str(path)
    offset = int(offsets.get(key) or 0)
    size = path.stat().st_size
    if offset > size:
        offset = 0
    logs = []
    lines_read = 0
    with path.open('r', errors='replace') as handle:
        handle.seek(offset)
        while lines_read < MAX_FILE_LINES_PER_RUN:
            line_start = handle.tell()
            line = handle.readline()
            if not line:
                break
            lines_read += 1
            message = line.strip()
            if not message:
                offsets[key] = handle.tell()
                continue
            level = log_level(message, default_level)
            if level and (not system_only or level == 'ERROR'):
                trace_basis = key + ':' + str(line_start) + ':' + message
                trace = hashlib.sha1(trace_basis.encode('utf-8', errors='replace')).hexdigest()[:16]
                logs.append({'timestamp': now_iso(), 'service': service_name or path.name or 'system', 'level': level, 'message': compact_text(message), 'source': key, 'traceId': 'file:' + trace, 'labels': {'logPath': key, 'offset': line_start}})
            offsets[key] = handle.tell()
    return logs

def read_configured_logs(state):
    paths = get_json('/api/agent/hosts/' + HOST_ID + '/log-config').get('paths') or []
    logs = []
    for value in paths[:20]:
        base = Path(expand_date_template(value))
        if base.is_file():
            logs.extend(read_file_log(base, state, default_level='INFO'))
        elif base.is_dir():
            for child in sorted(base.glob('*.log'))[:MAX_CONFIGURED_FILES]:
                logs.extend(read_file_log(child, state, base.name + '/' + child.name, default_level='INFO'))
    return logs

def read_logs(state):
    path = log_file()
    return read_file_log(path, state, 'system', True) if path else []

def docker_stats_by_name():
    stats = {}
    for item in run_json_lines(['docker', 'stats', '--no-stream', '--format', '{{json .}}']):
        name = item.get('Name') or item.get('Container')
        if name:
            stats[name.lstrip('/')] = item
    return stats

def docker_inspect_by_id(container_ids):
    if not container_ids:
        return {}
    output = run(['docker', 'inspect', *container_ids[:300]])
    try:
        items = json.loads(output or '[]')
    except Exception:
        return {}
    return {item.get('Id', '')[:12]: item for item in items if item.get('Id')}

def read_container_logs(containers, state):
    if not containers:
        return []
    checkpoints = state.setdefault('container_log_timestamps', {})
    logs = []
    for container in containers[:MAX_CONTAINERS_PER_RUN]:
        container_id = container.get('containerId') or ''
        name = container.get('name') or container_id[:12]
        checkpoint_key = container_id or name
        since = checkpoints.get(checkpoint_key) or checkpoints.get(name)
        command = ['docker', 'logs', '--timestamps']
        if since:
            command.extend(['--since', since])
        else:
            command.extend(['--tail', str(MAX_INITIAL_CONTAINER_LINES)])
        command.append(container_id or name)
        latest = since
        for line in run_combined(command).splitlines()[:MAX_CONTAINER_LINES_PER_RUN]:
            raw = line.strip()
            if not raw:
                continue
            parts = raw.split(None, 1)
            raw_timestamp = parts[0] if parts else ''
            timestamp = parse_docker_time(raw_timestamp)
            message = parts[1] if len(parts) > 1 else raw
            if raw_timestamp:
                latest = raw_timestamp
            level = log_level(message, 'INFO')
            trace_hash = hashlib.sha1(raw.encode('utf-8', errors='replace')).hexdigest()[:16]
            logs.append({'timestamp': timestamp, 'service': 'container:' + name, 'level': level, 'message': compact_text(message), 'source': 'docker', 'traceId': 'docker:' + (container_id[:12] or name) + ':' + (raw_timestamp or timestamp) + ':' + trace_hash, 'labels': {'containerId': container_id[:12], 'containerName': name, 'image': container.get('image')}})
        if latest:
            checkpoints[checkpoint_key] = latest
    return logs

def discover_containers():
    if not shutil.which('docker'):
        return []
    rows = run_json_lines(['docker', 'ps', '-a', '--no-trunc', '--format', '{{json .}}'])[:300]
    if not rows:
        return []
    inspect = docker_inspect_by_id([row.get('ID') for row in rows if row.get('ID')])
    stats = docker_stats_by_name()
    containers = []
    for row in rows:
        container_id = row.get('ID') or row.get('ContainerID') or ''
        if not container_id:
            continue
        name = (row.get('Names') or row.get('Name') or container_id[:12]).lstrip('/')
        detail = inspect.get(container_id[:12]) or {}
        state = detail.get('State') or {}
        container_state = (row.get('State') or state.get('Status') or 'unknown').lower()
        stat = stats.get(name) or stats.get(container_id[:12]) or {}
        mem_used, mem_limit = split_pair(stat.get('MemUsage'))
        net_rx, net_tx = split_pair(stat.get('NetIO'))
        block_read, block_write = split_pair(stat.get('BlockIO'))
        containers.append({
            'containerId': container_id,
            'name': name,
            'image': row.get('Image') or detail.get('Config', {}).get('Image') or '-',
            'status': row.get('Status') or state.get('Status') or 'unknown',
            'state': container_state,
            'restartCount': int(detail.get('RestartCount') or 0),
            'ports': row.get('Ports') or None,
            'cpuPercent': parse_percent(stat.get('CPUPerc')),
            'memoryUsageBytes': parse_bytes(mem_used),
            'memoryLimitBytes': parse_bytes(mem_limit),
            'memoryPercent': parse_percent(stat.get('MemPerc')),
            'networkRxBytes': parse_bytes(net_rx),
            'networkTxBytes': parse_bytes(net_tx),
            'blockReadBytes': parse_bytes(block_read),
            'blockWriteBytes': parse_bytes(block_write),
            'labels': detail.get('Config', {}).get('Labels') or {},
            'startedAt': state.get('StartedAt') if state.get('StartedAt') and not state.get('StartedAt').startswith('0001-') else None,
            'lastReportedAt': now_iso(),
        })
    return containers

def collect_once():
    state = load_state()
    try:
        containers = discover_containers()
        if containers:
            post('/api/agent/hosts/' + HOST_ID + '/containers', {'containers': containers})
        logs = read_logs(state) + read_configured_logs(state) + read_container_logs(containers, state)
        if logs:
            post_log_batches(logs)
        save_state(state)
        (BASE / 'heartbeat').write_text(time.strftime('%Y-%m-%d %H:%M:%S'), encoding='utf-8')
    except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as exc:
        print('agent upload failed: ' + str(exc), file=sys.stderr)

if len(sys.argv) > 1 and sys.argv[1] == 'once':
    collect_once()
else:
    while True:
        collect_once()
        time.sleep(INTERVAL_SECONDS)
PY
chmod +x /usr/local/bin/ops-platform-agent
/usr/local/bin/ops-platform-agent once || true
cat >/etc/systemd/system/ops-platform-agent.service <<'UNIT'
[Unit]
Description=Ops Platform Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ops-platform-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable ops-platform-agent
systemctl restart ops-platform-agent
systemctl is-active --quiet ops-platform-agent
test -x /usr/local/bin/ops-platform-agent
unit_exec=$(systemctl cat ops-platform-agent | sed -n 's/^ExecStart=//p' | tail -n 1)
if [ "$unit_exec" != "/usr/local/bin/ops-platform-agent" ]; then echo "Agent unit ExecStart 校验失败：$unit_exec" >&2; exit 20; fi
installed_version=$(python3 - <<'PYV'
import json
print(json.load(open('/opt/ops-platform-agent/agent-info.json')).get('version', ''))
PYV
)
if [ "$installed_version" != "${AGENT_VERSION}" ]; then echo "Agent 版本校验失败：$installed_version" >&2; exit 21; fi
printf 'Ops Platform Agent %s installed\nExecStart=%s\nScript=/usr/local/bin/ops-platform-agent\nConfig=/opt/ops-platform-agent/agent.env\n' "$installed_version" "$unit_exec"`
}

const linuxRestartCommand = `set -e
if [ "$(id -u)" -ne 0 ]; then echo "需要 root 权限重启 Agent" >&2; exit 10; fi
systemctl restart ops-platform-agent
systemctl is-active --quiet ops-platform-agent
date '+%Y-%m-%d %H:%M:%S' > /opt/ops-platform-agent/heartbeat
echo "Ops Platform Agent restarted"`

function backendDiagnosticCommand(baseUrls: string[]) {
  const urls = baseUrls.map((url) => shSingle(url)).join(' ')
  return `for base_url in ${urls}; do
  health_url="\${base_url%/}/api/health"
  output=$(curl -sS --connect-timeout 3 --max-time 6 -w '\\nHTTP_CODE=%{http_code}' "$health_url" 2>&1)
  exit_code=$?
  http_code=$(printf '%s' "$output" | sed -n 's/^HTTP_CODE=//p' | tail -n 1)
  body=$(printf '%s' "$output" | sed '/^HTTP_CODE=/d' | tr '\\n' ' ' | cut -c 1-240)
  reachable=false
  if [ "$exit_code" -eq 0 ] && [ "$http_code" = "200" ]; then reachable=true; fi
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$base_url" "$reachable" "\${http_code:-0}" "$exit_code" "$body"
done`
}

function backendRouteRepairCommand(baseUrls: string[]) {
  const hosts = baseUrls.map((url) => shSingle(new URL(url).hostname)).join(' ')
  const firstHost = shSingle(new URL(baseUrls[0]).hostname)
  return `set -e
if [ "$(id -u)" -ne 0 ]; then echo "需要 root 权限修复 Agent 回连路由" >&2; exit 10; fi
route_line=$(ip route show default | head -n 1)
gateway=$(printf '%s' "$route_line" | awk '{ for (i=1; i<=NF; i++) if ($i == "via") print $(i+1) }')
device=$(printf '%s' "$route_line" | awk '{ for (i=1; i<=NF; i++) if ($i == "dev") print $(i+1) }')
if [ -z "$gateway" ] || [ -z "$device" ]; then echo "未找到默认网关或网卡：$route_line" >&2; exit 2; fi
for host in ${hosts}; do
  ip route replace "$host/32" via "$gateway" dev "$device"
done
ip route get ${firstHost} || true`
}

function parseDiagnosticOutput(stdout: string): AgentBackendCandidateResult[] {
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [baseUrl, reachable, httpCode, exitCode, ...message] = line.split('\t')
    return {
      baseUrl,
      reachable: reachable === 'true',
      httpCode: Number(httpCode || 0),
      exitCode: Number(exitCode || 0),
      message: message.join(' ').slice(0, 240),
    }
  })
}

const linuxMetricsCommand = `read_cpu() {
  awk '/^cpu / { total=0; for (i=2; i<=NF; i++) total += $i; idle=$5 + $6; print total " " idle }' /proc/stat
}
cpu_percent() {
  first=$(read_cpu)
  sleep 1
  second=$(read_cpu)
  total1=$(printf '%s' "$first" | awk '{print $1}')
  idle1=$(printf '%s' "$first" | awk '{print $2}')
  total2=$(printf '%s' "$second" | awk '{print $1}')
  idle2=$(printf '%s' "$second" | awk '{print $2}')
  awk -v total1="$total1" -v idle1="$idle1" -v total2="$total2" -v idle2="$idle2" 'BEGIN { total=total2-total1; idle=idle2-idle1; if (total <= 0) print 0; else printf "%.0f", ((total-idle)/total)*100 }'
}
memory_percent() {
  awk '/^MemTotal:/ { total=$2 } /^MemAvailable:/ { available=$2 } END { if (total <= 0) print 0; else printf "%.0f", ((total-available)/total)*100 }' /proc/meminfo
}
disk_percent() {
  df -P / | awk 'NR==2 { gsub(/%/, "", $5); print $5 }'
}
os_version() {
  if [ -r /etc/os-release ]; then
    . /etc/os-release
    printf '%s' "\${PRETTY_NAME:-Linux}"
  else
    uname -sr
  fi
}
uptime_seconds() {
  awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0
}
printf 'CPU=%s\nMEMORY=%s\nDISK=%s\nHOSTNAME=%s\nOS_VERSION=%s\nUPTIME_SECONDS=%s\n' "$(cpu_percent)" "$(memory_percent)" "$(disk_percent)" "$(hostname)" "$(os_version)" "$(uptime_seconds)"`

const windowsMetricsCommand = `
$cpuSamples = Get-CimInstance Win32_Processor | Where-Object { $null -ne $_.LoadPercentage }
$cpu = if ($cpuSamples) { [math]::Round(($cpuSamples | Measure-Object -Property LoadPercentage -Average).Average) } else { 0 }
$os = Get-CimInstance Win32_OperatingSystem
$totalMemory = [double]$os.TotalVisibleMemorySize
$freeMemory = [double]$os.FreePhysicalMemory
$memory = if ($totalMemory -gt 0) { [math]::Round((($totalMemory - $freeMemory) / $totalMemory) * 100) } else { 0 }
$systemDrive = if ($env:SystemDrive) { $env:SystemDrive } else { 'C:' }
$diskInfo = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$systemDrive'"
$disk = if ($diskInfo -and $diskInfo.Size -gt 0) { [math]::Round((($diskInfo.Size - $diskInfo.FreeSpace) / $diskInfo.Size) * 100) } else { 0 }
$eventBoot = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 6005 } -MaxEvents 1 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty TimeCreated
$bootTime = if ($eventBoot -and (!$os.LastBootUpTime -or $eventBoot -gt $os.LastBootUpTime)) { $eventBoot } else { $os.LastBootUpTime }
$uptime = if ($bootTime) { [math]::Max(0, [int]((Get-Date) - $bootTime).TotalSeconds) } else { 0 }
Write-Output "CPU=$cpu"
Write-Output "MEMORY=$memory"
Write-Output "DISK=$disk"
Write-Output "HOSTNAME=$env:COMPUTERNAME"
Write-Output "OS_VERSION=$($os.Caption) $($os.Version)"
Write-Output "UPTIME_SECONDS=$uptime"
`

function parseMetricsOutput(result: RemoteCommandResult): RemoteMetricsResult {
  const values = Object.fromEntries(result.stdout.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const index = line.indexOf('=')
    return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)]
  }))
  return {
    ...result,
    cpu: Number(values.CPU),
    memory: Number(values.MEMORY),
    disk: Number(values.DISK),
    hostname: values.HOSTNAME,
    osVersion: values.OS_VERSION,
    uptimeSeconds: values.UPTIME_SECONDS && Number.isFinite(Number(values.UPTIME_SECONDS)) ? Number(values.UPTIME_SECONDS) : undefined,
  }
}

function windowsInstallScript(hostIp: string, options: AgentInstallOptions) {
  const info = JSON.stringify({ version: AGENT_VERSION, hostIp, hostId: options.hostId, installedBy: 'ops-platform' })
  const config = JSON.stringify({ hostId: options.hostId, agentVersion: AGENT_VERSION, agentToken: options.agentToken, apiBaseUrl: options.apiBaseUrl.replace(/\/$/, ''), intervalSeconds: options.intervalSeconds })
  return `
    $base = 'C:\\ProgramData\\OpsPlatformAgent'
    New-Item -ItemType Directory -Force -Path $base | Out-Null
    ${psSingle(info)} | Set-Content -Encoding UTF8 -Path (Join-Path $base 'agent-info.json')
    ${psSingle(config)} | Set-Content -Encoding UTF8 -Path (Join-Path $base 'agent-config.json')
    @'
$ErrorActionPreference = 'Continue'
$base = 'C:/ProgramData/OpsPlatformAgent'
$configPath = Join-Path $base 'agent-config.json'
$statePath = Join-Path $base 'state.json'
$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($config.agentToken)"; 'Content-Type' = 'application/json; charset=utf-8' }

function NowIso { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
function Load-State {
  if (Test-Path -LiteralPath $statePath) {
    try { return Get-Content -Raw -Path $statePath | ConvertFrom-Json } catch {}
  }
  return [pscustomobject]@{ failedServices = @(); eventRecordIds = @{} }
}
function Save-State($state) { $state | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path $statePath }
function Compact-Text($value, $max) {
  if ($null -eq $value) { return '' }
  $text = [string]$value
  if ($text.Length -gt $max) { return $text.Substring(0, $max) }
  return $text
}
function Get-Sha1Hex($text) {
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$text)
    $hashBytes = $sha1.ComputeHash($bytes)
    return (-join ($hashBytes | ForEach-Object { $_.ToString('x2') }))
  } finally {
    $sha1.Dispose()
  }
}
function Post-Json($path, $payload) {
  $json = $payload | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Method Post -Uri "$($config.apiBaseUrl)$path" -Headers $headers -Body $json -TimeoutSec 10 | Out-Null
}
function Post-LogBatches($logs) {
  $items = @($logs)
  for ($index = 0; $index -lt $items.Count; $index += 100) {
    $end = [Math]::Min($index + 99, $items.Count - 1)
    Post-Json "/api/agent/hosts/$($config.hostId)/logs" @{ logs = @($items[$index..$end]) }
  }
}
function Get-Json($path) {
  try { return Invoke-RestMethod -Method Get -Uri "$($config.apiBaseUrl)$path" -Headers $headers -TimeoutSec 10 } catch { return $null }
}
function Collect-Metrics {
  $cpuSamples = Get-CimInstance Win32_Processor | Where-Object { $null -ne $_.LoadPercentage }
  $cpu = if ($cpuSamples) { [math]::Round(($cpuSamples | Measure-Object -Property LoadPercentage -Average).Average) } else { 0 }
  $os = Get-CimInstance Win32_OperatingSystem
  $totalMemory = [double]$os.TotalVisibleMemorySize
  $freeMemory = [double]$os.FreePhysicalMemory
  $memory = if ($totalMemory -gt 0) { [math]::Round((($totalMemory - $freeMemory) / $totalMemory) * 100) } else { 0 }
  $systemDrive = if ($env:SystemDrive) { $env:SystemDrive } else { 'C:' }
  $diskInfo = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$systemDrive'"
  $disk = if ($diskInfo -and $diskInfo.Size -gt 0) { [math]::Round((($diskInfo.Size - $diskInfo.FreeSpace) / $diskInfo.Size) * 100) } else { 0 }
  $eventBoot = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 6005 } -MaxEvents 1 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty TimeCreated
  $bootTime = if ($eventBoot -and (!$os.LastBootUpTime -or $eventBoot -gt $os.LastBootUpTime)) { $eventBoot } else { $os.LastBootUpTime }
  $uptime = if ($bootTime) { [math]::Max(0, [int]((Get-Date) - $bootTime).TotalSeconds) } else { 0 }
  @{ cpu = $cpu; memory = $memory; disk = $disk; hostname = $env:COMPUTERNAME; osVersion = "$($os.Caption) $($os.Version)"; uptimeSeconds = $uptime; sampledAt = NowIso }
}
function Get-ServiceExecutablePath($pathName) {
  if ([string]::IsNullOrWhiteSpace($pathName)) { return '' }
  $expanded = [Environment]::ExpandEnvironmentVariables([string]$pathName).Trim()
  if ($expanded.StartsWith('"')) {
    $endQuote = $expanded.IndexOf('"', 1)
    if ($endQuote -gt 1) { return $expanded.Substring(1, $endQuote - 1) }
  }
  $lower = $expanded.ToLowerInvariant()
  $exeIndex = $lower.IndexOf('.exe')
  if ($exeIndex -ge 0) { return $expanded.Substring(0, $exeIndex + 4) }
  return ($expanded -split ' ')[0]
}
function Is-SystemService($service) {
  $pathName = [string]$service.PathName
  if ([string]::IsNullOrWhiteSpace($pathName)) { return $true }
  $normalizedPathName = $pathName.ToLowerInvariant().Replace('/', '\')
  if ($normalizedPathName.StartsWith('\systemroot\') -or $normalizedPathName.StartsWith('%systemroot%\')) { return $true }
  $exePath = (Get-ServiceExecutablePath $pathName).ToLowerInvariant().Replace('/', '\')
  $windowsDir = [Environment]::GetFolderPath('Windows').ToLowerInvariant().Replace('/', '\')
  $programFiles = [Environment]::GetFolderPath('ProgramFiles').ToLowerInvariant().Replace('/', '\')
  $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86').ToLowerInvariant().Replace('/', '\')
  return $exePath.StartsWith($windowsDir + '\') -or $exePath.StartsWith($programFiles + '\windows defender\') -or $exePath.StartsWith($programFilesX86 + '\windows defender\')
}
function Collect-Services {
  Get-CimInstance Win32_Service | Where-Object { -not (Is-SystemService $_) } | Select-Object -First 200 | ForEach-Object {
    @{ name = $_.Name; status = $_.State; pid = [int]$_.ProcessId; source = 'windows-service'; metadata = @{ displayName = $_.DisplayName; startMode = $_.StartMode; path = (Get-ServiceExecutablePath $_.PathName) }; lastReportedAt = NowIso }
  }
}
function Collect-ServiceEvents($state, $services) {
  $running = @($services | Where-Object { $_.status -eq 'Running' } | ForEach-Object { $_.name })
  $failed = @($services | Where-Object { $_.status -ne 'Running' } | ForEach-Object { $_.name })
  $previousRunning = @($state.runningServices)
  $state.runningServices = $running
  $state.failedServices = $failed
  $failed | Where-Object { $previousRunning -contains $_ } | ForEach-Object {
    @{ service = $_; eventType = 'service_not_running'; level = 'ERROR'; message = "$($_) is not running"; source = 'windows-service'; occurredAt = NowIso }
  }
}
function Get-LogLevel($line) {
  if ($line -match '(?i)error|exception|failed|fatal|panic|错误|异常|失败') { return 'ERROR' }
  if ($line -match '(?i)warn|warning|警告|告警') { return 'WARN' }
  if ($line -match '(?i)info|notice|成功|启动|连接') { return 'INFO' }
  return 'INFO'
}
function Expand-DateTemplate($value) {
  $text = [string]$value
  $now = Get-Date
  $text = $text.Replace('%Y', $now.ToString('yyyy'))
  $text = $text.Replace('%m', $now.ToString('MM'))
  $text = $text.Replace('%d', $now.ToString('dd'))
  return $text
}
function Get-TodayLogNamePatterns {
  $now = Get-Date
  @(
    $now.ToString('yyyyMMdd'),
    $now.ToString('yyyy-MM-dd'),
    $now.ToString('yyyy_MM_dd')
  )
}
function Is-TodayLogFile($item) {
  if ($item.Extension -notin @('.log', '.txt')) { return $false }
  $name = [string]$item.Name
  foreach ($pattern in Get-TodayLogNamePatterns) {
    if ($name.Contains($pattern)) { return $true }
  }
  return $false
}
function Get-ConfiguredLogFiles($pathValue) {
  $pathValue = Expand-DateTemplate $pathValue
  if (Test-Path -LiteralPath $pathValue -PathType Leaf) {
    return @(Get-Item -LiteralPath $pathValue -ErrorAction SilentlyContinue)
  }
  if (-not (Test-Path -LiteralPath $pathValue -PathType Container)) { return @() }
  return @(Get-ChildItem -LiteralPath $pathValue -File -Recurse -ErrorAction SilentlyContinue | Where-Object { Is-TodayLogFile $_ } | Sort-Object LastWriteTime -Descending | Select-Object -First 200)
}
function Trim-TrailingCr($buffer) {
  if ($buffer.Length -gt 0 -and $buffer[$buffer.Length - 1] -eq 13) {
    if ($buffer.Length -eq 1) { return @() }
    return $buffer[0..($buffer.Length - 2)]
  }
  return $buffer
}
function Read-ConfiguredLogFile($pathKey, $last, $maxLines) {
  $lines = @()
  $position = $last
  $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  try {
    $stream = [System.IO.File]::Open($pathKey, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
      if ($last -gt $stream.Length) { $last = 0 }
      $stream.Seek($last, [System.IO.SeekOrigin]::Begin) | Out-Null
      $position = $stream.Position
      $bytes = New-Object 'System.Collections.Generic.List[byte]'
      $lineStart = $stream.Position
      while ($stream.Position -lt $stream.Length -and $lines.Count -lt $maxLines) {
        $value = $stream.ReadByte()
        if ($value -lt 0) { break }
        if ($value -eq 10) {
          $nextOffset = $stream.Position
          $buffer = Trim-TrailingCr $bytes.ToArray()
          $line = [Text.Encoding]::UTF8.GetString([byte[]]$buffer)
          if (-not [string]::IsNullOrWhiteSpace($line)) { $lines += [pscustomobject]@{ Offset = $lineStart; Text = $line; NextOffset = $nextOffset } }
          $bytes.Clear()
          $lineStart = $stream.Position
          $position = $nextOffset
        } else {
          $bytes.Add([byte]$value)
        }
      }
      if ($bytes.Count -gt 0 -and $stream.Position -eq $stream.Length -and $lines.Count -lt $maxLines) {
        $buffer = Trim-TrailingCr $bytes.ToArray()
        $line = [Text.Encoding]::UTF8.GetString([byte[]]$buffer)
        $nextOffset = $stream.Position
        if (-not [string]::IsNullOrWhiteSpace($line)) { $lines += [pscustomobject]@{ Offset = $lineStart; Text = $line; NextOffset = $nextOffset } }
        $position = $nextOffset
      }
    } finally {
      $stream.Close()
    }
  } catch {
    $lines = @(Get-Content -LiteralPath $pathKey -Tail 80 -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Offset = 0; Text = $_; NextOffset = $null } })
    $item = Get-Item -LiteralPath $pathKey -ErrorAction SilentlyContinue
    if ($item) { $position = $item.Length }
  }
  [pscustomobject]@{ Lines = @($lines); Position = $position }
}
function Collect-ConfiguredLogs($state) {
  $logs = @()
  $configResponse = Get-Json "/api/agent/hosts/$($config.hostId)/log-config"
  $paths = if ($configResponse -and $configResponse.paths) { @($configResponse.paths) } else { @() }
  if (-not $state.fileLogOffsets) { $state | Add-Member -NotePropertyName fileLogOffsets -NotePropertyValue ([pscustomobject]@{}) -Force }
  foreach ($pathValue in $paths | Select-Object -First 20) {
    $items = @(Get-ConfiguredLogFiles $pathValue)
    foreach ($item in $items) {
      $pathKey = $item.FullName
      $key = 'v3:' + $pathKey
      $last = 0
      if ($state.fileLogOffsets.PSObject.Properties[$key]) { $last = [int64]$state.fileLogOffsets.$key }
      if ($last -gt $item.Length) { $last = 0 }
      $result = Read-ConfiguredLogFile $pathKey $last 500
      foreach ($entry in @($result.Lines)) {
        $line = [string]$entry.Text
        $level = Get-LogLevel $line
        $hashInput = $key + ':' + $entry.Offset + ':' + $line
        $hash = (Get-Sha1Hex $hashInput).Substring(0, 16)
        $logs += @{ timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); service = $item.Name; level = $level; traceId = "file:$hash"; message = (Compact-Text $line 2000); source = $pathKey; labels = @{ logPath = $pathKey; offset = $entry.Offset } }
      }
      $state.fileLogOffsets | Add-Member -NotePropertyName $key -NotePropertyValue ([int64]$result.Position) -Force
    }
  }
  $logs
}
function Get-EventLogLevel($event) {
  switch ([int]$event.Level) {
    1 { return 'ERROR' }
    2 { return 'ERROR' }
    3 { return 'WARN' }
    4 { return 'INFO' }
    5 { return 'DEBUG' }
    default { return 'INFO' }
  }
}
function Collect-Logs($state) {
  $logs = @()
  foreach ($logName in @('System', 'Application')) {
    $events = @(Get-WinEvent -LogName $logName -MaxEvents 80 -ErrorAction SilentlyContinue | Sort-Object RecordId)
    $last = 0
    $maxRecordId = $last
    if ($state.eventRecordIds -and $state.eventRecordIds.PSObject.Properties[$logName]) { $last = [int64]$state.eventRecordIds.$logName; $maxRecordId = $last }
    foreach ($event in $events | Where-Object { $_.RecordId -gt $last }) {
      if ($event.RecordId -gt $maxRecordId) { $maxRecordId = $event.RecordId }
      $provider = if ($event.ProviderName) { $event.ProviderName } else { $logName }
      $level = Get-EventLogLevel $event
      $levelDisplayName = if ($event.LevelDisplayName) { $event.LevelDisplayName } else { $level }
      $logs += @{ timestamp = $event.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); service = $provider; level = $level; traceId = "eventlog:$($logName):$($event.RecordId)"; message = (Compact-Text $event.Message 2000); source = "eventlog:$logName"; labels = @{ recordId = $event.RecordId; eventId = $event.Id; provider = $provider; logName = $logName; level = $event.Level; levelDisplayName = $levelDisplayName; machineName = $event.MachineName } }
    }
    if (-not $state.eventRecordIds) { $state | Add-Member -NotePropertyName eventRecordIds -NotePropertyValue ([pscustomobject]@{}) -Force }
    $state.eventRecordIds | Add-Member -NotePropertyName $logName -NotePropertyValue $maxRecordId -Force
  }
  $logs | Select-Object -Last 100
}
function Collect-Once {
  $state = Load-State
  try {
    $metrics = Collect-Metrics
    Post-Json "/api/agent/hosts/$($config.hostId)/metrics" $metrics
    $services = @(Collect-Services)
    if ($services.Count -gt 0) { Post-Json "/api/agent/hosts/$($config.hostId)/services" @{ services = $services } }
    $events = @(Collect-ServiceEvents $state $services)
    if ($events.Count -gt 0) { Post-Json "/api/agent/hosts/$($config.hostId)/service-events" @{ events = $events } }
    $logs = @(Collect-Logs $state) + @(Collect-ConfiguredLogs $state)
    if ($logs.Count -gt 0) { Post-LogBatches $logs }
    Save-State $state
    Get-Date -Format 'yyyy-MM-dd HH:mm:ss' | Set-Content -Encoding UTF8 -Path (Join-Path $base 'heartbeat')
  } catch {
    Write-Output "agent upload skipped: $($_.Exception.Message)"
  }
}
if ($args.Count -gt 0 -and $args[0] -eq 'once') { Collect-Once } else { while ($true) { Collect-Once; Start-Sleep -Seconds ([int]$config.intervalSeconds) } }
'@ | Set-Content -Encoding UTF8 -Path (Join-Path $base 'ops-platform-agent.ps1')
    icacls $base /inheritance:r /grant 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\\ProgramData\\OpsPlatformAgent\\ops-platform-agent.ps1"'
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    Register-ScheduledTask -TaskName 'OpsPlatformAgent' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\ProgramData\\OpsPlatformAgent\\ops-platform-agent.ps1" once
    Start-ScheduledTask -TaskName 'OpsPlatformAgent'
    $task = Get-ScheduledTask -TaskName 'OpsPlatformAgent'
    if (-not $task) { throw '计划任务创建失败' }
    Write-Output 'Ops Platform Agent ${AGENT_VERSION} installed via ops-platform-agent.ps1'
  `
}

const windowsRestartScript = `
    $task = Get-ScheduledTask -TaskName 'OpsPlatformAgent' -ErrorAction Stop
    Stop-ScheduledTask -TaskName 'OpsPlatformAgent' -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName 'OpsPlatformAgent'
    Get-Date -Format 'yyyy-MM-dd HH:mm:ss' | Set-Content -Encoding UTF8 -Path 'C:\\ProgramData\\OpsPlatformAgent\\heartbeat'
    Write-Output 'Ops Platform Agent restarted'
`

export async function testRemoteConnection(input: RemoteConnectionInput) {
  return input.os === 'Windows' ? testWinrmConnection(input) : testSshConnection(input)
}

export async function installRemoteAgent(input: RemoteConnectionInput, options?: AgentInstallOptions) {
  if (!options) return toOperationResult({ success: false, stdout: '', stderr: '缺少 Agent 安装配置', summary: '缺少 Agent 安装配置' })
  const result = input.os === 'Windows'
    ? await runWinrmCommand(input, windowsInstallScript(input.host, options))
    : await runSshCommand(input, linuxInstallCommand(input.host, options))
  return toOperationResult({ ...result, summary: result.success ? 'Agent 安装成功' : result.summary })
}

function windowsBackendDiagnosticCommand(baseUrls: string[]) {
  const urls = baseUrls.map((url) => psSingle(url)).join(', ')
  return `
    foreach ($baseUrl in @(${urls})) {
      $healthUrl = $baseUrl.TrimEnd('/') + '/api/health'
      $reachable = 'false'
      $httpCode = 0
      $exitCode = 0
      $message = ''
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 6
        $httpCode = [int]$response.StatusCode
        $message = ($response.Content -replace "``r|``n", ' ')
        if ($httpCode -eq 200) { $reachable = 'true' }
      } catch {
        $exitCode = 1
        $message = $_.Exception.Message
        if ($_.Exception.Response) { $httpCode = [int]$_.Exception.Response.StatusCode }
      }
      if ($message.Length -gt 240) { $message = $message.Substring(0, 240) }
      Write-Output "$baseUrl``t$reachable``t$httpCode``t$exitCode``t$message"
    }
  `
}

export async function diagnoseRemoteAgentBackends(input: RemoteConnectionInput, baseUrls: string[]) {
  const result = input.os === 'Windows'
    ? await runWinrmCommand(input, windowsBackendDiagnosticCommand(baseUrls))
    : await runSshCommand(input, backendDiagnosticCommand(baseUrls))
  const candidates = result.success ? parseDiagnosticOutput(result.stdout) : []
  return { ...result, candidates, summary: result.success ? 'Agent 回连诊断完成' : result.summary }
}

export async function repairRemoteAgentBackendRoutes(input: RemoteConnectionInput, baseUrls: string[]) {
  return runSshCommand(input, backendRouteRepairCommand(baseUrls))
}

export async function collectRemoteMetrics(input: RemoteConnectionInput) {
  const result = input.os === 'Windows'
    ? await runWinrmCommand(input, windowsMetricsCommand)
    : await runSshCommand(input, linuxMetricsCommand)
  return parseMetricsOutput(result)
}

export async function restartRemoteAgent(input: RemoteConnectionInput) {
  const result = input.os === 'Windows'
    ? await runWinrmCommand(input, windowsRestartScript)
    : await runSshCommand(input, linuxRestartCommand)
  return toOperationResult({ ...result, summary: result.success ? 'Agent 重启成功' : result.summary })
}
