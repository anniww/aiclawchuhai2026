/**
 * AI Landing Page Generation Module
 * Supports: Cloudflare Workers AI, OpenAI-compatible API
 * Features: GEO localization, SEO optimization, multi-language, multi-template
 */
import { jsonResponse, errorResponse, requireAuth, generateSlug, logAudit, getClientIP } from './utils.js';

// ─── GEO Language Map ────────────────────────────────────────────────────────
const GEO_CONFIG = {
  CN: { lang: 'zh', langName: '中文', currency: 'CNY', timezone: 'Asia/Shanghai' },
  US: { lang: 'en', langName: 'English', currency: 'USD', timezone: 'America/New_York' },
  GB: { lang: 'en', langName: 'English', currency: 'GBP', timezone: 'Europe/London' },
  DE: { lang: 'de', langName: 'Deutsch', currency: 'EUR', timezone: 'Europe/Berlin' },
  FR: { lang: 'fr', langName: 'Français', currency: 'EUR', timezone: 'Europe/Paris' },
  JP: { lang: 'ja', langName: '日本語', currency: 'JPY', timezone: 'Asia/Tokyo' },
  KR: { lang: 'ko', langName: '한국어', currency: 'KRW', timezone: 'Asia/Seoul' },
  ES: { lang: 'es', langName: 'Español', currency: 'EUR', timezone: 'Europe/Madrid' },
  BR: { lang: 'pt', langName: 'Português', currency: 'BRL', timezone: 'America/Sao_Paulo' },
  AU: { lang: 'en', langName: 'English', currency: 'AUD', timezone: 'Australia/Sydney' },
  CA: { lang: 'en', langName: 'English', currency: 'CAD', timezone: 'America/Toronto' },
  IN: { lang: 'en', langName: 'English', currency: 'INR', timezone: 'Asia/Kolkata' },
  SG: { lang: 'en', langName: 'English', currency: 'SGD', timezone: 'Asia/Singapore' },
  HK: { lang: 'zh', langName: '繁體中文', currency: 'HKD', timezone: 'Asia/Hong_Kong' },
  TW: { lang: 'zh', langName: '繁體中文', currency: 'TWD', timezone: 'Asia/Taipei' },
  TH: { lang: 'th', langName: 'ภาษาไทย', currency: 'THB', timezone: 'Asia/Bangkok' },
  VN: { lang: 'vi', langName: 'Tiếng Việt', currency: 'VND', timezone: 'Asia/Ho_Chi_Minh' },
  MY: { lang: 'ms', langName: 'Bahasa Melayu', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur' },
  ID: { lang: 'id', langName: 'Bahasa Indonesia', currency: 'IDR', timezone: 'Asia/Jakarta' },
  AE: { lang: 'ar', langName: 'العربية', currency: 'AED', timezone: 'Asia/Dubai' },
  SA: { lang: 'ar', langName: 'العربية', currency: 'SAR', timezone: 'Asia/Riyadh' },
  MX: { lang: 'es', langName: 'Español', currency: 'MXN', timezone: 'America/Mexico_City' },
  RU: { lang: 'ru', langName: 'Русский', currency: 'RUB', timezone: 'Europe/Moscow' },
  IT: { lang: 'it', langName: 'Italiano', currency: 'EUR', timezone: 'Europe/Rome' },
  NL: { lang: 'nl', langName: 'Nederlands', currency: 'EUR', timezone: 'Europe/Amsterdam' },
  PL: { lang: 'pl', langName: 'Polski', currency: 'PLN', timezone: 'Europe/Warsaw' },
  TR: { lang: 'tr', langName: 'Türkçe', currency: 'TRY', timezone: 'Europe/Istanbul' },
  ZA: { lang: 'en', langName: 'English', currency: 'ZAR', timezone: 'Africa/Johannesburg' },
  NG: { lang: 'en', langName: 'English', currency: 'NGN', timezone: 'Africa/Lagos' },
  EG: { lang: 'ar', langName: 'العربية', currency: 'EGP', timezone: 'Africa/Cairo' },
  PK: { lang: 'ur', langName: 'اردو', currency: 'PKR', timezone: 'Asia/Karachi' },
  BD: { lang: 'bn', langName: 'বাংলা', currency: 'BDT', timezone: 'Asia/Dhaka' },
};

// ─── Industry Templates ──────────────────────────────────────────────────────
const INDUSTRY_TEMPLATES = {
  legal: { name: '法律服务', icon: '⚖️', keywords: ['律师', '法律咨询', '法律援助', '诉讼', '合同'] },
  medical: { name: '医疗健康', icon: '🏥', keywords: ['医院', '诊所', '医生', '健康', '医疗'] },
  ecommerce: { name: '电商零售', icon: '🛒', keywords: ['购物', '优惠', '折扣', '快递', '正品'] },
  education: { name: '教育培训', icon: '📚', keywords: ['课程', '培训', '学习', '考试', '证书'] },
  finance: { name: '金融理财', icon: '💰', keywords: ['投资', '理财', '贷款', '保险', '基金'] },
  realestate: { name: '房产中介', icon: '🏠', keywords: ['房屋', '租房', '买房', '二手房', '新房'] },
  travel: { name: '旅游酒店', icon: '✈️', keywords: ['旅游', '酒店', '机票', '景点', '行程'] },
  restaurant: { name: '餐饮美食', icon: '🍜', keywords: ['美食', '餐厅', '外卖', '菜单', '预订'] },
  beauty: { name: '美容美发', icon: '💄', keywords: ['美容', '护肤', '美发', '造型', '美甲'] },
  tech: { name: '科技软件', icon: '💻', keywords: ['软件', '应用', '技术', '开发', '解决方案'] },
  fitness: { name: '健身运动', icon: '💪', keywords: ['健身', '运动', '减肥', '塑形', '教练'] },
  pet: { name: '宠物服务', icon: '🐾', keywords: ['宠物', '狗', '猫', '宠物医院', '宠物用品'] },
  wedding: { name: '婚庆婚礼', icon: '💍', keywords: ['婚礼', '婚庆', '婚纱', '婚宴', '策划'] },
  cleaning: { name: '家政清洁', icon: '🧹', keywords: ['保洁', '家政', '清洁', '上门服务', '家庭'] },
  logistics: { name: '物流快递', icon: '📦', keywords: ['物流', '快递', '运输', '仓储', '配送'] },
  default: { name: '通用服务', icon: '🌟', keywords: ['服务', '专业', '优质', '品牌', '口碑'] },
};

export async function handleAI(request, env, path) {
  // Auth check for all AI endpoints
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  if (path === '/api/ai/generate' && request.method === 'POST') return handleGenerate(request, env, auth.user);
  if (path === '/api/ai/batch-generate' && request.method === 'POST') return handleBatchGenerate(request, env, auth.user);
  if (path === '/api/ai/optimize' && request.method === 'POST') return handleOptimize(request, env, auth.user);
  if (path === '/api/ai/keywords' && request.method === 'POST') return handleKeywords(request, env, auth.user);
  if (path === '/api/ai/templates' && request.method === 'GET') return jsonResponse(Object.entries(INDUSTRY_TEMPLATES).map(([k,v]) => ({ id: k, ...v })));
  if (path === '/api/ai/geo-config' && request.method === 'GET') return jsonResponse(Object.entries(GEO_CONFIG).map(([k,v]) => ({ country: k, ...v })));
  if (path === '/api/ai/suggest-keywords' && request.method === 'POST') return handleSuggestKeywords(request, env, auth.user);
  if (path === '/api/ai/write-assist' && request.method === 'POST') return handleWriteAssist(request, env, auth.user);
  if (path === '/api/ai/presets' && request.method === 'GET') return handleGetPresets(request, env);
  if (path === '/api/seo/status' && request.method === 'GET') return handleSEOStatus(request, env);
  if (path === '/api/seo/submit-all' && request.method === 'POST') return handleSEOSubmitAll(request, env, auth.user);
  if (path === '/api/seo/submit-url' && request.method === 'POST') return handleSEOSubmitUrl(request, env, auth.user);
  return errorResponse('Not Found', 404);
}

async function callAI(env, prompt, systemPrompt = '') {
  // Try OpenAI-compatible API first (via env.OPENAI_API_KEY)
  if (env.OPENAI_API_KEY) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt || 'You are an expert SEO copywriter and web developer.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 4000,
          temperature: 0.7,
        }),
      });
      const data = await resp.json();
      if (data.choices && data.choices[0]) return data.choices[0].message.content;
    } catch (e) { console.error('OpenAI error:', e); }
  }

  // Fallback: Cloudflare Workers AI
  if (env.AI) {
    try {
      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });
      const resp = await env.AI.run('@cf/meta/llama-3-8b-instruct', { messages, max_tokens: 3000 });
      return resp.response || '';
    } catch (e) { console.error('Workers AI error:', e); }
  }

  throw new Error('No AI service available. Please configure OPENAI_API_KEY or enable Workers AI.');
}

