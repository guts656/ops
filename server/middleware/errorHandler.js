import { ZodError } from 'zod';
export function errorHandler(error, _req, res, _next) {
    if (error instanceof ZodError) {
        return res.status(400).json({ message: '请求参数不正确', issues: error.issues });
    }
    const message = error instanceof Error ? error.message : '服务器内部错误';
    const status = ['用户名已存在', '未知角色', '包含未知权限', '不能禁用或删除最后一个启用的管理员', '不能禁用当前登录账号', '不能删除当前登录账号'].includes(message) ? 400 : 500;
    return res.status(status).json({ message });
}
