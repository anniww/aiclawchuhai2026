/**
 * Landing Pages CRUD module
 * GET    /api/pages          → list pages
 * GET    /api/pages/:id      → get single page
 * POST   /api/pages          → create page
 * PUT    /api/pages/:id      → update page
 * DELETE /api/pages/:id      → delete page
 * POST   /api/pages/:id/publish   → publish
 * POST   /api/pages/:id/unpublish → unpublish
 * POST   /api/pages/:id/clone     → clone
 * POST   /api/pages/bulk-delete   → bulk delete
 * POST   /api/pages/bulk-publish  → bulk publish
 * GET    /api/pages/:id/preview   → preview HTML
 */

import { jsonResponse, errorResponse, sha256, generateSlug, logAudit } from './utils.js';

export async function handlePages(request, env, path, user) {
  const url = new URL(request.url);
  const segments = path.replace('/api/pages', '').split('/').filter(Boolean);
  const id = segments[0];
  const action = segments[1];
  const method = request.method;

  // List pages
  if (!id && method === 'GET') {
    return await listPages(request, env, url);
  }

  // Create page
  if (!id && method === 'POST') {
    return await createPage(request, env, user);
  }

  // Bulk operations
  if (id === 'bulk-delete' && method === 'POST') {
    return await bulkDelete(request, env, user);
  }
  if (id === 'bulk-publish' && method === 'POST') {
    return await bulkPublish(request, env, user);
  }

  // Single page operations
  if (id && !action && method === 'GET') {
    return await getPage(env, id);
  }
  if (id && !action && method === 'PUT') {
    return await updatePage(request, env, id, user);
  }
  if (id && !action && method === 'DELETE') {
    return await deletePage(env, id, user);
  }
  if (id && action === 'publish' && method === 'POST') {
    return await publishPage(env, id, user, true);
  }
  if (id && action === 'unpublish' && method === 'POST') {
    return await publishPage(env, id, user, false);
  }
  if (id && action === 'clone' && method === 'POST') {
    return await clonePage(env, id, user);
  }
  if (id && action === 'preview' && method === 'GET') {
    return await previewPage(env, id);
  }
  if (id && action === 'set-password' && method === 'POST') {
    return await setPagePassword(request, env, id, user);
  }
  if (id && action === 'index' && method === 'POST') {
    return await submitToGoogle(request, env, id, user);
  }

  return errorResponse('Not Found', 404);
}

