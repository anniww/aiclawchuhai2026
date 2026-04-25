/**
 * Pages management module
 * CRUD for landing pages, public serving, password protection
 */
import { jsonResponse, errorResponse, htmlResponse, requireAuth, logAudit, getClientIP, generateSitemap } from './utils.js';

export async function handlePages(request, env, path) {
  const url = new URL(request.url);

  // Public: serve sitemap
  if (path === '/sitemap.xml' && request.method === 'GET') return serveSitemap(request, env);

  // Public: serve landing page by slug
  const slugMatch = path.match(/^\/p\/([^/]+)$/);
  if (slugMatch && request.method === 'GET') return servePage(request, env, slugMatch[1]);

  // Public: verify page password
  if (path.match(/^\/p\/[^/]+\/verify$/) && request.method === 'POST') {
    const slug = path.split('/')[2];
    return verifyPagePassword(request, env, slug);
  }

  // Admin API: require auth
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  if (path === '/api/pages' && request.method === 'GET') return listPages(request, env);
  if (path === '/api/pages' && request.method === 'POST') return createPage(request, env, auth.user);
  if (path.match(/^\/api\/pages\/\d+$/) && request.method === 'GET') return getPage(request, env, path);
  if (path.match(/^\/api\/pages\/\d+$/) && request.method === 'PUT') return updatePage(request, env, path, auth.user);
  if (path.match(/^\/api\/pages\/\d+$/) && request.method === 'DELETE') return deletePage(request, env, path, auth.user);
  if (path.match(/^\/api\/pages\/\d+\/publish$/) && request.method === 'POST') return publishPage(request, env, path, auth.user);
  if (path.match(/^\/api\/pages\/\d+\/unpublish$/) && request.method === 'POST') return unpublishPage(request, env, path, auth.user);
  if (path.match(/^\/api\/pages\/\d+\/clone$/) && request.method === 'POST') return clonePage(request, env, path, auth.user);
  if (path === '/api/pages/bulk-action' && request.method === 'POST') return bulkAction(request, env, auth.user);
  if (path === '/api/pages/export-urls' && request.method === 'GET') return exportUrls(request, env);

  return errorResponse('Not Found', 404);
}

