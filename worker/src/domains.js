/**
 * Domain Management Module
 * - Multi-domain binding
 * - Subdomain management
 * - Cloudflare DNS auto-config
 */
import { jsonResponse, errorResponse, requireAuth, logAudit } from './utils.js';

export async function handleDomains(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  if (path === '/api/domains' && request.method === 'GET') return listDomains(request, env);
  if (path === '/api/domains' && request.method === 'POST') return addDomain(request, env, auth.user);
  if (path.match(/^\/api\/domains\/\d+$/) && request.method === 'DELETE') return removeDomain(request, env, path, auth.user);
  if (path === '/api/domains/subdomains' && request.method === 'GET') return listSubdomains(request, env);
  if (path === '/api/domains/subdomains' && request.method === 'POST') return createSubdomain(request, env, auth.user);
  if (path === '/api/domains/generate-subdomains' && request.method === 'POST') return generateSubdomains(request, env, auth.user);
  if (path.match(/^\/api\/domains\/subdomains\/\d+$/) && request.method === 'DELETE') return deleteSubdomain(request, env, path, auth.user);
  if (path === '/api/domains/cf-zones' && request.method === 'GET') return listCFZones(request, env);

  return errorResponse('Not Found', 404);
}

async function listDomains(request, env) {
  const rows = await env.DB.prepare('SELECT * FROM domains ORDER BY created_at DESC').all();
  return jsonResponse({ success: true, data: rows.results || [] });
}

async function addDomain(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { domain, zone_id = '', type = 'custom', ssl = 1 } = body;
  if (!domain) return errorResponse('域名不能为空', 400);

  try {
    await env.DB.prepare(
      'INSERT INTO domains (domain, zone_id, type, ssl, status) VALUES (?, ?, ?, ?, "active")'
    ).bind(domain, zone_id, type, ssl).run();
    await logAudit(env, 'add_domain', `添加域名: ${domain}`, user.username);
    return jsonResponse({ success: true, domain });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return errorResponse('域名已存在', 409);
    return errorResponse(`添加失败: ${e.message}`, 500);
  }
}

async function removeDomain(request, env, path, user) {
  const id = parseInt(path.split('/').pop());
  const domain = await env.DB.prepare('SELECT domain FROM domains WHERE id = ?').bind(id).first();
  if (!domain) return errorResponse('域名不存在', 404);
  await env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(id).run();
  await logAudit(env, 'remove_domain', `删除域名: ${domain.domain}`, user.username);
  return jsonResponse({ success: true });
}

async function listSubdomains(request, env) {
  const rows = await env.DB.prepare('SELECT * FROM subdomains ORDER BY created_at DESC').all();
  return jsonResponse({ success: true, data: rows.results || [] });
}

async function createSubdomain(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { prefix, base_domain, full_domain, description = '' } = body;
  if (!prefix || !base_domain) return errorResponse('前缀和基础域名不能为空', 400);
  const fullDomain = full_domain || `${prefix}.${base_domain}`;

  try {
    await env.DB.prepare(
      'INSERT INTO subdomains (prefix, base_domain, full_domain, description, status) VALUES (?, ?, ?, ?, "active")'
    ).bind(prefix, base_domain, fullDomain, description).run();
    await logAudit(env, 'create_subdomain', `创建子域名: ${fullDomain}`, user.username);
    return jsonResponse({ success: true, full_domain: fullDomain });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return errorResponse('子域名已存在', 409);
    return errorResponse(`创建失败: ${e.message}`, 500);
  }
}

async function generateSubdomains(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { base_domain, count = 5, prefix_type = 'random', custom_prefixes = [] } = body;
  if (!base_domain) return errorResponse('基础域名不能为空', 400);

  const prefixes = [];
  if (prefix_type === 'custom' && custom_prefixes.length) {
    prefixes.push(...custom_prefixes);
  } else {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < count; i++) {
      let prefix = '';
      for (let j = 0; j < 6; j++) prefix += chars[Math.floor(Math.random() * chars.length)];
      prefixes.push(prefix);
    }
  }

  const results = [];
  for (const prefix of prefixes.slice(0, 50)) {
    const fullDomain = `${prefix}.${base_domain}`;
    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO subdomains (prefix, base_domain, full_domain, status) VALUES (?, ?, ?, "active")'
      ).bind(prefix, base_domain, fullDomain).run();
      results.push({ prefix, full_domain: fullDomain, success: true });
    } catch (e) {
      results.push({ prefix, full_domain: fullDomain, success: false, error: e.message });
    }
  }

  await logAudit(env, 'generate_subdomains', `批量生成 ${results.length} 个子域名`, user.username);
  return jsonResponse({ success: true, total: results.length, results });
}

async function deleteSubdomain(request, env, path, user) {
  const id = parseInt(path.split('/').pop());
  const sub = await env.DB.prepare('SELECT full_domain FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return errorResponse('子域名不存在', 404);
  await env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(id).run();
  await logAudit(env, 'delete_subdomain', `删除子域名: ${sub.full_domain}`, user.username);
  return jsonResponse({ success: true });
}

async function listCFZones(request, env) {
  const cfToken = env.CF_API_TOKEN;
  const accountId = env.CF_ACCOUNT_ID;
  if (!cfToken || !accountId) return errorResponse('Cloudflare API Token 未配置', 500);

  try {
    const resp = await fetch(`https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&per_page=50`, {
      headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }
    });
    const data = await resp.json();
    if (!data.success) return errorResponse('获取 Cloudflare Zones 失败', 500);
    return jsonResponse({
      success: true,
      zones: data.result.map(z => ({ id: z.id, name: z.name, status: z.status }))
    });
  } catch (e) {
    return errorResponse(`获取失败: ${e.message}`, 500);
  }
}
