/**
 * RPA Automation Module
 * - Cron-based scheduled tasks
 * - GitHub auto-sync
 * - Google Indexing API submission
 * - Auto-publish drafts
 * - Dead link detection
 */
import { jsonResponse, errorResponse, requireAuth, logAudit, getGoogleAccessToken, generateSitemap } from './utils.js';

export async function handleRPA(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  if (path === '/api/rpa/tasks' && request.method === 'GET') return listTasks(request, env);
  if (path === '/api/rpa/tasks' && request.method === 'POST') return createTask(request, env, auth.user);
  if (path.match(/^\/api\/rpa\/tasks\/\d+$/) && request.method === 'PUT') return updateTask(request, env, path, auth.user);
  if (path.match(/^\/api\/rpa\/tasks\/\d+$/) && request.method === 'DELETE') return deleteTask(request, env, path, auth.user);
  if (path.match(/^\/api\/rpa\/tasks\/\d+\/run$/) && request.method === 'POST') return runTaskNow(request, env, path, auth.user);
  if (path === '/api/rpa/submit-indexing' && request.method === 'POST') return submitIndexing(request, env, auth.user);
  if (path === '/api/rpa/sync-github' && request.method === 'POST') return syncGitHub(request, env, auth.user);
  if (path === '/api/rpa/auto-publish' && request.method === 'POST') return autoPublish(request, env, auth.user);

  return errorResponse('Not Found', 404);
}

// ─── Scheduled Handler (called by Cloudflare Cron) ──────────────────────────
export async function handleScheduled(event, env) {
  const cron = event.cron;
  console.log(`Cron triggered: ${cron}`);

  try {
    // 0 2 * * * → auto publish drafts
    if (cron === '0 2 * * *') {
      await runAutoPublish(env, 5);
    }
    // 0 3 * * * → submit Google indexing
    if (cron === '0 3 * * *') {
      await runGoogleIndexing(env);
    }
    // 0 4 * * 1 → dead link check
    if (cron === '0 4 * * 1') {
      await runDeadLinkCheck(env);
    }
    // Run all active tasks
    const tasks = await env.DB.prepare('SELECT * FROM rpa_tasks WHERE status = "active"').all();
    for (const task of (tasks.results || [])) {
      if (shouldRunTask(task, cron)) {
        await executeTask(task, env);
      }
    }
  } catch (e) {
    console.error('Scheduled error:', e);
  }
}

function shouldRunTask(task, cron) {
  return task.cron_expr === cron;
}

async function executeTask(task, env) {
  try {
    let result = '';
    const config = JSON.parse(task.config || '{}');

    if (task.type === 'submit_sitemap') {
      result = await runGoogleIndexing(env);
    } else if (task.type === 'auto_publish') {
      result = await runAutoPublish(env, config.max_publish || 5);
    } else if (task.type === 'dead_link_check') {
      result = await runDeadLinkCheck(env);
    } else if (task.type === 'sync_github') {
      result = await runGitHubSync(env);
    }

    await env.DB.prepare(
      'UPDATE rpa_tasks SET last_run = datetime("now"), run_count = run_count + 1, last_result = ? WHERE id = ?'
    ).bind(JSON.stringify(result), task.id).run();
  } catch (e) {
    await env.DB.prepare(
      'UPDATE rpa_tasks SET last_run = datetime("now"), last_result = ? WHERE id = ?'
    ).bind(JSON.stringify({ error: e.message }), task.id).run();
  }
}

