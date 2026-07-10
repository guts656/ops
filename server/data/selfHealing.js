import { prisma } from '../db/prisma';
function buildRuleConditionText(rule) {
    return rule.conditions
        .map((condition) => `${condition.service}.${condition.metric} ${condition.operator} ${condition.threshold}（${condition.windowValue}${condition.windowUnit}）`)
        .join(` ${rule.logic} `);
}
function nowText() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
}
function toRule(rule) {
    const value = {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        enabled: rule.enabled,
        triggerCount: rule.triggerCount,
        successRate: rule.successRate,
        lastExecutedAt: rule.lastExecutedAt,
        logic: rule.logic,
        conditions: rule.conditions,
        actions: rule.actions,
        notification: rule.notification,
    };
    return { ...value, conditionText: buildRuleConditionText(value) };
}
function toExecution(execution) {
    return {
        id: execution.id,
        ruleId: execution.ruleId,
        ruleName: execution.ruleName,
        service: execution.service,
        status: execution.status,
        triggeredAt: execution.triggeredAt,
        triggerValue: execution.triggerValue,
        duration: execution.duration,
        logs: execution.logs,
    };
}
function ruleData(values) {
    return {
        name: values.name,
        description: values.description ?? '',
        priority: values.priority,
        enabled: values.enabled ?? true,
        logic: values.logic,
        conditions: values.conditions,
        actions: values.actions,
        notification: values.notification,
    };
}
async function writeAudit(operator, action, target, detail) {
    await prisma.auditLog.create({ data: { operator, action, target, result: '成功', detail } });
}
export async function querySelfHealingRules() {
    const rules = await prisma.selfHealingRule.findMany({ orderBy: { createdAt: 'desc' } });
    return rules.map(toRule);
}
export async function getSelfHealingRule(id) {
    const rule = await prisma.selfHealingRule.findUnique({ where: { id } });
    return rule ? toRule(rule) : undefined;
}
export async function createSelfHealingRule(values, operator) {
    const rule = await prisma.selfHealingRule.create({
        data: {
            id: `heal-${Date.now().toString(36)}`,
            triggerCount: 0,
            successRate: 100,
            lastExecutedAt: '尚未执行',
            ...ruleData(values),
        },
    });
    await writeAudit(operator, '创建自愈规则', rule.name, `优先级 ${rule.priority}，动作数 ${toRule(rule).actions.length}`);
    return toRule(rule);
}
export async function updateSelfHealingRule(id, values, operator) {
    const current = await getSelfHealingRule(id);
    if (!current)
        return undefined;
    const rule = await prisma.selfHealingRule.update({ where: { id }, data: ruleData(values) });
    await writeAudit(operator, '编辑自愈规则', rule.name, `状态 ${rule.enabled ? '启用' : '停用'}，条件数 ${toRule(rule).conditions.length}`);
    return toRule(rule);
}
export async function setSelfHealingRuleEnabled(id, enabled, operator) {
    const current = await getSelfHealingRule(id);
    if (!current)
        return undefined;
    const rule = await prisma.selfHealingRule.update({ where: { id }, data: { enabled } });
    await writeAudit(operator, enabled ? '启用自愈规则' : '停用自愈规则', rule.name, `规则状态变更为${enabled ? '启用' : '停用'}`);
    return toRule(rule);
}
export async function copySelfHealingRule(id, operator) {
    const current = await getSelfHealingRule(id);
    if (!current)
        return undefined;
    const rule = await prisma.selfHealingRule.create({
        data: {
            id: `heal-copy-${Date.now().toString(36)}`,
            name: `${current.name} 副本`,
            description: current.description,
            priority: current.priority,
            enabled: false,
            triggerCount: 0,
            successRate: 100,
            lastExecutedAt: '尚未执行',
            logic: current.logic,
            conditions: current.conditions,
            actions: current.actions,
            notification: current.notification,
        },
    });
    await writeAudit(operator, '复制自愈规则', rule.name, `来源规则 ${current.name}`);
    return toRule(rule);
}
export async function deleteSelfHealingRule(id, operator) {
    const current = await getSelfHealingRule(id);
    if (!current)
        return undefined;
    await prisma.selfHealingRule.delete({ where: { id } });
    await writeAudit(operator, '删除自愈规则', current.name, '删除规则并级联删除执行历史');
    return current;
}
export async function querySelfHealingHistory(filters) {
    const history = await prisma.selfHealingExecution.findMany({
        where: { ruleId: filters.ruleId },
        orderBy: { createdAt: 'desc' },
    });
    return history.map(toExecution);
}
export async function createSelfHealingExecution(ruleId, status, triggerValue, logs, operator) {
    const rule = await getSelfHealingRule(ruleId);
    if (!rule)
        return undefined;
    const now = nowText();
    const service = rule.conditions[0]?.service ?? '-';
    const execution = await prisma.selfHealingExecution.create({
        data: {
            id: `exec-${Date.now().toString(36)}`,
            ruleId: rule.id,
            ruleName: rule.name,
            service,
            status,
            triggeredAt: now,
            triggerValue,
            duration: '0s',
            logs,
        },
    });
    const total = rule.triggerCount + 1;
    const successCount = Math.round((rule.triggerCount * rule.successRate) / 100) + (status === '成功' ? 1 : 0);
    await prisma.selfHealingRule.update({
        where: { id: rule.id },
        data: { triggerCount: total, successRate: Math.round((successCount / total) * 100), lastExecutedAt: now },
    });
    await writeAudit(operator, '记录自愈执行', rule.name, `执行结果 ${status}`);
    return toExecution(execution);
}
