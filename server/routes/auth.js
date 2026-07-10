import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { signToken } from '../utils/jwt';
import { verifyUser } from '../data/users';
const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});
const router = Router();
router.post('/login', async (req, res, next) => {
    try {
        const values = loginSchema.parse(req.body);
        const user = await verifyUser(values.username, values.password);
        if (!user)
            return res.status(401).json({ message: '账号或密码错误，请检查后重试' });
        const token = signToken(user);
        return res.json({ user, token });
    }
    catch (error) {
        next(error);
    }
});
router.get('/me', authenticate, (req, res) => {
    return res.json({ user: req.user });
});
router.post('/logout', authenticate, (_req, res) => {
    return res.json({ success: true });
});
export default router;