// ─── Google Indexing API ─────────────────────────────────────────────────────
async function runGoogleIndexing(env) {
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) {
    return { error: 'Google API credentials not configured' };
  }

  const baseUrl = env.SITE_URL || 'https://aiclawchuhai.shop';
  const rows = await env.DB.prepare(
    'SELECT id, slug FROM pages WHERE status = "published" AND noindex = 0 AND indexed = 0 LIMIT 100'
  ).all();
  const pages = rows.results || [];
  if (!pages.length) return { message: 'No pages to index', count: 0 };

  let accessToken;
  try {
    accessToken = await getGoogleAccessToken(clientEmail, privateKey);
  } catch (e) {
    return { error: `Failed to get access token: ${e.message}` };
  }

  const results = [];
  for (const page of pages) {
    const url = `${baseUrl}/${page.slug}`;
    try {
      const resp = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      });
      const data = await resp.json();
      if (resp.ok) {
        await env.DB.prepare('UPDATE pages SET indexed = 1, indexed_at = datetime("now") WHERE id = ?').bind(page.id).run();
        results.push({ url, success: true });
      } else {
        results.push({ url, success: false, error: data.error?.message });
      }
    } catch (e) {
      results.push({ url, success: false, error: e.message });
    }
  }

  await logAudit(env, 'google_indexing', `提交 ${results.filter(r=>r.success).length}/${results.length} 个URL到Google收录`);
  return { success: true, total: results.length, submitted: results.filter(r=>r.success).length, results };
}

// ─── Auto Publish Drafts ─────────────────────────────────────────────────────
async function runAutoPublish(env, maxPublish = 5) {
  const rows = await env.DB.prepare(
    `SELECT id, title FROM pages WHERE status = "draft" ORDER BY created_at ASC LIMIT ?`
  ).bind(maxPublish).all();
  const pages = rows.results || [];
  if (!pages.length) return { message: 'No drafts to publish', count: 0 };

  for (const page of pages) {
    await env.DB.prepare('UPDATE pages SET status = "published", updated_at = datetime("now") WHERE id = ?').bind(page.id).run();
  }
  await logAudit(env, 'auto_publish', `自动发布 ${pages.length} 个草稿页面`);
  return { success: true, published: pages.length, pages: pages.map(p => p.title) };
}

// ─── Dead Link Check ─────────────────────────────────────────────────────────
async function runDeadLinkCheck(env) {
  const baseUrl = env.SITE_URL || 'https://aiclawchuhai.shop';
  const rows = await env.DB.prepare('SELECT id, slug, title FROM pages WHERE status = "published" LIMIT 50').all();
  const pages = rows.results || [];
  const dead = [];

  for (const page of pages) {
    try {
      const resp = await fetch(`${baseUrl}/${page.slug}`, { method: 'HEAD' });
      if (resp.status >= 400) {
        dead.push({ slug: page.slug, title: page.title, status: resp.status });
        await env.DB.prepare('UPDATE pages SET status = "archived" WHERE id = ?').bind(page.id).run();
      }
    } catch (e) {
      dead.push({ slug: page.slug, title: page.title, error: e.message });
    }
  }

  await logAudit(env, 'dead_link_check', `死链检测: 发现 ${dead.length} 个死链`);
  return { success: true, checked: pages.length, dead_links: dead.length, dead };
}

// ─── GitHub Sync ─────────────────────────────────────────────────────────────
async function runGitHubSync(env) {
  const githubToken = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO || 'anniww/aiclawchuhai2026';
  if (!githubToken) return { error: 'GitHub token not configured' };

  const baseUrl = env.SITE_URL || 'https://aiclawchuhai.shop';
  const rows = await env.DB.prepare('SELECT slug, title, html_content, updated_at FROM pages WHERE status = "published" ORDER BY updated_at DESC LIMIT 50').all();
  const pages = rows.results || [];

  const results = [];
  for (const page of pages) {
    try {
      const filePath = `pages/${page.slug}.html`;
      const content = btoa(unescape(encodeURIComponent(page.html_content)));

      // Check if file exists
      let sha = null;
      try {
        const checkResp = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
          headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (checkResp.ok) {
          const checkData = await checkResp.json();
          sha = checkData.sha;
        }
      } catch {}

      const body = { message: `Update page: ${page.title}`, content };
      if (sha) body.sha = sha;

      const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${githubToken}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
        body: JSON.stringify(body),
      });
      results.push({ slug: page.slug, success: resp.ok, status: resp.status });
    } catch (e) {
      results.push({ slug: page.slug, success: false, error: e.message });
    }
  }

  await logAudit(env, 'github_sync', `GitHub同步 ${results.filter(r=>r.success).length}/${results.length} 个页面`);
  return { success: true, total: results.length, synced: results.filter(r=>r.success).length };
}