async function handleGenerate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }

  const {
    title, keywords = '', industry = 'default', country = 'CN', city = '',
    lang, template = 'modern', customPrompt = '', whatsapp = '',
    googleAnalyticsId = '', facebookPixelId = '', noindex = false,
    password = '', saveAsDraft = false
  } = body;

  if (!title) return errorResponse('标题不能为空', 400);

  const geo = GEO_CONFIG[country] || GEO_CONFIG['CN'];
  const pageLang = lang || geo.lang;
  const industryConfig = INDUSTRY_TEMPLATES[industry] || INDUSTRY_TEMPLATES['default'];

  const systemPrompt = `You are an expert SEO copywriter and web developer specializing in creating high-converting landing pages. 
You write in ${geo.langName} (${pageLang}) for the ${country} market.
You understand local culture, business practices, and consumer behavior in ${country}.
Always output complete, valid HTML with embedded CSS and JavaScript.`;

  const prompt = `Create a complete, professional, high-converting landing page HTML for the following:

Title: ${title}
Industry: ${industryConfig.name}
Target Country: ${country}
Target City: ${city || 'nationwide'}
Language: ${geo.langName} (${pageLang})
Keywords: ${keywords || industryConfig.keywords.join(', ')}
Template Style: ${template}
${customPrompt ? `Additional Requirements: ${customPrompt}` : ''}

Requirements:
1. Complete HTML5 document with embedded CSS (modern, responsive, mobile-first design)
2. SEO optimized: proper title, meta description, H1-H6 hierarchy, alt tags
3. Schema.org LocalBusiness structured data in JSON-LD
4. GEO localization: local currency (${geo.currency}), phone format, address format for ${country}
5. FAQ section with 5+ relevant questions in ${geo.langName}
6. Call-to-action buttons (WhatsApp: ${whatsapp || '+1234567890'}, contact form)
7. Hreflang tag for ${pageLang}-${country.toLowerCase()}
8. Fast loading: lazy images, minimal external dependencies
9. Trust signals: testimonials, certifications, guarantees
10. Footer with legal pages (Privacy Policy, Terms of Service)
${city ? `11. Local SEO: mention ${city} prominently, include map embed placeholder` : ''}
${googleAnalyticsId ? `12. Google Analytics 4: ${googleAnalyticsId}` : ''}
${facebookPixelId ? `13. Facebook Pixel: ${facebookPixelId}` : ''}

Output ONLY the complete HTML document, no explanations.`;

  try {
    const html = await callAI(env, prompt, systemPrompt);

    // Extract meta info from generated HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const metaTitle = titleMatch ? titleMatch[1] : title;
    const metaDesc = descMatch ? descMatch[1] : `${title} - ${country} ${city}`;

    const slug = generateSlug(title);
    const status = saveAsDraft ? 'draft' : 'published';

    // Save to DB
    const result = await env.DB.prepare(`
      INSERT INTO pages (slug, title, html_content, keywords, description, meta_title, meta_desc, lang, country, city, status, noindex, template, has_password, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      slug, title, html, keywords, metaDesc, metaTitle, metaDesc,
      pageLang, country, city, status,
      noindex ? 1 : 0, template,
      password ? 1 : 0,
      password ? await sha256Simple(password) : null
    ).run();

    await logAudit(env, 'ai_generate', `AI生成落地页: ${title} [${country}/${pageLang}]`, user.username);

    return jsonResponse({
      success: true,
      slug,
      title,
      status,
      url: `/${slug}`,
      meta_title: metaTitle,
      meta_desc: metaDesc,
      lang: pageLang,
      country,
      html_preview: html.slice(0, 500) + '...',
    });
  } catch (e) {
    return errorResponse(`AI生成失败: ${e.message}`, 500);
  }
}

async function handleBatchGenerate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }

  const { items = [], defaultConfig = {} } = body;
  if (!items.length) return errorResponse('批量生成列表不能为空', 400);
  if (items.length > 20) return errorResponse('单次批量生成最多20条', 400);

  const results = [];
  for (const item of items) {
    try {
      const config = { ...defaultConfig, ...item };
      const geo = GEO_CONFIG[config.country || 'CN'] || GEO_CONFIG['CN'];
      const pageLang = config.lang || geo.lang;
      const industryConfig = INDUSTRY_TEMPLATES[config.industry || 'default'] || INDUSTRY_TEMPLATES['default'];

      const prompt = `Create a complete SEO-optimized landing page HTML for:
Title: ${config.title}
Industry: ${industryConfig.name}
Country: ${config.country || 'CN'}
City: ${config.city || ''}
Language: ${geo.langName}
Keywords: ${config.keywords || industryConfig.keywords.join(', ')}

Output ONLY complete HTML document.`;

      const html = await callAI(env, prompt);
      const slug = generateSlug(config.title);

      await env.DB.prepare(`
        INSERT INTO pages (slug, title, html_content, keywords, lang, country, city, status, template)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(slug, config.title, html, config.keywords || '', pageLang, config.country || 'CN', config.city || '', 'draft', config.template || 'modern').run();

      results.push({ success: true, slug, title: config.title, url: `/${slug}` });
    } catch (e) {
      results.push({ success: false, title: item.title, error: e.message });
    }
  }

  await logAudit(env, 'ai_batch_generate', `批量生成 ${results.length} 个落地页`, user.username);
  return jsonResponse({ success: true, total: results.length, results });
}

