-- AI Landing Page System - Database Schema
-- Run this in Cloudflare D1 to initialize the database

-- Pages table
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
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
  noindex INTEGER DEFAULT 0,
  template TEXT DEFAULT 'default',
  views INTEGER DEFAULT 0,
  indexed INTEGER DEFAULT 0,
  indexed_at TEXT,
  has_password INTEGER DEFAULT 0,
  password_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_lang ON pages(lang);

-- RPA Tasks table
CREATE TABLE IF NOT EXISTS rpa_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  cron_expr TEXT DEFAULT '0 2 * * *',
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused')),
  last_run TEXT,
  next_run TEXT,
  run_count INTEGER DEFAULT 0,
  last_result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT DEFAULT 'admin',
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- System Config table
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

-- Default system config
INSERT OR IGNORE INTO system_config (key, value) VALUES
  ('site_url', ''),
  ('site_name', 'AI Landing Page System'),
  ('admin_email', ''),
  ('whatsapp_number', ''),
  ('google_analytics_id', ''),
  ('facebook_pixel_id', ''),
  ('default_lang', 'zh'),
  ('default_country', 'CN'),
  ('auto_index', '1'),
  ('footer_text', '');

-- Default RPA Tasks
INSERT OR IGNORE INTO rpa_tasks (name, type, config, cron_expr, status) VALUES
  ('每日自动提交Google收录', 'submit_sitemap', '{}', '0 3 * * *', 'active'),
  ('每日自动发布草稿', 'auto_publish', '{"max_publish": 5}', '0 2 * * *', 'paused'),
  ('死链检测', 'dead_link_check', '{}', '0 4 * * 1', 'active');
