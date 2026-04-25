/**
 * Cloudflare Cron Scheduled Handler
 * Runs daily at 2am UTC
 */

export async function handleScheduled(event, env) {
  console.log('Scheduled task triggered:', new Date().toISOString());

  try {
    // 1. Auto-submit new published pages to Google
    await autoSubmitToGoogle(env);

    // 2. Run active RPA tasks
    await runActiveTasks(env);

    // 3. Clean old audit logs (keep 30 days)
    await cleanOldLogs(env);

    console.log('Scheduled tasks completed');
  } catch (e) {
    console.error('Scheduled task error:', e);
  }
}

async function autoSubmitToGoogle(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT) return;

  const siteUrl = (await env.DB.prepare(
    "SELECT value FROM system_config WHERE key = 'site_url'"
  ).first())?.value;

  if (!siteUrl) return;

  // Get unindexed published pages
  const pages = await env.DB.prepare(
    "SELECT slug FROM pages WHERE status = 'published' AND noindex = 0 AND indexed = 0 LIMIT 10"
  ).all();

  for (const page of (pages.results || [])) {
    try {
      const url = `${siteUrl}/p/${page.slug}`;
      const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
      const accessToken = await getGoogleAccessToken(serviceAccount);

      const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url, type: 'URL_UPDATED' })
      });

      if (response.ok) {
        await env.DB.prepare(
          "UPDATE pages SET indexed = 1, indexed_at = datetime('now') WHERE slug = ?"
        ).bind(page.slug).run();
        console.log('Indexed:', url);
      }
    } catch (e) {
      console.error('Index error for', page.slug, e);
    }
  }
}

async function runActiveTasks(env) {
  const tasks = await env.DB.prepare(
    "SELECT * FROM rpa_tasks WHERE status = 'active'"
  ).all();

  for (const task of (tasks.results || [])) {
    try {
      const config = JSON.parse(task.config || '{}');

      if (task.type === 'auto_publish') {
        const { max_publish = 5 } = config;
        const drafts = await env.DB.prepare(
          "SELECT id FROM pages WHERE status = 'draft' LIMIT ?"
        ).bind(max_publish).all();

        for (const page of (drafts.results || [])) {
          await env.DB.prepare(
            "UPDATE pages SET status = 'published', updated_at = datetime('now') WHERE id = ?"
          ).bind(page.id).run();
        }
      }

      await env.DB.prepare(
        "UPDATE rpa_tasks SET last_run = datetime('now'), run_count = run_count + 1 WHERE id = ?"
      ).bind(task.id).run();
    } catch (e) {
      console.error('RPA task error:', task.id, e);
    }
  }
}

async function cleanOldLogs(env) {
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE created_at < datetime('now', '-30 days')"
  ).run();
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
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
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
  if (!tokenData.access_token) throw new Error('Failed to get token');
  return tokenData.access_token;
}