async function listPages(request, env, url) {
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const search = url.searchParams.get('search') || '';
  const status = url.searchParams.get('status') || '';
  const lang = url.searchParams.get('lang') || '';
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND (title LIKE ? OR slug LIKE ? OR keywords LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (lang) {
    where += ' AND lang = ?';
    params.push(lang);
  }

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM pages WHERE ${where}`
  ).bind(...params).first();

  const rows = await env.DB.prepare(
    `SELECT id, slug, title, status, lang, city, country, views, indexed, noindex,
     has_password, created_at, updated_at
     FROM pages WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return jsonResponse({
    pages: rows.results || [],
    total: countResult?.total || 0,
    page,
    limit
  });
}

async function getPage(env, id) {
  const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('Page not found', 404);
  return jsonResponse(page);
}

async function createPage(request, env, user) {
  const body = await request.json();
  const {
    title, slug: customSlug, html_content, keywords, description,
    lang = 'zh', country = 'CN', city = '', status = 'draft',
    noindex = 0, template = 'default', meta_title, meta_desc
  } = body;

  if (!title) return errorResponse('标题不能为空', 400);

  const slug = customSlug || generateSlug(title);

  // Check slug uniqueness
  const existing = await env.DB.prepare('SELECT id FROM pages WHERE slug = ?').bind(slug).first();
  if (existing) return errorResponse('Slug 已存在，请更换', 409);

  const result = await env.DB.prepare(`
    INSERT INTO pages (slug, title, html_content, keywords, description, meta_title, meta_desc,
      lang, country, city, status, noindex, template, views, indexed, has_password,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, datetime('now'), datetime('now'))
  `).bind(
    slug, title, html_content || '', keywords || '', description || '',
    meta_title || title, meta_desc || description || '',
    lang, country, city, status, noindex ? 1 : 0, template
  ).run();

  await logAudit(env, 'CREATE_PAGE', `slug: ${slug}`, user?.username);
  return jsonResponse({ id: result.meta?.last_row_id, slug }, 201);
}

async function updatePage(request, env, id, user) {
  const body = await request.json();
  const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('Page not found', 404);

  const fields = ['title', 'html_content', 'keywords', 'description', 'meta_title', 'meta_desc',
    'lang', 'country', 'city', 'noindex', 'template'];
  const updates = [];
  const params = [];

  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(body[f]);
    }
  }

  if (updates.length === 0) return errorResponse('No fields to update', 400);

  updates.push("updated_at = datetime('now')");
  params.push(id);

  await env.DB.prepare(
    `UPDATE pages SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  await logAudit(env, 'UPDATE_PAGE', `id: ${id}`, user?.username);
  return jsonResponse({ success: true });
}

async function deletePage(env, id, user) {
  const page = await env.DB.prepare('SELECT slug FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('Page not found', 404);

  await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
  await logAudit(env, 'DELETE_PAGE', `id: ${id}, slug: ${page.slug}`, user?.username);
  return jsonResponse({ success: true });
}

async function publishPage(env, id, user, publish) {
  const status = publish ? 'published' : 'draft';
  await env.DB.prepare(
    "UPDATE pages SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, id).run();
  await logAudit(env, publish ? 'PUBLISH_PAGE' : 'UNPUBLISH_PAGE', `id: ${id}`, user?.username);
  return jsonResponse({ success: true, status });
}

async function clonePage(env, id, user) {
  const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('Page not found', 404);

  const newSlug = page.slug + '-copy-' + Date.now().toString(36);
  const result = await env.DB.prepare(`
    INSERT INTO pages (slug, title, html_content, keywords, description, meta_title, meta_desc,
      lang, country, city, status, noindex, template, views, indexed, has_password,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, 0, 0, 0, datetime('now'), datetime('now'))
  `).bind(
    newSlug, page.title + ' (副本)', page.html_content, page.keywords, page.description,
    page.meta_title, page.meta_desc, page.lang, page.country, page.city,
    page.noindex, page.template
  ).run();

  await logAudit(env, 'CLONE_PAGE', `source: ${id}, new slug: ${newSlug}`, user?.username);
  return jsonResponse({ id: result.meta?.last_row_id, slug: newSlug }, 201);
}

async function previewPage(env, id) {
  const page = await env.DB.prepare('SELECT html_content, title FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('Page not found', 404);
  return new Response(page.html_content, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function setPagePassword(request, env, id, user) {
  const body = await request.json();
  const { password } = body;

  if (!password) {
    // Remove password
    await env.DB.prepare(
      "UPDATE pages SET password_hash = NULL, has_password = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(id).run();
    await logAudit(env, 'REMOVE_PAGE_PASSWORD', `id: ${id}`, user?.username);
    return jsonResponse({ success: true, has_password: false });
  }

  const hash = await sha256(password);
  await env.DB.prepare(
    "UPDATE pages SET password_hash = ?, has_password = 1, noindex = 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(hash, id).run();
  await logAudit(env, 'SET_PAGE_PASSWORD', `id: ${id}`, user?.username);
  return jsonResponse({ success: true, has_password: true });
}

async function submitToGoogle(request, env, id, user) {
  const page = await env.DB.prepare('SELECT slug, status FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('Page not found', 404);
  if (page.status !== 'published') return errorResponse('页面未发布', 400);

  const baseUrl = (await env.DB.prepare("SELECT value FROM system_config WHERE key = 'site_url'").first())?.value;
  if (!baseUrl) return errorResponse('请先在系统配置中设置网站URL', 400);

  const pageUrl = `${baseUrl}/p/${page.slug}`;

  try {
    const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
    const accessToken = await getGoogleAccessToken(serviceAccount);

    const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: pageUrl, type: 'URL_UPDATED' })
    });

    const result = await response.json();

    if (response.ok) {
      await env.DB.prepare(
        "UPDATE pages SET indexed = 1, indexed_at = datetime('now') WHERE id = ?"
      ).bind(id).run();
      await logAudit(env, 'GOOGLE_INDEX', `url: ${pageUrl}`, user?.username);
      return jsonResponse({ success: true, url: pageUrl, result });
    } else {
      return errorResponse(`Google API 错误: ${JSON.stringify(result)}`, 500);
    }
  } catch (e) {
    return errorResponse('Google 收录失败: ' + e.message, 500);
  }
}

async function bulkDelete(request, env, user) {
  const body = await request.json();
  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse('ids 不能为空', 400);

  for (const id of ids) {
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
  }
  await logAudit(env, 'BULK_DELETE', `ids: ${ids.join(',')}`, user?.username);
  return jsonResponse({ success: true, deleted: ids.length });
}

async function bulkPublish(request, env, user) {
  const body = await request.json();
  const { ids, status = 'published' } = body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse('ids 不能为空', 400);

  for (const id of ids) {
    await env.DB.prepare(
      "UPDATE pages SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(status, id).run();
  }
  await logAudit(env, 'BULK_PUBLISH', `ids: ${ids.join(',')}, status: ${status}`, user?.username);
  return jsonResponse({ success: true, updated: ids.length });
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

  // Import private key
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
  if (!tokenData.access_token) throw new Error('Failed to get Google access token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}
