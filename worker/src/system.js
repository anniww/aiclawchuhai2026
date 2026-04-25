/**
 * System Configuration Module
 * - System config CRUD
 * - Stats dashboard
 * - Audit logs
 * - DB init/migration
 */
import { jsonResponse, errorResponse, requireAuth, logAudit } from './utils.js';

export async function handleSystem(request, env, path) {
  // DB init endpoint (no auth required for first setup)
  if (path === '/api/system/init' && request.method === 'POST') return initDB(request, env);

  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  if (path === '/api/system/stats' && request.method === 'GET') return getStats(request, env);
  if (path === '/api/system/logs' && request.method === 'GET') return getLogs(request, env);
  if (path === '/api/system/config' && request.method === 'GET') return getConfig(request, env);
  if (path === '/api/system/config' && request.method === 'POST') return saveConfig(request, env, auth.user);
  if (path === '/api/system/health' && request.method === 'GET') return healthCheck(request, env);

  return errorResponse('Not Found', 404);
}

async function initDB(request, env) {
  const results = [];
  const run = (sql) => env.DB.exec(sql);

  try {
    await run(`CREATE TABLE IF NOT EXISTS pages (
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    results.push('pages table OK');
  } catch(e) { results.push('pages: ' + e.message); }

  try {
    await run(`CREATE TABLE IF NOT EXISTS rpa_tasks (
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
    )`);
    results.push('rpa_tasks table OK');
  } catch(e) { results.push('rpa_tasks: ' + e.message); }

  try {
    await run(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT DEFAULT 'admin',
      action TEXT NOT NULL,
      detail TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    results.push('audit_logs table OK');
  } catch(e) { results.push('audit_logs: ' + e.message); }

  try {
    await run(`CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    )`);
    results.push('system_config table OK');
  } catch(e) { results.push('system_config: ' + e.message); }

  try {
    await run(`CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT UNIQUE NOT NULL,
      zone_id TEXT DEFAULT '',
      type TEXT DEFAULT 'custom',
      ssl INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    results.push('domains table OK');
  } catch(e) { results.push('domains: ' + e.message); }

  try {
    await run(`CREATE TABLE IF NOT EXISTS subdomains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prefix TEXT NOT NULL,
      base_domain TEXT NOT NULL,
      full_domain TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    results.push('subdomains table OK');
  } catch(e) { results.push('subdomains: ' + e.message); }

  // Default config
  const defaults = [
    ['site_url', env.SITE_URL || 'https://aiclawchuhai.shop'],
    ['site_name', 'AI落地页管理系统'],
    ['admin_email', ''],
    ['whatsapp_number', ''],
    ['google_analytics_id', ''],
    ['facebook_pixel_id', ''],
    ['default_lang', 'zh'],
    ['default_country', 'CN'],
    ['auto_index', '1'],
    ['footer_text', ''],
    ['github_repo', env.GITHUB_REPO || 'anniww/aiclawchuhai2026'],
  ];
  for (const [k, v] of defaults) {
    try { await env.DB.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)').bind(k, v).run(); } catch {}
  }
  results.push('Default config inserted');

  // Default RPA tasks
  const rpaTasks = [
    ['每日自动提交Google收录', 'submit_sitemap', '{}', '0 3 * * *', 'active'],
    ['每日自动发布草稿', 'auto_publish', '{"max_publish":5}', '0 2 * * *', 'paused'],
    ['每周死链检测', 'dead_link_check', '{}', '0 4 * * 1', 'active'],
    ['每日GitHub同步', 'sync_github', '{}', '0 1 * * *', 'paused'],
  ];
  for (const [name, type, config, cron, status] of rpaTasks) {
    try { await env.DB.prepare('INSERT OR IGNORE INTO rpa_tasks (name, type, config, cron_expr, status) VALUES (?, ?, ?, ?, ?)').bind(name, type, config, cron, status).run(); } catch {}
  }
  results.push('Default RPA tasks inserted');

  // Default domains
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO domains (domain, type, status) VALUES (?, "primary", "active")').bind('aiclawchuhai.shop').run();
    await env.DB.prepare('INSERT OR IGNORE INTO domains (domain, type, status) VALUES (?, "secondary", "active")').bind('sellersupply.shop').run();
  } catch {}
  results.push('Default domains inserted');

  return jsonResponse({ success: true, results });
}

async function getStats(request, env) {
  try {
    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM pages) as total_pages,
        (SELECT COUNT(*) FROM pages WHERE status='published') as published_pages,
        (SELECT COUNT(*) FROM pages WHERE status='draft') as draft_pages,
        (SELECT COUNT(*) FROM pages WHERE indexed=1) as indexed_pages,
        (SELECT COALESCE(SUM(views),0) FROM pages) as total_views,
        (SELECT COUNT(*) FROM rpa_tasks WHERE status='active') as active_tasks,
        (SELECT COUNT(*) FROM domains) as total_domains,
        (SELECT COUNT(*) FROM audit_logs WHERE created_at > datetime('now','-1 day')) as logs_today
    `).first();
    return jsonResponse({ success: true, data: stats });
  } catch (e) {
    return jsonResponse({ success: true, data: { total_pages: 0, published_pages: 0, draft_pages: 0, indexed_pages: 0, total_views: 0, active_tasks: 0, total_domains: 0, logs_today: 0 } });
  }
}

async function getLogs(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const rows = await env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return jsonResponse({ success: true, data: rows.results || [] });
}

async function getConfig(request, env) {
  const rows = await env.DB.prepare('SELECT key, value FROM system_config').all();
  const obj = {};
  (rows.results || []).forEach(r => { obj[r.key] = r.value; });
  return jsonResponse({ success: true, data: obj });
}

async function saveConfig(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  for (const [key, value] of Object.entries(body)) {
    await env.DB.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)').bind(key, String(value)).run();
  }
  await logAudit(env, 'save_config', `更新系统配置 ${Object.keys(body).join(', ')}`, user.username);
  return jsonResponse({ success: true });
}

async function healthCheck(request, env) {
  const checks = {};
  try { await env.DB.prepare('SELECT 1').first(); checks.db = 'ok'; } catch (e) { checks.db = 'error: ' + e.message; }
  try { await env.KV.get('health_check'); checks.kv = 'ok'; } catch (e) { checks.kv = 'error: ' + e.message; }
  return jsonResponse({ success: true, status: 'healthy', checks, timestamp: new Date().toISOString() });
}
