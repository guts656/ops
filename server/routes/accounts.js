import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '../config/permissions';
import { createUser, deleteUser, getAccountMetadata, listUsers, resetUserPassword, setUserEnabled, updateUser } from '../data/users';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
function paramId(value) {
    return Array.isArray(value) ? value[0] : value;
}
const permissionSchema = z.custom((value) => Object.values(PERMISSIONS).includes(value), '未知权限');
const roleSchema = z.enum(['admin', 'sre', 'auditor', 'viewer']);
const createAccountSchema = z.object({
    username: z.string().trim().min(2),
    password: z.string().min(8),
    displayName: z.string().trim().min(1),
    role: roleSchema,
    title: z.string().trim().min(1),
    enabled: z.boolean().default(true),
    customPermissions: z.array(permissionSchema).default([]),
});
const updateAccountSchema = z.object({
    displayName: z.string().trim().min(1),
    role: roleSchema,
    title: z.string().trim().min(1),
    enabled: z.boolean(),
    customPermissions: z.array(permissionSchema).default([]),
});
const enabledSchema = z.object({ enabled: z.boolean() });
const resetPasswordSchema = z.object({ password: z.string().min(8) });
const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.ACCOUNTS_MANAGE));
router.get('/', async (_req, res, next) => {
    try {
        res.json({ data: await listUsers() });
    }
    catch (error) {
        next(error);
    }
});
router.get('/metadata', (_req, res) => {
    res.json(getAccountMetadata());
});
router.post('/', async (req, res, next) => {
    try {
        const values = createAccountSchema.parse(req.body);
        const user = await createUser(values, req.user.displayName);
        res.status(201).json({ data: user });
    }
    catch (error) {
        next(error);
    }
});
router.patch('/:id', async (req, res, next) => {
    try {
        const values = updateAccountSchema.parse(req.body);
        if (paramId(req.params.id) === req.user.id && !values.enabled)
            return res.status(400).json({ message: '不能禁用当前登录账号' });
        const user = await updateUser(paramId(req.params.id), values, req.user.displayName);
        if (!user)
            return res.status(404).json({ message: '账号不存在' });
        res.json({ data: user });
    }
    catch (error) {
        next(error);
    }
});
router.patch('/:id/enabled', async (req, res, next) => {
    try {
        const values = enabledSchema.parse(req.body);
        const user = await setUserEnabled(paramId(req.params.id), values.enabled, req.user.displayName, req.user.id);
        if (!user)
            return res.status(404).json({ message: '账号不存在' });
        res.json({ data: user });
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/reset-password', async (req, res, next) => {
    try {
        const values = resetPasswordSchema.parse(req.body);
        const user = await resetUserPassword(paramId(req.params.id), values.password, req.user.displayName);
        if (!user)
            return res.status(404).json({ message: '账号不存在' });
        res.json({ data: user });
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:id', async (req, res, next) => {
    try {
        const user = await deleteUser(paramId(req.params.id), req.user.displayName, req.user.id);
        if (!user)
            return res.status(404).json({ message: '账号不存在' });
        res.json({ success: true, id: user.id });
    }
    catch (error) {
        next(error);
    }
});
export default router;