async function handleOptimize(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { html, html_content, optimization_type, type: bodyType, lang = 'zh' } = body;
  const type = bodyType || optimization_type || 'full';
  const htmlContent = html || html_content;
  if (!htmlContent) return errorResponse('HTML内容不能为空', 400);

  const typeMap = {
    full: '全面优化：改善SEO、提升转化率、优化文案、增强用户体验',
    seo: '专注SEO优化：改善标题、描述、关键词密度、内链结构',
    copy: '专注文案优化：使内容更有说服力、更吸引人、更专业',
    cta: '专注转化优化：改善CTA按钮、表单、信任信号',
  };

  const prompt = `${typeMap[type] || typeMap.full}以下HTML落地页内容（保持语言为${lang}）：

${htmlContent.slice(0, 8000)}

输出优化后的完整HTML，不要解释。`;

  try {
    const optimized = await callAI(env, prompt);
    return jsonResponse({ success: true, html: optimized, optimized_content: optimized });
  } catch (e) {
    return errorResponse(`优化失败: ${e.message}`, 500);
  }
}

async function handleKeywords(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { topic, country = 'CN', industry = 'default', count = 20 } = body;
  if (!topic) return errorResponse('主题不能为空', 400);

  const geo = GEO_CONFIG[country] || GEO_CONFIG['CN'];
  const prompt = `作为SEO专家，为以下主题生成${count}个高价值SEO关键词：
主题：${topic}
目标市场：${country}（${geo.langName}）
行业：${(INDUSTRY_TEMPLATES[industry] || INDUSTRY_TEMPLATES['default']).name}

要求：
1. 包含长尾关键词（3-5词）
2. 包含本地化关键词（含城市/地区）
3. 包含问题型关键词（如何、什么、为什么）
4. 按搜索意图分类（信息型/商业型/交易型）
5. 用JSON数组格式输出，每项包含：keyword, type(info/commercial/transactional), difficulty(low/medium/high), intent

只输出JSON数组，不要其他内容。`;

  try {
    const result = await callAI(env, prompt);
    let keywords;
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      keywords = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch { keywords = []; }
    return jsonResponse({ success: true, keywords, topic, country });
  } catch (e) {
    return errorResponse(`关键词生成失败: ${e.message}`, 500);
  }
}

