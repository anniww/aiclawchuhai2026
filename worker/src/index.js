/**
 * AI Landing Page System - Cloudflare Worker Main Entry
 * Routes all requests to appropriate handlers
 */
import { handleAuth } from './auth.js';
import { handlePages } from './pages.js';
import { handleAI } from './ai.js';
import { handleRPA, handleScheduled } from './rpa.js';
import { handleDomains } from './domains.js';
import { handleSystem } from './system.js';
import { corsResponse, jsonResponse, errorResponse } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') return corsResponse();

    try {
      // ─── Auth routes ─────────────────────────────────────────────────────
      if (path.startsWith('/api/auth/')) return handleAuth(request, env, path);

      // ─── System routes ────────────────────────────────────────────────────
      if (path.startsWith('/api/system/')) return handleSystem(request, env, path);

      // ─── AI routes ────────────────────────────────────────────────────────
      if (path.startsWith('/api/ai/')) return handleAI(request, env, path);
      // SEO routes (handled by AI module)
      if (path.startsWith('/api/seo/')) return handleAI(request, env, path);

      // ─── Pages API routes ─────────────────────────────────────────────────
      if (path.startsWith('/api/pages')) return handlePages(request, env, path);

      // ─── RPA routes ───────────────────────────────────────────────────────
      if (path.startsWith('/api/rpa/')) return handleRPA(request, env, path);

      // ─── Domain routes ────────────────────────────────────────────────────
      if (path.startsWith('/api/domains')) return handleDomains(request, env, path);

      // ─── Sitemap ──────────────────────────────────────────────────────────
      if (path === '/sitemap.xml') return handlePages(request, env, path);

      // ─── Public page serving ──────────────────────────────────────────────
      if (path.startsWith('/p/')) return handlePages(request, env, path);

      // ─── Health check ─────────────────────────────────────────────────────
      if (path === '/health' || path === '/') {
        return jsonResponse({
          status: 'ok',
          name: 'AI Landing Page System',
          version: '2.0.0',
          timestamp: new Date().toISOString(),
        });
      }

      return errorResponse('Not Found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return errorResponse(`Internal Server Error: ${e.message}`, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
