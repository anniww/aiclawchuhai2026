/**
 * AI Landing Page System - Cloudflare Worker
 * Main entry point: routes all API requests
 */

import { handleAuth } from './auth.js';

// ─── DB Auto-Init ─────────────────────────────────────────────────────────────
// DB init - runs once per Worker isolate startup
let dbInitialized = false;
async function ensureDB(env) {
  if (dbInitialized) return;
  dbInitialized = true;
  try {
    // Create tables if not exist
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        html_content TEXT DEFAULT '',
        keywords TEXT DEFAULT '',
        description TEXT DEFAULT '',
        meta_title TEXT DEFAULT '',
        meta_desc TEXT DEFAULT '',
        lang TEXT DEFAULT 'zh',
        country TEXT DEFAULT 'CN',
        city TEXT DEFAULT '',
        status TEXT DEFAULT 'draft',
        noindex INTEGER DEFAULT 0,
        template TEXT DEFAULT 'default',
        views INTEGER DEFAULT 0,
        indexed INTEGER DEFAULT 0,
        indexed_at TEXT,
        has_password INTEGER DEFAULT 0,
        password_hash TEXT,
        ip_whitelist TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS rpa_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT DEFAULT '{}',
        cron_expr TEXT DEFAULT '0 2 * * *',
        status TEXT DEFAULT 'active',
        last_run TEXT,
        next_run TEXT,
        run_count INTEGER DEFAULT 0,
        last_result TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT DEFAULT 'admin',
        action TEXT NOT NULL,
        detail TEXT DEFAULT '',
        ip TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT DEFAULT ''
      );
    `);
    // Add missing columns to pages (ignore errors if already exist)
    const alterCols = [
      "ALTER TABLE pages ADD COLUMN lang TEXT DEFAULT 'zh'",
      "ALTER TABLE pages ADD COLUMN country TEXT DEFAULT 'CN'",
      "ALTER TABLE pages ADD COLUMN city TEXT DEFAULT ''",
      "ALTER TABLE pages ADD COLUMN noindex INTEGER DEFAULT 0",
      "ALTER TABLE pages ADD COLUMN template TEXT DEFAULT 'default'",
      "ALTER TABLE pages ADD COLUMN indexed INTEGER DEFAULT 0",
      "ALTER TABLE pages ADD COLUMN indexed_at TEXT",
      "ALTER TABLE pages ADD COLUMN has_password INTEGER DEFAULT 0",
      "ALTER TABLE pages ADD COLUMN password_hash TEXT",
      "ALTER TABLE pages ADD COLUMN ip_whitelist TEXT DEFAULT ''",
      "ALTER TABLE pages ADD COLUMN meta_title TEXT DEFAULT ''",
      "ALTER TABLE pages ADD COLUMN meta_desc TEXT DEFAULT ''",
    ];
    for (const sql of alterCols) {
      try { await env.DB.exec(sql); } catch(e) { /* column already exists */ }
    }
    // Insert default config
    await env.DB.exec(`
      INSERT OR IGNORE INTO system_config (key, value) VALUES
        ('site_url',''),('site_name','AI Landing Page System'),
        ('admin_email',''),('whatsapp_number',''),
        ('google_analytics_id',''),('facebook_pixel_id',''),
        ('default_lang','zh'),('default_country','CN'),
        ('auto_index','1'),('footer_text','');
      INSERT OR IGNORE INTO rpa_tasks (name, type, config, cron_expr, status) VALUES
        ('每日自动提交Google收录','submit_sitemap','{}','0 3 * * *','active'),
        ('每日自动发布草稿','auto_publish','{"max_publish":5}','0 2 * * *','paused'),
        ('死链检测','dead_link_check','{}','0 4 * * 1','active');
    `);
    dbInitialized = true;
  } catch(e) {
    console.error('DB init error:', e.message);
  }
}
import { handlePages } from './pages.js';
import { handleAI } from './ai.js';
import { handleSEO } from './seo.js';
import { handleRPA } from './rpa.js';
import { handleScheduled } from './scheduled.js';
import { corsHeaders, jsonResponse, errorResponse } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Auto-initialize database on first request
    await ensureDB(env);

    try {
      // Public routes (no auth required)
      if (path.startsWith('/api/auth/')) {
        return await handleAuth(request, env, path);
      }

      // Public landing page access
      if (path.startsWith('/p/')) {
        return await handlePublicPage(request, env, path);
      }

      // Sitemap
      if (path === '/sitemap.xml') {
        return await handleSitemap(request, env);
      }

      // Protected API routes
      if (path.startsWith('/api/')) {
        const authResult = await verifyToken(request, env);
        if (!authResult.ok) {
          return errorResponse('Unauthorized', 401);
        }

        if (path.startsWith('/api/pages')) {
          return await handlePages(request, env, path, authResult.user);
        }
        if (path.startsWith('/api/ai')) {
          return await handleAI(request, env, path);
        }
        if (path.startsWith('/api/seo')) {
          return await handleSEO(request, env, path);
        }
        if (path.startsWith('/api/rpa')) {
          return await handleRPA(request, env, path);
        }
        if (path.startsWith('/api/system')) {
          return await handleSystem(request, env, path);
        }

        return errorResponse('Not Found', 404);
      }

      return errorResponse('Not Found', 404);
    } catch (err) {
      console.error('Worker error:', err);
      return errorResponse('Internal Server Error: ' + err.message, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  }
};

// ─── Token Verification ────────────────────────────────────────────────────
async function verifyToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { ok: false };

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    return { ok: true, user: payload };
  } catch {
    return { ok: false };
  }
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

// ─── Public Page Handler ───────────────────────────────────────────────────
async function handlePublicPage(request, env, path) {
  const slug = path.replace('/p/', '').split('/')[0];
  if (!slug) return errorResponse('Not Found', 404);

  const page = await env.DB.prepare('SELECT * FROM pages WHERE slug = ? AND status = "published"').bind(slug).first();
  if (!page) return new Response('Page not found', { status: 404 });

  // Password protection check
  if (page.password_hash) {
    const url = new URL(request.url);
    const providedPw = url.searchParams.get('pw') || request.headers.get('X-Page-Password') || '';
    if (!providedPw) {
      return new Response(generatePasswordPage(slug, page.title), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    const hash = await sha256(providedPw);
    if (hash !== page.password_hash) {
      return new Response(generatePasswordPage(slug, page.title, true), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }

  // Update view count
  await env.DB.prepare('UPDATE pages SET views = views + 1 WHERE slug = ?').bind(slug).run();

  return new Response(page.html_content, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

function generatePasswordPage(slug, title, error = false) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>${title || 'Protected Page'}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); font-family: -apple-system, sans-serif; }
  .card { background: white; border-radius: 16px; padding: 40px; width: 100%; max-width: 400px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
  h2 { color: #1a1a2e; margin-bottom: 8px; font-size: 24px; }
  p { color: #666; margin-bottom: 24px; font-size: 14px; }
  input { width: 100%; padding: 12px 16px; border: 2px solid ${error ? '#ef4444' : '#e5e7eb'};
    border-radius: 8px; font-size: 16px; outline: none; transition: border-color 0.2s; }
  input:focus { border-color: #667eea; }
  .error { color: #ef4444; font-size: 13px; margin-top: 8px; display: ${error ? 'block' : 'none'}; }
  button { width: 100%; padding: 12px; background: linear-gradient(135deg, #667eea, #764ba2);
    color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;
    margin-top: 16px; transition: opacity 0.2s; }
  button:hover { opacity: 0.9; }
  .lock { font-size: 48px; text-align: center; margin-bottom: 16px; }
</style>
</head>
<body>
<div class="card">
  <div class="lock">🔒</div>
  <h2>访问受限</h2>
  <p>此页面需要密码才能访问</p>
  <form method="get">
    <input type="password" name="pw" placeholder="请输入访问密码" autofocus>
    <div class="error">密码错误，请重试</div>
    <button type="submit">确认访问</button>
  </form>
</div>
</body>
</html>`;
}