// ─── New AI Functions ────────────────────────────────────────────────────────
async function handleSuggestKeywords(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { business_name = '', service_description = '', target_market = '', lang = 'zh' } = body;
  const prompt = `你是SEO关键词专家。\n业务：${business_name}\n描述：${service_description}\n市场：${target_market}\n\n生成20个精准SEO关键词，输出JSON数组，每项含：keyword, intent(搜索意图), competition(low/medium/high), score(1-10)\n只输出JSON数组。`;
  try {
    const result = await callAI(env, prompt);
    let keywords = [];
    try { const m = result.match(/\[[\s\S]*\]/); keywords = m ? JSON.parse(m[0]) : []; } catch {}
    return jsonResponse({ success: true, keywords });
  } catch (e) { return errorResponse(`关键词建议失败: ${e.message}`, 500); }
}

async function handleWriteAssist(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { section_title = '', section_type = 'description', context = '', tone = 'professional', lang = 'zh' } = body;
  const toneMap = { professional: '专业严谨', friendly: '亲切友好', persuasive: '说服力强', technical: '技术专业' };
  const typeMap = { description: '产品/服务描述', benefits: '优势列表', testimonial: '客户评价', cta: '行动号召' };
  const prompt = `你是营销文案写手。\n版块：${section_title}\n类型：${typeMap[section_type]||section_type}\n背景：${context}\n语气：${toneMap[tone]||tone}\n语言：${lang==='zh'?'中文':'English'}\n\n生成该版块的HTML片段（含h2/p/ul等标签），150-300字，只输出HTML片段。`;
  try {
    const content = await callAI(env, prompt);
    return jsonResponse({ success: true, content });
  } catch (e) { return errorResponse(`写作辅助失败: ${e.message}`, 500); }
}

