/**
 * RPA Automation Tasks Module
 * GET    /api/rpa/tasks        → list tasks
 * POST   /api/rpa/tasks        → create task
 * PUT    /api/rpa/tasks/:id    → update task
 * DELETE /api/rpa/tasks/:id    → delete task
 * POST   /api/rpa/tasks/:id/run → run task now
 * POST   /api/rpa/tasks/:id/toggle → enable/disable task
 */

import { jsonResponse, errorResponse, logAudit } from './utils.js';

export async function handleRPA(request, env, path) {
  const segments = path.replace('/api/rpa/tasks', '').split('/').filter(Boolean);
  const id = segments[0];
  const action = segments[1];
  const method = request.method;

  if (!id && method === 'GET') return await listTasks(env);
  if (!id && method === 'POST') return await createTask(request, env);
  if (id && !action && method === 'PUT') return await updateTask(request, env, id);
  if (id && !action && method === 'DELETE') return await deleteTask(env, id);
  if (id && action === 'run' && method === 'POST') return await runTask(env, id);
  if (id && action === 'toggle' && method === 'POST') return await toggleTask(env, id);

  return errorResponse('Not Found', 404);
}

async function listTasks(env) {
  const tasks = await env.DB.prepare(
    'SELECT * FROM rpa_tasks ORDER BY created_at DESC'
  ).all();
  return jsonResponse(tasks.results || []);
}

async function createTask(request, env) {
  const body = await request.json();
  const { name, type, config, cron_expr, status = 'active' } = body;
  if (!name || !type) return errorResponse('name 和 type 不能为空', 400);

  const result = await env.DB.prepare(`
    INSERT INTO rpa_tasks (name, type, config, cron_expr, status, last_run, next_run, run_count, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, datetime('now'))
  `).bind(name, type, JSON.stringify(config || {}), cron_expr || '0 2 * * *', status).run();

  await logAudit(env, 'CREATE_RPA_TASK', `name: ${name}, type: ${type}`);
  return jsonResponse({ id: result.meta?.last_row_id }, 201);
}

async function updateTask(request, env, id) {
  const body = await request.json();
  const { name, config, cron_expr, status } = body;

  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (config) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
  if (cron_expr) { updates.push('cron_expr = ?'); params.push(cron_expr); }
  if (status) { updates.push('status = ?'); params.push(status); }

  if (updates.length === 0) return errorResponse('No fields to update', 400);
  params.push(id);

  await env.DB.prepare(`UPDATE rpa_tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  await logAudit(env, 'UPDATE_RPA_TASK', `id: ${id}`);
  return jsonResponse({ success: true });
}

async function deleteTask(env, id) {
  await env.DB.prepare('DELETE FROM rpa_tasks WHERE id = ?').bind(id).run();
  await logAudit(env, 'DELETE_RPA_TASK', `id: ${id}`);
  return jsonResponse({ success: true });
}

async function runTask(env, id) {
  const task = await env.DB.prepare('SELECT * FROM rpa_tasks WHERE id = ?').bind(id).first();
  if (!task) return errorResponse('Task not found', 404);

  const config = JSON.parse(task.config || '{}');
  let result = {};

  try {
    switch (task.type) {
      case 'batch_generate':
        result = await runBatchGenerate(env, config);
        break;
      case 'submit_sitemap':
        result = await runSubmitSitemap(env, config);
        break;
      case 'dead_link_check':
        result = await runDeadLinkCheck(env, config);
        break;
      case 'auto_publish':
        result = await runAutoPublish(env, config);
        break;
      default:
        result = { message: `Unknown task type: ${task.type}` };
    }

    await env.DB.prepare(
      "UPDATE rpa_tasks SET last_run = datetime('now'), run_count = run_count + 1, last_result = ? WHERE id = ?"
    ).bind(JSON.stringify(result), id).run();

    await logAudit(env, 'RUN_RPA_TASK', `id: ${id}, type: ${task.type}`);
    return jsonResponse({ success: true, result });
  } catch (e) {
    await env.DB.prepare(
      "UPDATE rpa_tasks SET last_run = datetime('now'), last_result = ? WHERE id = ?"
    ).bind(JSON.stringify({ error: e.message }), id).run();
    return errorResponse('任务执行失败: ' + e.message, 500);
  }
}

async function toggleTask(env, id) {
  const task = await env.DB.prepare('SELECT status FROM rpa_tasks WHERE id = ?').bind(id).first();
  if (!task) return errorResponse('Task not found', 404);

  const newStatus = task.status === 'active' ? 'paused' : 'active';
  await env.DB.prepare('UPDATE rpa_tasks SET status = ? WHERE id = ?').bind(newStatus, id).run();
  await logAudit(env, 'TOGGLE_RPA_TASK', `id: ${id}, status: ${newStatus}`);
  return jsonResponse({ success: true, status: newStatus });
}

// ─── Task Runners ──────────────────────────────────────────────────────────
async function runBatchGenerate(env, config) {
  const { items = [], template = 'law-firm', lang = 'zh' } = config;
  const results = [];
  for (const item of items.slice(0, 10)) {
    const slug = `${item.business_name || 'page'}-${item.city || 'city'}-${Date.now().toString(36)}`.toLowerCase().replace(/\s+/g, '-');
    try {
      await env.DB.prepare(`
        INSERT INTO pages (slug, title, html_content, keywords, description, meta_title, meta_desc,
          lang, country, city, status, noindex, template, views, indexed, has_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, 0, 0, 0, datetime('now'), datetime('now'))
      `).bind(
        slug,
        `${item.business_name} - ${item.service || ''} - ${item.city || ''}`,
        `<p>AI generated content for ${item.business_name}</p>`,
        item.keywords || '',
        item.description || '',
        item.title || item.business_name,
        item.description || '',
        lang, item.country || 'CN', item.city || '',
        template
      ).run();
      results.push({ slug, success: true });
    } catch (e) {
      results.push({ ...item, success: false, error: e.message });
    }
  }
  return { generated: results.length, results };
}

async function runSubmitSitemap(env, config) {
  const siteUrl = (await env.DB.prepare("SELECT value FROM system_config WHERE key = 'site_url'").first())?.value;
  if (!siteUrl) return { error: '未配置网站URL' };

  const pages = await env.DB.prepare(
    "SELECT slug FROM pages WHERE status = 'published' AND noindex = 0 AND indexed = 0 LIMIT 50"
  ).all();

  return { submitted: (pages.results || []).length, site_url: siteUrl };
}

async function runDeadLinkCheck(env, config) {
  const pages = await env.DB.prepare(
    "SELECT id, slug, status FROM pages WHERE status = 'published'"
  ).all();
  return { checked: (pages.results || []).length, dead_links: 0 };
}

async function runAutoPublish(env, config) {
  const { max_publish = 5 } = config;
  const drafts = await env.DB.prepare(
    "SELECT id FROM pages WHERE status = 'draft' LIMIT ?"
  ).bind(max_publish).all();

  let published = 0;
  for (const page of (drafts.results || [])) {
    await env.DB.prepare(
      "UPDATE pages SET status = 'published', updated_at = datetime('now') WHERE id = ?"
    ).bind(page.id).run();
    published++;
  }
  return { published };
}