// ─── Sitemap Handler ───────────────────────────────────────────────────────
async function handleSitemap(request, env) {
  const pages = await env.DB.prepare(
    'SELECT slug, updated_at FROM pages WHERE status = "published" AND noindex = 0 ORDER BY updated_at DESC'
  ).all();

  const baseUrl = new URL(request.url).origin;
  const urls = (pages.results || []).map(p => `
  <url>
    <loc>${baseUrl}/p/${p.slug}</loc>
    <lastmod>${new Date(p.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
}

// ─── System Handler ────────────────────────────────────────────────────────
async function handleSystem(request, env, path) {
  // Manual DB init endpoint - call once after deployment
  if (path === '/api/system/init' && request.method === 'POST') {
    const results = [];
    const run = async (sql) => { await env.DB.prepare(sql).run(); };
    
    // Step 1: Recreate pages table with full schema
    try { await run('DROP TABLE IF EXISTS pages_old'); } catch(e) {}
    try {
      await run('ALTER TABLE pages RENAME TO pages_old');
      results.push('Renamed pages to pages_old');
    } catch(e) { results.push('Rename pages: ' + e.message); }
    
    try {
      await run(`CREATE TABLE pages (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, html_content TEXT DEFAULT '', keywords TEXT DEFAULT '', description TEXT DEFAULT '', meta_title TEXT DEFAULT '', meta_desc TEXT DEFAULT '', lang TEXT DEFAULT 'zh', country TEXT DEFAULT 'CN', city TEXT DEFAULT '', status TEXT DEFAULT 'draft', noindex INTEGER DEFAULT 0, template TEXT DEFAULT 'default', views INTEGER DEFAULT 0, indexed INTEGER DEFAULT 0, indexed_at TEXT, has_password INTEGER DEFAULT 0, password_hash TEXT, ip_whitelist TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
      results.push('Created new pages table');
    } catch(e) { results.push('Create pages: ' + e.message); }
    
    // Copy data from old table
    try {
      await run('INSERT OR IGNORE INTO pages (id,slug,title,html_content,keywords,description,status,created_at,updated_at) SELECT id,slug,title,html_content,keywords,description,status,created_at,updated_at FROM pages_old');
      results.push('Copied data from pages_old');
    } catch(e) { results.push('Copy data: ' + e.message); }
    try { await run('DROP TABLE IF EXISTS pages_old'); results.push('Dropped pages_old'); } catch(e) {}
    
    // Step 2: Fix rpa_tasks table
    try { await run('DROP TABLE IF EXISTS rpa_tasks_old'); } catch(e) {}
    try {
      await run('ALTER TABLE rpa_tasks RENAME TO rpa_tasks_old');
      results.push('Renamed rpa_tasks to rpa_tasks_old');
    } catch(e) { results.push('Rename rpa_tasks: ' + e.message); }
    try {
      await run(`CREATE TABLE IF NOT EXISTS rpa_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT DEFAULT '{}', cron_expr TEXT DEFAULT '0 2 * * *', status TEXT DEFAULT 'active', last_run TEXT, next_run TEXT, run_count INTEGER DEFAULT 0, last_result TEXT, created_at TEXT DEFAULT (datetime('now')))`);
      results.push('Created rpa_tasks table');
    } catch(e) { results.push('Create rpa_tasks: ' + e.message); }
    try { await run('DROP TABLE IF EXISTS rpa_tasks_old'); } catch(e) {}
    
    // Step 3: Create audit_logs
    try {
      await run(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT DEFAULT 'admin', action TEXT NOT NULL, detail TEXT DEFAULT '', ip TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`);
      results.push('Created audit_logs');
    } catch(e) { results.push('audit_logs: ' + e.message); }
    
    // Step 4: Create system_config
    try {
      await run(`CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT DEFAULT '')`);
      results.push('Created system_config');
    } catch(e) { results.push('system_config: ' + e.message); }
    
    // Step 5: Insert default data
    const configInserts = [
      ['site_url',''],['site_name','AI Landing Page System'],['admin_email',''],
      ['whatsapp_number',''],['google_analytics_id',''],['facebook_pixel_id',''],
      ['default_lang','zh'],['default_country','CN'],['auto_index','1'],['footer_text','']
    ];
    for (const [k,v] of configInserts) {
      try { await env.DB.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)').bind(k,v).run(); } catch(e) {}
    }
    results.push('Inserted default config');
    
    const rpaTasks = [
      ['每日自动提交Google收录','submit_sitemap','{}','0 3 * * *','active'],
      ['每日自动发布草稿','auto_publish','{"max_publish":5}','0 2 * * *','paused'],
      ['死链检测','dead_link_check','{}','0 4 * * 1','active']
    ];
    for (const [name,type,config,cron,status] of rpaTasks) {
      try { await env.DB.prepare('INSERT OR IGNORE INTO rpa_tasks (name,type,config,cron_expr,status) VALUES (?,?,?,?,?)').bind(name,type,config,cron,status).run(); } catch(e) {}
    }
    results.push('Inserted default RPA tasks');
    
    dbInitialized = true;
    return jsonResponse({ success: true, results });
  }
  
  if (path === '/api/system/stats' && request.method === 'GET') {
    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM pages) as total_pages,
        (SELECT COUNT(*) FROM pages WHERE status='published') as published_pages,
        (SELECT COUNT(*) FROM pages WHERE indexed=1) as indexed_pages,
        (SELECT SUM(views) FROM pages) as total_views,
        (SELECT COUNT(*) FROM rpa_tasks WHERE status='active') as active_tasks,
        (SELECT COUNT(*) FROM audit_logs WHERE created_at > datetime('now','-1 day')) as logs_today
    `).first();
    return jsonResponse(stats);
  }

  if (path === '/api/system/logs' && request.method === 'GET') {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const logs = await env.DB.prepare(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?'
    ).bind(limit).all();
    return jsonResponse(logs.results || []);
  }

  if (path === '/api/system/config' && request.method === 'GET') {
    const configs = await env.DB.prepare('SELECT key, value FROM system_config').all();
    const obj = {};
    (configs.results || []).forEach(r => { obj[r.key] = r.value; });
    return jsonResponse(obj);
  }

  if (path === '/api/system/config' && request.method === 'POST') {
    const body = await request.json();
    for (const [key, value] of Object.entries(body)) {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)'
      ).bind(key, String(value)).run();
    }
    return jsonResponse({ success: true });
  }

  return errorResponse('Not Found', 404);
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