async function handleGetPresets(request, env) {
  const presets = [
    { id: 'legal_cn', name: '中国法律服务', industry: 'legal', lang: 'zh', country: 'CN', template: 'professional' },
    { id: 'legal_us', name: 'US Immigration Law', industry: 'legal', lang: 'en', country: 'US', template: 'modern' },
    { id: 'medical_cn', name: '中国医疗健康', industry: 'medical', lang: 'zh', country: 'CN', template: 'clean' },
    { id: 'ecommerce_en', name: 'Global E-commerce', industry: 'ecommerce', lang: 'en', country: 'US', template: 'modern' },
    { id: 'education_cn', name: '教育培训机构', industry: 'education', lang: 'zh', country: 'CN', template: 'modern' },
    { id: 'finance_cn', name: '金融理财服务', industry: 'finance', lang: 'zh', country: 'CN', template: 'professional' },
    { id: 'realestate_cn', name: '房产中介', industry: 'realestate', lang: 'zh', country: 'CN', template: 'modern' },
    { id: 'tech_en', name: 'Tech & SaaS', industry: 'tech', lang: 'en', country: 'US', template: 'modern' },
    { id: 'beauty_cn', name: '美容美发', industry: 'beauty', lang: 'zh', country: 'CN', template: 'creative' },
    { id: 'fitness_en', name: 'Fitness & Gym', industry: 'fitness', lang: 'en', country: 'US', template: 'modern' },
    { id: 'travel_en', name: 'Travel & Tourism', industry: 'travel', lang: 'en', country: 'US', template: 'creative' },
    { id: 'restaurant_en', name: 'Restaurant & Food', industry: 'restaurant', lang: 'en', country: 'US', template: 'creative' },
  ];
  return jsonResponse({ success: true, presets });
}

async function handleSEOStatus(request, env) {
  try {
    const stats = await env.DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN indexed=1 THEN 1 ELSE 0 END) as indexed, SUM(CASE WHEN noindex=0 AND status='published' THEN 1 ELSE 0 END) as indexable, SUM(CASE WHEN noindex=1 THEN 1 ELSE 0 END) as noindex FROM pages`).first();
    return jsonResponse({ success: true, ...stats });
  } catch { return jsonResponse({ success: true, total: 0, indexed: 0, indexable: 0, noindex: 0 }); }
}

async function handleSEOSubmitAll(request, env, user) {
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) return errorResponse('Google API 凭证未配置', 500);
  const baseUrl = env.SITE_URL || 'https://aiclawchuhai.shop';
  const rows = await env.DB.prepare('SELECT id, slug FROM pages WHERE status="published" AND noindex=0 AND indexed=0 LIMIT 200').all();
  const pages = rows.results || [];
  if (!pages.length) return jsonResponse({ success: true, message: '无需提交', total: 0, success_count: 0, failed_count: 0 });
  let accessToken;
  try { accessToken = await getGoogleAccessToken(clientEmail, privateKey); } catch (e) { return errorResponse(`获取令牌失败: ${e.message}`, 500); }
  let successCount = 0, failedCount = 0;
  for (const page of pages) {
    try {
      const resp = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ url: `${baseUrl}/${page.slug}`, type: 'URL_UPDATED' }) });
      if (resp.ok) { await env.DB.prepare('UPDATE pages SET indexed=1, indexed_at=datetime("now") WHERE id=?').bind(page.id).run(); successCount++; } else { failedCount++; }
    } catch { failedCount++; }
  }
  return jsonResponse({ success: true, total: pages.length, success_count: successCount, failed_count: failedCount });
}

async function handleSEOSubmitUrl(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('请求格式错误', 400); }
  const { url } = body;
  if (!url) return errorResponse('URL不能为空', 400);
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) return errorResponse('Google API 凭证未配置', 500);
  let accessToken;
  try { accessToken = await getGoogleAccessToken(clientEmail, privateKey); } catch (e) { return errorResponse(`获取令牌失败: ${e.message}`, 500); }
  const resp = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ url, type: 'URL_UPDATED' }) });
  const data = await resp.json();
  if (!resp.ok) return errorResponse(data.error?.message || '提交失败', 400);
  return jsonResponse({ success: true, url, result: data });
}

async function sha256Simple(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
