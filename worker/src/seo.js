/**
 * SEO & Google Indexing Module
 * POST /api/seo/submit-url     → submit single URL to Google
 * POST /api/seo/submit-all     → submit all published pages
 * GET  /api/seo/status         → get indexing status
 * DELETE /api/seo/remove-url   → remove URL from Google index
 */

import { jsonResponse, errorResponse, logAudit } from './utils.js';

export async function handleSEO(request, env, path) {
  if (path === '/api/seo/submit-url' && request.method === 'POST') {
    return await submitUrl(request, env);
  }
  if (path === '/api/seo/submit-all' && request.method === 'POST') {
    return await submitAll(request, env);
  }
  if (path === '/api/seo/status' && request.method === 'GET') {
    return await getStatus(env);
  }
  if (path === '/api/seo/remove-url' && request.method === 'DELETE') {
    return await removeUrl(request, env);
  }
  return errorResponse('Not Found', 404);
}

async function submitUrl(request, env) {
  const body = await request.json();
  const { url, type = 'URL_UPDATED' } = body;
  if (!url) return errorResponse('url 不能为空', 400);

  try {
    const result = await googleIndexingRequest(env, url, type);
    await logAudit(env, 'SEO_SUBMIT', `url: ${url}`);
    return jsonResponse({ success: true, url, result });
  } catch (e) {
    return errorResponse('提交失败: ' + e.message, 500);
  }
}

async function submitAll(request, env) {
  const siteUrl = (await env.DB.prepare("SELECT value FROM system_config WHERE key = 'site_url'").first())?.value;
  if (!siteUrl) return errorResponse('请先在系统配置中设置网站URL', 400);

  const pages = await env.DB.prepare(
    "SELECT slug FROM pages WHERE status = 'published' AND noindex = 0"
  ).all();

  const results = [];
  let success = 0;
  let failed = 0;

  for (const page of (pages.results || [])) {
    const url = `${siteUrl}/p/${page.slug}`;
    try {
      await googleIndexingRequest(env, url, 'URL_UPDATED');
      await env.DB.prepare(
        "UPDATE pages SET indexed = 1, indexed_at = datetime('now') WHERE slug = ?"
      ).bind(page.slug).run();
      results.push({ url, success: true });
      success++;
    } catch (e) {
      results.push({ url, success: false, error: e.message });
      failed++;
    }
  }

  await logAudit(env, 'SEO_SUBMIT_ALL', `success: ${success}, failed: ${failed}`);
  return jsonResponse({ success: true, total: results.length, success_count: success, failed_count: failed, results });
}

async function getStatus(env) {
  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN indexed = 1 THEN 1 ELSE 0 END) as indexed,
      SUM(CASE WHEN noindex = 1 THEN 1 ELSE 0 END) as noindex,
      SUM(CASE WHEN status = 'published' AND noindex = 0 THEN 1 ELSE 0 END) as indexable
    FROM pages
  `).first();
  return jsonResponse(stats);
}

async function removeUrl(request, env) {
  const body = await request.json();
  const { url } = body;
  if (!url) return errorResponse('url 不能为空', 400);

  try {
    const result = await googleIndexingRequest(env, url, 'URL_DELETED');
    await logAudit(env, 'SEO_REMOVE', `url: ${url}`);
    return jsonResponse({ success: true, url, result });
  } catch (e) {
    return errorResponse('删除失败: ' + e.message, 500);
  }
}

async function googleIndexingRequest(env, url, type) {
  if (!env.GOOGLE_SERVICE_ACCOUNT) throw new Error('Google Service Account 未配置');

  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const accessToken = await getGoogleAccessToken(serviceAccount);

  const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, type })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const pemKey = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const encoder = new TextEncoder();
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error('Failed to get token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}
