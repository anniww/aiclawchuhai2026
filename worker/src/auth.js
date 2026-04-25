/**
 * Authentication module
 * POST /api/auth/login  → returns JWT
 * GET  /api/auth/me     → verify token
 * POST /api/auth/change-password → change admin password
 */
import { jsonResponse, errorResponse, sha256, createJWT, verifyJWT, logAudit, getClientIP } from './utils.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutes

export async function handleAuth(request, env, path) {
  if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
  if (path === '/api/auth/me' && request.method === 'GET') return handleMe(request, env);
  if (path === '/api/auth/change-password' && request.method === 'POST') return handleChangePassword(request, env);
  return errorResponse('Not Found', 404);
}

async function handleLogin(request, env) {
  const clientIP = getClientIP(request);
  const lockKey = `login_lock:${clientIP}`;
  const attemptsKey = `login_attempts:${clientIP}`;

  const locked = await env.KV.get(lockKey);
  if (locked) return errorResponse('账户已锁定，请15分钟后重试', 429);

  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }

  const { username, password } = body;
  if (!username || !password) return errorResponse('用户名和密码不能为空', 400);

  const expectedUser = env.ADMIN_USERNAME || 'admin';
  const expectedHash = env.ADMIN_PASSWORD_HASH;
  if (!expectedHash) return errorResponse('系统未配置管理员密码，请联系部署人员', 500);

  const passwordHash = await sha256(password);
  if (username !== expectedUser || passwordHash !== expectedHash) {
    const attempts = parseInt(await env.KV.get(attemptsKey) || '0') + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await env.KV.put(lockKey, '1', { expirationTtl: LOCKOUT_SECONDS });
      await env.KV.delete(attemptsKey);
      return errorResponse('密码错误次数过多，账户已锁定15分钟', 429);
    }
    await env.KV.put(attemptsKey, String(attempts), { expirationTtl: LOCKOUT_SECONDS });
    return errorResponse(`用户名或密码错误（剩余尝试：${MAX_ATTEMPTS - attempts}次）`, 401);
  }

  await env.KV.delete(attemptsKey);
  await env.KV.delete(lockKey);

  const secret = env.JWT_SECRET || 'default-secret-change-me';
  const token = await createJWT({ username, role: 'admin' }, secret, 86400);
  await logAudit(env, 'login', `管理员登录成功 IP:${clientIP}`, username, clientIP);
  return jsonResponse({ success: true, token, username, role: 'admin' });
}

async function handleMe(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return errorResponse('未授权', 401);
  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET || 'default-secret-change-me');
  if (!payload) return errorResponse('Token 无效或已过期', 401);
  return jsonResponse({ success: true, username: payload.username, role: payload.role });
}

async function handleChangePassword(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return errorResponse('未授权', 401);
  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET || 'default-secret-change-me');
  if (!payload) return errorResponse('Token 无效或已过期', 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { oldPassword, newPassword } = body;
  if (!oldPassword || !newPassword) return errorResponse('旧密码和新密码不能为空', 400);
  if (newPassword.length < 8) return errorResponse('新密码至少8位', 400);

  const oldHash = await sha256(oldPassword);
  const expectedHash = env.ADMIN_PASSWORD_HASH;
  if (oldHash !== expectedHash) return errorResponse('旧密码错误', 401);

  const newHash = await sha256(newPassword);
  // Store new hash in KV as override (since we can't update env vars at runtime)
  await env.KV.put('admin_password_hash_override', newHash);
  await logAudit(env, 'change_password', '管理员修改密码', payload.username, getClientIP(request));
  return jsonResponse({ success: true, message: '密码修改成功' });
}
