/**
 * Authentication module
 * - POST /api/auth/login  → returns JWT
 * - POST /api/auth/logout → client-side only
 * - GET  /api/auth/me     → verify token
 */

import { jsonResponse, errorResponse, sha256, createJWT } from './utils.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutes

export async function handleAuth(request, env, path) {
  if (path === '/api/auth/login' && request.method === 'POST') {
    return await handleLogin(request, env);
  }
  if (path === '/api/auth/me' && request.method === 'GET') {
    return await handleMe(request, env);
  }
  if (path === '/api/auth/change-password' && request.method === 'POST') {
    return await handleChangePassword(request, env);
  }
  return errorResponse('Not Found', 404);
}

async function handleLogin(request, env) {
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const lockKey = `login_lock:${clientIP}`;
  const attemptsKey = `login_attempts:${clientIP}`;

  // Check lockout
  const locked = await env.KV.get(lockKey);
  if (locked) {
    return errorResponse('账户已锁定，请15分钟后重试', 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const { username, password } = body;
  if (!username || !password) {
    return errorResponse('用户名和密码不能为空', 400);
  }

  // Verify credentials
  const expectedUser = env.ADMIN_USERNAME || 'admin';
  const expectedHash = env.ADMIN_PASSWORD_HASH;

  if (!expectedHash) {
    return errorResponse('系统未配置管理员密码，请联系部署人员', 500);
  }

  const passwordHash = await sha256(password);
  const usernameMatch = username === expectedUser;
  const passwordMatch = passwordHash === expectedHash;

  if (!usernameMatch || !passwordMatch) {
    // Increment attempt counter
    const attempts = parseInt(await env.KV.get(attemptsKey) || '0') + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await env.KV.put(lockKey, '1', { expirationTtl: LOCKOUT_SECONDS });
      await env.KV.delete(attemptsKey);
      return errorResponse(`密码错误次数过多，账户已锁定15分钟`, 429);
    }
    await env.KV.put(attemptsKey, String(attempts), { expirationTtl: LOCKOUT_SECONDS });
    return errorResponse(`用户名或密码错误（剩余尝试次数：${MAX_ATTEMPTS - attempts}）`, 401);
  }

  // Clear attempts on success
  await env.KV.delete(attemptsKey);
  await env.KV.delete(lockKey);

  // Generate JWT (24h expiry)
  const token = await createJWT({ username, role: 'admin' }, env.JWT_SECRET, 86400);

  // Log audit
  try {
    await env.DB.prepare(
      'INSERT INTO audit_logs (user, action, detail, created_at) VALUES (?, ?, ?, datetime("now"))'
    ).bind(username, 'LOGIN', `IP: ${clientIP}`).run();
  } catch (e) {
    console.error('Audit log error:', e);
  }

  return jsonResponse({ token, username, role: 'admin', expiresIn: 86400 });
}

async function handleMe(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return errorResponse('No token', 401);

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    return jsonResponse({ username: payload.username, role: payload.role });
  } catch (e) {
    return errorResponse('Invalid token', 401);
  }
}

async function handleChangePassword(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return errorResponse('Unauthorized', 401);

  try {
    await verifyJWT(token, env.JWT_SECRET);
  } catch {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const { newPassword } = body;
  if (!newPassword || newPassword.length < 8) {
    return errorResponse('新密码至少8位', 400);
  }

  // Store new hash in KV (runtime override)
  const newHash = await sha256(newPassword);
  await env.KV.put('admin_password_hash_override', newHash);

  return jsonResponse({ success: true, message: '密码已更新，下次登录生效' });
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const data = encoder.encode(parts[0] + '.' + parts[1]);
  const sig = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sig, data);
  if (!valid) throw new Error('Invalid signature');

  const payload = JSON.parse(atob(parts[1]));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}
