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
        time: new Date().toLocaleString(),
        operator,
        action,
        target,
        result,
        detail,
        retentionUntil: retention.toISOString().slice(0, 10),
    };
}
