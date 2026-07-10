import jwt from 'jsonwebtoken';
const defaultSecret = 'local-dev-secret-change-me';
function getSecret() {
    return process.env.JWT_SECRET || defaultSecret;
}
export function signToken(user) {
    const payload = { username: user.username, role: user.role, tokenVersion: user.tokenVersion };
    const options = { expiresIn: (process.env.JWT_EXPIRES_IN || '2h') };
    return jwt.sign(payload, getSecret(), options);
}
export function verifyToken(token) {
    return jwt.verify(token, getSecret());
}
