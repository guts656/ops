const shanghaiFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, hourCycle: 'h23' });
function shanghaiParts(date) {
    return Object.fromEntries(shanghaiFormatter.formatToParts(date).map((part) => [part.type, part.value]));
}
function shanghaiTime(date) {
    const parts = shanghaiParts(date);
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function shanghaiDate(date) {
    const parts = shanghaiParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
}
function simpleHash(input) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}
export function buildHostAuditHashChain(logs) {
    return logs.map((log, index) => {
        const previousHash = index === 0 ? 'HOST-GENESIS-2026' : simpleHash(JSON.stringify(logs[index - 1]));
        const hash = simpleHash(`${previousHash}:${JSON.stringify(log)}`);
        return { ...log, previousHash, hash };
    });
}
export function createHostAudit(operator, action, target, result = '成功', detail = '') {
    const retention = new Date();
    retention.setFullYear(retention.getFullYear() + 7);
    return {
        id: `HAUD-${Date.now()}`,
        time: shanghaiTime(new Date()),
        operator,
        action,
        target,
        result,
        detail,
        retentionUntil: shanghaiDate(retention),
    };
}