async function listPages(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = (page - 1) * limit;
  const status = url.searchParams.get('status') || '';
  const lang = url.searchParams.get('lang') || '';
  const country = url.searchParams.get('country') || '';
  const search = url.searchParams.get('search') || '';
  const indexed = url.searchParams.get('indexed') || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (lang) { where += ' AND lang = ?'; params.push(lang); }
  if (country) { where += ' AND country = ?'; params.push(country); }
  if (indexed !== '') { where += ' AND indexed = ?'; params.push(parseInt(indexed)); }
  if (search) { where += ' AND (title LIKE ? OR keywords LIKE ? OR slug LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM pages ${where}`).bind(...params).first();
  const total = countResult?.total || 0;

  const rows = await env.DB.prepare(
    `SELECT id, slug, title, keywords, description, meta_title, meta_desc, lang, country, city, status, noindex, template, views, indexed, indexed_at, has_password, created_at, updated_at FROM pages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return jsonResponse({
    success: true,
    data: rows.results || [],
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}

async function createPage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { slug, title, html_content = '', keywords = '', description = '', meta_title = '', meta_desc = '', lang = 'zh', country = 'CN', city = '', status = 'draft', noindex = 0, template = 'default', password = '' } = body;
  if (!slug || !title) return errorResponse('slug 和 title 不能为空', 400);

  const hasPassword = password ? 1 : 0;
  const passwordHash = password ? await sha256(password) : null;

  try {
    await env.DB.prepare(
      'INSERT INTO pages (slug, title, html_content, keywords, description, meta_title, meta_desc, lang, country, city, status, noindex, template, has_password, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(slug, title, html_content, keywords, description, meta_title || title, meta_desc || description, lang, country, city, status, noindex, template, hasPassword, passwordHash).run();
    await logAudit(env, 'create_page', `创建页面: ${title}`, user.username);
    return jsonResponse({ success: true, slug, title });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return errorResponse('Slug 已存在，请换一个', 409);
    return errorResponse(`创建失败: ${e.message}`, 500);
  }
}

async function getPage(request, env, path) {
  const id = parseInt(path.split('/').pop());
  const row = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
  if (!row) return errorResponse('页面不存在', 404);
  return jsonResponse({ success: true, data: row });
}

async function updatePage(request, env, path, user) {
  const id = parseInt(path.split('/').pop());
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }

  const fields = [];
  const values = [];
  const allowed = ['title', 'html_content', 'keywords', 'description', 'meta_title', 'meta_desc', 'lang', 'country', 'city', 'status', 'noindex', 'template'];
  for (const key of allowed) {
    if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
  }
  if (body.password !== undefined) {
    fields.push('has_password = ?', 'password_hash = ?');
    values.push(body.password ? 1 : 0, body.password ? await sha256(body.password) : null);
  }
  if (!fields.length) return errorResponse('没有可更新的字段', 400);
  fields.push('updated_at = datetime("now")');
  values.push(id);

  await env.DB.prepare(`UPDATE pages SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  await logAudit(env, 'update_page', `更新页面 ID:${id}`, user.username);
  return jsonResponse({ success: true });
}

async function deletePage(request, env, path, user) {
  const id = parseInt(path.split('/').pop());
  const page = await env.DB.prepare('SELECT title FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('页面不存在', 404);
  await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
  await logAudit(env, 'delete_page', `删除页面: ${page.title}`, user.username);
  return jsonResponse({ success: true });
}

async function publishPage(request, env, path, user) {
  const id = parseInt(path.split('/')[3]);
  await env.DB.prepare('UPDATE pages SET status = "published", updated_at = datetime("now") WHERE id = ?').bind(id).run();
  await logAudit(env, 'publish_page', `发布页面 ID:${id}`, user.username);
  return jsonResponse({ success: true });
}

async function unpublishPage(request, env, path, user) {
  const id = parseInt(path.split('/')[3]);
  await env.DB.prepare('UPDATE pages SET status = "draft", updated_at = datetime("now") WHERE id = ?').bind(id).run();
  await logAudit(env, 'unpublish_page', `下架页面 ID:${id}`, user.username);
  return jsonResponse({ success: true });
}

async function clonePage(request, env, path, user) {
  const id = parseInt(path.split('/')[3]);
  const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
  if (!page) return errorResponse('页面不存在', 404);
  const newSlug = page.slug + '-copy-' + Date.now().toString(36);
  await env.DB.prepare(
    'INSERT INTO pages (slug, title, html_content, keywords, description, meta_title, meta_desc, lang, country, city, status, noindex, template) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "draft", ?, ?)'
  ).bind(newSlug, page.title + ' (副本)', page.html_content, page.keywords, page.description, page.meta_title, page.meta_desc, page.lang, page.country, page.city, page.noindex, page.template).run();
  await logAudit(env, 'clone_page', `克隆页面: ${page.title}`, user.username);
  return jsonResponse({ success: true, slug: newSlug });
}

async function bulkAction(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { action, ids = [] } = body;
  if (!ids.length) return errorResponse('请选择要操作的页面', 400);

  const placeholders = ids.map(() => '?').join(',');
  if (action === 'publish') {
    await env.DB.prepare(`UPDATE pages SET status = "published" WHERE id IN (${placeholders})`).bind(...ids).run();
  } else if (action === 'unpublish') {
    await env.DB.prepare(`UPDATE pages SET status = "draft" WHERE id IN (${placeholders})`).bind(...ids).run();
  } else if (action === 'delete') {
    await env.DB.prepare(`DELETE FROM pages WHERE id IN (${placeholders})`).bind(...ids).run();
  } else if (action === 'noindex') {
    await env.DB.prepare(`UPDATE pages SET noindex = 1 WHERE id IN (${placeholders})`).bind(...ids).run();
  } else {
    return errorResponse('不支持的操作', 400);
  }
  await logAudit(env, 'bulk_action', `批量${action} ${ids.length}个页面`, user.username);
  return jsonResponse({ success: true, affected: ids.length });
}

async function exportUrls(request, env) {
  const url = new URL(request.url);
  const baseUrl = url.searchParams.get('base') || env.SITE_URL || 'https://aiclawchuhai.shop';
  const rows = await env.DB.prepare('SELECT slug FROM pages WHERE status = "published" ORDER BY created_at DESC').all();
  const urls = (rows.results || []).map(r => `${baseUrl}/${r.slug}`).join('\n');
  return new Response(urls, { headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="urls.txt"' } });
}

async function serveSitemap(request, env) {
  const baseUrl = env.SITE_URL || 'https://aiclawchuhai.shop';
  const rows = await env.DB.prepare('SELECT slug, updated_at FROM pages WHERE status = "published" AND noindex = 0').all();
  const xml = generateSitemap(rows.results || [], baseUrl);
  return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
}

async function servePage(request, env, slug) {
  const page = await env.DB.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first();
  if (!page) return htmlResponse('<h1>404 - Page Not Found</h1>', 404);
  if (page.status !== 'published') return htmlResponse('<h1>403 - Page Not Available</h1>', 403);

  // Password protection
  if (page.has_password) {
    const pagePassword = request.headers.get('X-Page-Password');
    if (!pagePassword) return servePasswordPrompt(slug, page.title);
    const hash = await sha256(pagePassword);
    if (hash !== page.password_hash) return servePasswordPrompt(slug, page.title, true);
  }

  // Increment view count
  await env.DB.prepare('UPDATE pages SET views = views + 1 WHERE id = ?').bind(page.id).run();
  return htmlResponse(page.html_content);
}

async function verifyPagePassword(request, env, slug) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const page = await env.DB.prepare('SELECT has_password, password_hash FROM pages WHERE slug = ?').bind(slug).first();
  if (!page) return errorResponse('页面不存在', 404);
  if (!page.has_password) return jsonResponse({ success: true });
  const hash = await sha256(body.password || '');
  if (hash !== page.password_hash) return errorResponse('密码错误', 401);
  return jsonResponse({ success: true });
}

function servePasswordPrompt(slug, title, error = false) {
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>访问验证 - ${title}</title>
<style>body{font-family:system-ui;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#fff;border-radius:12px;padding:40px;max-width:400px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,.1);text-align:center}
h2{margin:0 0 8px;color:#1e293b}p{color:#64748b;margin:0 0 24px}
input{width:100%;padding:12px;border:2px solid ${error?'#ef4444':'#e2e8f0'};border-radius:8px;font-size:16px;box-sizing:border-box;outline:none}
input:focus{border-color:#4f46e5}
button{width:100%;padding:12px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;margin-top:12px}
button:hover{background:#4338ca}.err{color:#ef4444;font-size:14px;margin-top:8px}</style></head>
<body><div class="box"><h2>🔒 访问验证</h2><p>此页面受密码保护，请输入访问密码</p>
<input type="password" id="pwd" placeholder="请输入密码" onkeypress="if(event.key==='Enter')verify()">
${error?'<div class="err">密码错误，请重试</div>':''}
<button onclick="verify()">确认访问</button></div>
<script>function verify(){const p=document.getElementById('pwd').value;if(!p)return;
fetch('/p/${slug}/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p})})
.then(r=>r.json()).then(d=>{if(d.success){sessionStorage.setItem('page_pwd_${slug}',p);location.reload();}else{location.href=location.href+'?err=1';}});}
const sp=new URLSearchParams(location.search);if(sp.get('err'))document.querySelector('.err')||document.querySelector('p').insertAdjacentHTML('afterend','<div class="err">密码错误</div>');
const saved=sessionStorage.getItem('page_pwd_${slug}');if(saved)verify();</script></body></html>`;
  return htmlResponse(html);
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