// ─── API Handlers ─────────────────────────────────────────────────────────────
async function listTasks(request, env) {
  const rows = await env.DB.prepare('SELECT * FROM rpa_tasks ORDER BY created_at DESC').all();
  return jsonResponse({ success: true, data: rows.results || [] });
}

async function createTask(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { name, type, config = '{}', cron_expr = '0 2 * * *', status = 'active' } = body;
  if (!name || !type) return errorResponse('任务名称和类型不能为空', 400);
  await env.DB.prepare('INSERT INTO rpa_tasks (name, type, config, cron_expr, status) VALUES (?, ?, ?, ?, ?)').bind(name, type, config, cron_expr, status).run();
  await logAudit(env, 'create_rpa_task', `创建RPA任务: ${name}`, user.username);
  return jsonResponse({ success: true });
}

async function updateTask(request, env, path, user) {
  const id = parseInt(path.split('/').pop());
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const fields = [];
  const values = [];
  for (const key of ['name', 'type', 'config', 'cron_expr', 'status']) {
    if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
  }
  if (!fields.length) return errorResponse('没有可更新的字段', 400);
  values.push(id);
  await env.DB.prepare(`UPDATE rpa_tasks SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  await logAudit(env, 'update_rpa_task', `更新RPA任务 ID:${id}`, user.username);
  return jsonResponse({ success: true });
}

async function deleteTask(request, env, path, user) {
  const id = parseInt(path.split('/').pop());
  await env.DB.prepare('DELETE FROM rpa_tasks WHERE id = ?').bind(id).run();
  await logAudit(env, 'delete_rpa_task', `删除RPA任务 ID:${id}`, user.username);
  return jsonResponse({ success: true });
}

async function runTaskNow(request, env, path, user) {
  const id = parseInt(path.split('/')[4]);
  const task = await env.DB.prepare('SELECT * FROM rpa_tasks WHERE id = ?').bind(id).first();
  if (!task) return errorResponse('任务不存在', 404);
  const result = await executeTask(task, env);
  await logAudit(env, 'run_rpa_task', `手动执行RPA任务: ${task.name}`, user.username);
  return jsonResponse({ success: true, result });
}

async function submitIndexing(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { urls = [] } = body;

  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) return errorResponse('Google API 凭证未配置', 500);

  let accessToken;
  try { accessToken = await getGoogleAccessToken(clientEmail, privateKey); } catch (e) { return errorResponse(`获取访问令牌失败: ${e.message}`, 500); }

  const results = [];
  const targetUrls = urls.length ? urls : [];

  if (!targetUrls.length) {
    const baseUrl = env.SITE_URL || 'https://aiclawchuhai.shop';
    const rows = await env.DB.prepare('SELECT id, slug FROM pages WHERE status = "published" AND noindex = 0 AND indexed = 0 LIMIT 200').all();
    for (const p of (rows.results || [])) targetUrls.push({ id: p.id, url: `${baseUrl}/${p.slug}` });
  }

  for (const item of targetUrls) {
    const url = typeof item === 'string' ? item : item.url;
    try {
      const resp = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      });
      const data = await resp.json();
      if (resp.ok) {
        if (item.id) await env.DB.prepare('UPDATE pages SET indexed = 1, indexed_at = datetime("now") WHERE id = ?').bind(item.id).run();
        results.push({ url, success: true });
      } else {
        results.push({ url, success: false, error: data.error?.message });
      }
    } catch (e) {
      results.push({ url, success: false, error: e.message });
    }
  }

  await logAudit(env, 'submit_indexing', `手动提交 ${results.filter(r=>r.success).length}/${results.length} 个URL`, user.username);
  return jsonResponse({ success: true, total: results.length, submitted: results.filter(r=>r.success).length, results });
}

async function syncGitHub(request, env, user) {
  const result = await runGitHubSync(env);
  return jsonResponse(result);
}

async function autoPublish(request, env, user) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const result = await runAutoPublish(env, body.max || 10);
  return jsonResponse(result);
}
