import { findStoredUser, toAuthUser } from '../data/users';
import { verifyToken } from '../utils/jwt';
export async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
        return res.status(401).json({ message: '请先登录' });
    }
    try {
        const payload = verifyToken(token);
        const storedUser = await findStoredUser(payload.username);
        if (!storedUser || !storedUser.enabled || storedUser.tokenVersion !== payload.tokenVersion) {
            return res.status(401).json({ message: '登录已过期，请重新登录' });
        }
        req.user = toAuthUser(storedUser);
        next();
    }
    catch {
        return res.status(401).json({ message: '登录已过期，请重新登录' });
    }
}
