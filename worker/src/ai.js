/**
 * AI Landing Page Generation Module
 * POST /api/ai/generate       → generate single landing page
 * POST /api/ai/batch-generate → batch generate multiple pages
 * GET  /api/ai/templates      → list available templates
 */

import { jsonResponse, errorResponse, generateSlug, logAudit } from './utils.js';

export async function handleAI(request, env, path) {
  if (path === '/api/ai/generate' && request.method === 'POST') {
    return await generatePage(request, env);
  }
  if (path === '/api/ai/batch-generate' && request.method === 'POST') {
    return await batchGenerate(request, env);
  }
  if (path === '/api/ai/templates' && request.method === 'GET') {
    return jsonResponse(TEMPLATES);
  }
  return errorResponse('Not Found', 404);
}

// ─── Templates ─────────────────────────────────────────────────────────────
const TEMPLATES = [
  { id: 'law-firm', name: '律师事务所', category: 'legal', description: '专业法律服务落地页' },
  { id: 'immigration', name: '移民服务', category: 'legal', description: '移民咨询服务落地页' },
  { id: 'consulting', name: '商务咨询', category: 'business', description: '商务顾问服务落地页' },
  { id: 'saas', name: 'SaaS 产品', category: 'tech', description: '软件产品推广落地页' },
  { id: 'ecommerce', name: '电商产品', category: 'ecommerce', description: '产品销售落地页' },
  { id: 'local-service', name: '本地服务', category: 'local', description: '本地商家服务落地页' },
  { id: 'education', name: '教育培训', category: 'education', description: '课程培训落地页' },
  { id: 'healthcare', name: '医疗健康', category: 'health', description: '医疗健康服务落地页' },
];

// ─── Single Page Generation ────────────────────────────────────────────────
async function generatePage(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const {
    business_name,
    business_type = 'law-firm',
    service = '法律咨询',
    city = '上海',
    country = 'CN',
    lang = 'zh',
    keywords = '',
    phone = '',
    email = '',
    address = '',
    template = 'law-firm',
    save = true,
    custom_prompt = ''
  } = body;

  if (!business_name) return errorResponse('business_name 不能为空', 400);

  const prompt = custom_prompt || buildPrompt({
    business_name, business_type, service, city, country, lang, keywords, phone, email, address, template
  });

  let htmlContent;
  try {
    htmlContent = await callAI(env, prompt, business_name, service, city, lang, template);
  } catch (e) {
    return errorResponse('AI 生成失败: ' + e.message, 500);
  }

  const slug = generateSlug(`${business_name}-${service}-${city}`);
  const title = `${business_name} - ${service} - ${city}`;

  if (save) {
    try {
      const result = await env.DB.prepare(`
        INSERT INTO pages (slug, title, html_content, keywords, description, meta_title, meta_desc,
          lang, country, city, status, noindex, template, views, indexed, has_password,
          created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, 0, 0, 0, datetime('now'), datetime('now'))
      `).bind(
        slug, title, htmlContent,
        keywords || `${service},${city},${business_name}`,
        `${business_name}专业提供${service}服务，服务${city}及周边地区`,
        title,
        `${business_name}提供专业${service}，${city}本地服务，立即咨询`,
        lang, country, city, template
      ).run();

      await logAudit(env, 'AI_GENERATE', `slug: ${slug}`);
      return jsonResponse({ slug, title, id: result.meta?.last_row_id, preview_url: `/p/${slug}` }, 201);
    } catch (e) {
      return errorResponse('保存失败: ' + e.message, 500);
    }
  }

  return jsonResponse({ slug, title, html_content: htmlContent });
}

// ─── Batch Generation ──────────────────────────────────────────────────────
async function batchGenerate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const { items, template = 'law-firm', lang = 'zh' } = body;
  if (!Array.isArray(items) || items.length === 0) return errorResponse('items 不能为空', 400);
  if (items.length > 20) return errorResponse('单次批量最多20条', 400);

  const results = [];
  for (const item of items) {
    try {
      const fakeRequest = new Request('https://worker/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, template, lang, save: true })
      });
      const res = await generatePage(fakeRequest, env);
      const data = await res.json();
      results.push({ ...item, ...data, success: res.status < 400 });
    } catch (e) {
      results.push({ ...item, success: false, error: e.message });
    }
  }

  await logAudit(env, 'BATCH_GENERATE', `count: ${items.length}, success: ${results.filter(r => r.success).length}`);
  return jsonResponse({ results, total: items.length, success: results.filter(r => r.success).length });
}

// ─── AI Prompt Builder ─────────────────────────────────────────────────────
function buildPrompt({ business_name, service, city, country, lang, keywords, phone, email, address, template }) {
  const langMap = { zh: '中文', en: 'English', ja: '日本語', ko: '한국어', es: 'Español' };
  const langName = langMap[lang] || '中文';

  return `你是一位专业的SEO落地页设计师和前端开发者。请为以下业务生成一个完整的、高质量的HTML落地页。

业务信息：
- 公司名称：${business_name}
- 服务类型：${service}
- 所在城市：${city}
- 国家/地区：${country}
- 页面语言：${langName}
- 关键词：${keywords || service + ',' + city}
- 联系电话：${phone || '请填写电话'}
- 邮箱：${email || '请填写邮箱'}
- 地址：${address || city + '市中心'}

要求：
1. 生成完整的单文件HTML（包含内联CSS和JS）
2. 现代化响应式设计，适配手机和电脑
3. 包含以下SEO元素：
   - 完整的TDK（title、description、keywords）
   - H1/H2/H3标签层级结构
   - LocalBusiness JSON-LD结构化数据
   - Open Graph标签
   - Hreflang标签（如适用）
   - Canonical URL
4. 页面内容包含：
   - 专业导航栏（含Logo文字和联系按钮）
   - Hero区域（大标题、副标题、CTA按钮）
   - 服务特色（3-6个服务亮点卡片）
   - 关于我们（简介段落）
   - FAQ常见问题（5个问答，使用FAQ Schema）
   - 联系方式（电话、邮箱、地址）
   - 页脚（版权信息、隐私政策链接）
5. 颜色方案：专业商务风格，主色调蓝色系或深色系
6. 包含WhatsApp咨询按钮（悬浮右下角）
7. 图片使用Unsplash随机图片URL（相关主题）
8. 不要使用外部CSS框架，全部内联样式
9. 防重复内容：使用独特的文案描述，避免模板化

只输出完整的HTML代码，不要任何解释文字。`;
}

// ─── AI Call ───────────────────────────────────────────────────────────────
async function callAI(env, prompt, business_name, service, city, lang, template) {
  // Try Workers AI first (if available)
  if (env.AI) {
    try {
      const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: '你是专业的SEO落地页生成器，只输出完整HTML代码。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4096
      });
      if (response?.response) return response.response;
    } catch (e) {
      console.error('Workers AI error:', e);
    }
  }

  // Fallback: generate template-based HTML
  return generateTemplateHTML({ business_name, service, city, lang, template });
}

// ─── Template-based HTML Generator (fallback) ─────────────────────────────
function generateTemplateHTML({ business_name, service, city, lang, template }) {
  const isEn = lang === 'en';
  const heroTitle = isEn
    ? `${business_name} - Professional ${service} in ${city}`
    : `${business_name} - ${city}专业${service}`;
  const heroSubtitle = isEn
    ? `Trusted by hundreds of clients in ${city}. Expert ${service} services tailored to your needs.`
    : `服务${city}数百客户，专业${service}，为您量身定制解决方案`;
  const ctaText = isEn ? 'Get Free Consultation' : '免费咨询';
  const colors = getTemplateColors(template);

  return `<!DOCTYPE html>
<html lang="${lang}" prefix="og: http://ogp.me/ns#">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${heroTitle}</title>
<meta name="description" content="${heroSubtitle}">
<meta name="keywords" content="${service},${city},${business_name}">
<meta property="og:title" content="${heroTitle}">
<meta property="og:description" content="${heroSubtitle}">
<meta property="og:type" content="website">
<link rel="canonical" href="">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "${business_name}",
  "description": "${heroSubtitle}",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "${city}"
  },
  "serviceArea": "${city}"
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "${isEn ? 'What services do you offer?' : '你们提供哪些服务？'}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${isEn ? `We provide comprehensive ${service} services in ${city}.` : `我们在${city}提供全面的${service}服务，包括咨询、规划和执行。`}"
      }
    },
    {
      "@type": "Question",
      "name": "${isEn ? 'How can I contact you?' : '如何联系你们？'}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${isEn ? 'You can reach us via phone, email, or the contact form on this page.' : '您可以通过电话、邮件或页面上的联系表单联系我们。'}"
      }
    },
    {
      "@type": "Question",
      "name": "${isEn ? 'Do you offer free consultations?' : '是否提供免费咨询？'}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${isEn ? 'Yes, we offer a free initial consultation for all new clients.' : '是的，我们为所有新客户提供免费初次咨询服务。'}"
      }
    },
    {
      "@type": "Question",
      "name": "${isEn ? `Are you based in ${city}?` : `你们在${city}有办公室吗？`}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${isEn ? `Yes, we are locally based in ${city} and serve clients throughout the region.` : `是的，我们在${city}设有办公室，服务本地及周边客户。`}"
      }
    },
    {
      "@type": "Question",
      "name": "${isEn ? 'What makes you different?' : '你们有什么优势？'}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${isEn ? `Our team brings years of experience in ${service}, with a client-first approach and proven results.` : `我们团队拥有多年${service}经验，以客户为中心，成果有目共睹。`}"
      }
    }
  ]
}
</script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --primary: ${colors.primary};
    --secondary: ${colors.secondary};
    --accent: ${colors.accent};
    --text: #1a1a2e;
    --text-light: #6b7280;
    --bg: #ffffff;
    --bg-alt: #f8fafc;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: var(--text); line-height: 1.6; }
  a { color: var(--primary); text-decoration: none; }
  img { max-width: 100%; height: auto; }
  .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }

  /* Nav */
  nav { background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); position: sticky; top: 0; z-index: 100; }
  .nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; max-width: 1200px; margin: 0 auto; }
  .logo { font-size: 20px; font-weight: 700; color: var(--primary); }
  .nav-cta { background: var(--primary); color: white; padding: 10px 24px; border-radius: 8px; font-weight: 600; transition: opacity 0.2s; }
  .nav-cta:hover { opacity: 0.9; color: white; }

  /* Hero */
  .hero { background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%); color: white; padding: 100px 20px; text-align: center; }
  .hero h1 { font-size: clamp(28px, 5vw, 52px); font-weight: 800; margin-bottom: 20px; line-height: 1.2; }
  .hero p { font-size: clamp(16px, 2vw, 20px); opacity: 0.9; max-width: 600px; margin: 0 auto 32px; }
  .hero-btns { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
  .btn-primary { background: white; color: var(--primary); padding: 14px 32px; border-radius: 50px; font-weight: 700; font-size: 16px; transition: transform 0.2s; }
  .btn-primary:hover { transform: translateY(-2px); color: var(--primary); }
  .btn-outline { border: 2px solid white; color: white; padding: 14px 32px; border-radius: 50px; font-weight: 600; font-size: 16px; transition: all 0.2s; }
  .btn-outline:hover { background: white; color: var(--primary); }

  /* Features */
  .features { padding: 80px 20px; background: var(--bg-alt); }
  .section-title { text-align: center; font-size: clamp(24px, 3vw, 36px); font-weight: 700; margin-bottom: 12px; }
  .section-sub { text-align: center; color: var(--text-light); margin-bottom: 48px; font-size: 16px; }
  .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
  .feature-card { background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); transition: transform 0.2s; }
  .feature-card:hover { transform: translateY(-4px); }
  .feature-icon { font-size: 40px; margin-bottom: 16px; }
  .feature-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: var(--text); }
  .feature-card p { color: var(--text-light); font-size: 14px; line-height: 1.7; }

  /* About */
  .about { padding: 80px 20px; }
  .about-inner { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
  @media (max-width: 768px) { .about-inner { grid-template-columns: 1fr; } }
  .about img { border-radius: 16px; width: 100%; height: 350px; object-fit: cover; }
  .about h2 { font-size: clamp(22px, 3vw, 32px); font-weight: 700; margin-bottom: 16px; }
  .about p { color: var(--text-light); line-height: 1.8; margin-bottom: 16px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; }
  .stat { text-align: center; }
  .stat-num { font-size: 28px; font-weight: 800; color: var(--primary); }
  .stat-label { font-size: 12px; color: var(--text-light); }

  /* FAQ */
  .faq { padding: 80px 20px; background: var(--bg-alt); }
  .faq-list { max-width: 800px; margin: 0 auto; }
  .faq-item { background: white; border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
  .faq-q { padding: 20px 24px; font-weight: 600; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .faq-q:hover { background: var(--bg-alt); }
  .faq-a { padding: 0 24px 20px; color: var(--text-light); line-height: 1.7; display: none; }
  .faq-item.open .faq-a { display: block; }
  .faq-item.open .faq-arrow { transform: rotate(180deg); }
  .faq-arrow { transition: transform 0.2s; font-size: 12px; }

  /* Contact */
  .contact { padding: 80px 20px; }
  .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; }
  @media (max-width: 768px) { .contact-grid { grid-template-columns: 1fr; } }
  .contact h2 { font-size: clamp(22px, 3vw, 32px); font-weight: 700; margin-bottom: 24px; }
  .contact-info { display: flex; flex-direction: column; gap: 16px; }
  .contact-item { display: flex; align-items: center; gap: 12px; }
  .contact-icon { width: 40px; height: 40px; background: var(--bg-alt); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
  .contact-form { display: flex; flex-direction: column; gap: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-weight: 600; font-size: 14px; }
  .form-group input, .form-group textarea, .form-group select {
    padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 15px;
    outline: none; transition: border-color 0.2s; font-family: inherit;
  }
  .form-group input:focus, .form-group textarea:focus { border-color: var(--primary); }
  .form-group textarea { min-height: 120px; resize: vertical; }
  .submit-btn { background: var(--primary); color: white; padding: 14px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
  .submit-btn:hover { opacity: 0.9; }

  /* Footer */
  footer { background: #1a1a2e; color: #9ca3af; padding: 40px 20px; text-align: center; }
  .footer-links { display: flex; justify-content: center; gap: 24px; margin-bottom: 16px; flex-wrap: wrap; }
  .footer-links a { color: #9ca3af; font-size: 14px; }
  .footer-links a:hover { color: white; }
  footer p { font-size: 13px; }

  /* WhatsApp Float */
  .wa-float { position: fixed; bottom: 24px; right: 24px; z-index: 999; }
  .wa-btn { width: 56px; height: 56px; background: #25d366; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(37,211,102,0.4); transition: transform 0.2s; }
  .wa-btn:hover { transform: scale(1.1); }
  .wa-btn svg { width: 28px; height: 28px; fill: white; }

  @media (max-width: 768px) {
    .hero { padding: 60px 20px; }
    .features, .about, .faq, .contact { padding: 60px 20px; }
    .stats { grid-template-columns: repeat(3, 1fr); }
  }
</style>
</head>
<body>

<nav>
  <div class="nav-inner">
    <div class="logo">${business_name}</div>
    <a href="#contact" class="nav-cta">${ctaText}</a>
  </div>
</nav>

<section class="hero">
  <div class="container">
    <h1>${heroTitle}</h1>
    <p>${heroSubtitle}</p>
    <div class="hero-btns">
      <a href="#contact" class="btn-primary">${ctaText}</a>
      <a href="#features" class="btn-outline">${isEn ? 'Learn More' : '了解更多'}</a>
    </div>
  </div>
</section>

<section class="features" id="features">
  <div class="container">
    <h2 class="section-title">${isEn ? 'Our Services' : '我们的服务'}</h2>
    <p class="section-sub">${isEn ? `Professional ${service} solutions for your needs` : `专业${service}解决方案，满足您的需求`}</p>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">⚖️</div>
        <h3>${isEn ? 'Expert Consultation' : '专业咨询'}</h3>
        <p>${isEn ? `Our experienced team provides expert ${service} consultation tailored to your specific situation.` : `我们经验丰富的团队提供专业的${service}咨询，针对您的具体情况量身定制。`}</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🎯</div>
        <h3>${isEn ? 'Customized Solutions' : '定制方案'}</h3>
        <p>${isEn ? `Every client is unique. We develop personalized strategies that align with your goals.` : `每位客户都是独特的。我们制定与您目标一致的个性化策略。`}</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🛡️</div>
        <h3>${isEn ? 'Full Support' : '全程支持'}</h3>
        <p>${isEn ? `From initial consultation to final resolution, we support you every step of the way.` : `从初次咨询到最终解决，我们全程陪伴您每一步。`}</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3>${isEn ? 'Fast Response' : '快速响应'}</h3>
        <p>${isEn ? `We understand urgency. Our team responds promptly to all inquiries within 24 hours.` : `我们理解紧迫性。我们的团队在24小时内及时响应所有咨询。`}</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🌍</div>
        <h3>${isEn ? `Local ${city} Expertise` : `${city}本地专家`}</h3>
        <p>${isEn ? `Deep knowledge of local regulations and market conditions in ${city}.` : `深入了解${city}当地法规和市场情况。`}</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">✅</div>
        <h3>${isEn ? 'Proven Results' : '成果显著'}</h3>
        <p>${isEn ? `Track record of successful outcomes for hundreds of satisfied clients.` : `数百名满意客户的成功案例，成果有目共睹。`}</p>
      </div>
    </div>
  </div>
</section>

<section class="about" id="about">
  <div class="container">
    <div class="about-inner">
      <img src="https://images.unsplash.com/photo-1521791136064-7986c2920216?w=600&auto=format&fit=crop" alt="${business_name}" loading="lazy">
      <div>
        <h2>${isEn ? `About ${business_name}` : `关于${business_name}`}</h2>
        <p>${isEn
          ? `${business_name} is a leading provider of ${service} services in ${city}. With years of experience and a dedicated team of professionals, we have helped hundreds of clients achieve their goals.`
          : `${business_name}是${city}领先的${service}服务提供商。凭借多年经验和专业团队，我们已帮助数百名客户实现目标。`}</p>
        <p>${isEn
          ? `Our commitment to excellence, integrity, and client satisfaction sets us apart. We combine deep expertise with personalized attention to deliver outstanding results.`
          : `我们对卓越、诚信和客户满意度的承诺使我们与众不同。我们将深厚的专业知识与个性化关注相结合，提供卓越成果。`}</p>
        <div class="stats">
          <div class="stat"><div class="stat-num">500+</div><div class="stat-label">${isEn ? 'Clients' : '服务客户'}</div></div>
          <div class="stat"><div class="stat-num">10+</div><div class="stat-label">${isEn ? 'Years' : '年经验'}</div></div>
          <div class="stat"><div class="stat-num">98%</div><div class="stat-label">${isEn ? 'Satisfaction' : '满意率'}</div></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="faq" id="faq">
  <div class="container">
    <h2 class="section-title">${isEn ? 'Frequently Asked Questions' : '常见问题'}</h2>
    <p class="section-sub">${isEn ? 'Everything you need to know' : '您需要了解的一切'}</p>
    <div class="faq-list">
      <div class="faq-item open">
        <div class="faq-q">${isEn ? 'What services do you offer?' : '你们提供哪些服务？'}<span class="faq-arrow">▼</span></div>
        <div class="faq-a">${isEn ? `We provide comprehensive ${service} services in ${city}, including consultation, planning, and execution.` : `我们在${city}提供全面的${service}服务，包括咨询、规划和执行。`}</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">${isEn ? 'How can I contact you?' : '如何联系你们？'}<span class="faq-arrow">▼</span></div>
        <div class="faq-a">${isEn ? 'You can reach us via phone, email, or the contact form below.' : '您可以通过电话、邮件或下方联系表单联系我们。'}</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">${isEn ? 'Do you offer free consultations?' : '是否提供免费咨询？'}<span class="faq-arrow">▼</span></div>
        <div class="faq-a">${isEn ? 'Yes, we offer a free initial consultation for all new clients.' : '是的，我们为所有新客户提供免费初次咨询服务。'}</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">${isEn ? `Are you based in ${city}?` : `你们在${city}有办公室吗？`}<span class="faq-arrow">▼</span></div>
        <div class="faq-a">${isEn ? `Yes, we are locally based in ${city}.` : `是的，我们在${city}设有办公室，服务本地及周边客户。`}</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">${isEn ? 'What makes you different?' : '你们有什么优势？'}<span class="faq-arrow">▼</span></div>
        <div class="faq-a">${isEn ? `Our team brings years of experience in ${service} with a client-first approach.` : `我们团队拥有多年${service}经验，以客户为中心，成果有目共睹。`}</div>
      </div>
    </div>
  </div>
</section>

<section class="contact" id="contact">
  <div class="container">
    <h2 class="section-title">${isEn ? 'Contact Us' : '联系我们'}</h2>
    <p class="section-sub">${isEn ? 'Get in touch for a free consultation' : '立即联系，获取免费咨询'}</p>
    <div class="contact-grid">
      <div>
        <div class="contact-info">
          <div class="contact-item">
            <div class="contact-icon">📍</div>
            <div><strong>${isEn ? 'Address' : '地址'}</strong><br>${city}</div>
          </div>
          <div class="contact-item">
            <div class="contact-icon">📞</div>
            <div><strong>${isEn ? 'Phone' : '电话'}</strong><br>${isEn ? 'Please call us' : '请致电咨询'}</div>
          </div>
          <div class="contact-item">
            <div class="contact-icon">✉️</div>
            <div><strong>${isEn ? 'Email' : '邮箱'}</strong><br>${isEn ? 'Send us an email' : '发送邮件咨询'}</div>
          </div>
          <div class="contact-item">
            <div class="contact-icon">🕒</div>
            <div><strong>${isEn ? 'Hours' : '工作时间'}</strong><br>${isEn ? 'Mon-Fri 9am-6pm' : '周一至周五 9:00-18:00'}</div>
          </div>
        </div>
      </div>
      <form class="contact-form" onsubmit="handleSubmit(event)">
        <div class="form-group">
          <label>${isEn ? 'Your Name' : '您的姓名'}</label>
          <input type="text" placeholder="${isEn ? 'Full Name' : '请输入姓名'}" required>
        </div>
        <div class="form-group">
          <label>${isEn ? 'Phone / Email' : '电话/邮箱'}</label>
          <input type="text" placeholder="${isEn ? 'Contact info' : '请输入联系方式'}" required>
        </div>
        <div class="form-group">
          <label>${isEn ? 'Message' : '咨询内容'}</label>
          <textarea placeholder="${isEn ? 'Describe your needs...' : '请描述您的需求...'}" required></textarea>
        </div>
        <button type="submit" class="submit-btn">${isEn ? 'Send Message' : '发送咨询'}</button>
      </form>
    </div>
  </div>
</section>

<footer>
  <div class="footer-links">
    <a href="#">${isEn ? 'Privacy Policy' : '隐私政策'}</a>
    <a href="#">${isEn ? 'Terms of Service' : '服务条款'}</a>
    <a href="#">${isEn ? 'Disclaimer' : '免责声明'}</a>
    <a href="#contact">${isEn ? 'Contact' : '联系我们'}</a>
  </div>
  <p>© ${new Date().getFullYear()} ${business_name}. ${isEn ? 'All rights reserved.' : '版权所有。'}</p>
</footer>

<div class="wa-float">
  <a href="https://wa.me/" class="wa-btn" target="_blank" rel="noopener" aria-label="WhatsApp">
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  </a>
</div>

<script>
  // FAQ accordion
  document.querySelectorAll('.faq-q').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.parentElement;
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });

  // Form submit
  function handleSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('.submit-btn');
    btn.textContent = '${isEn ? 'Sent! ✓' : '已发送 ✓'}';
    btn.style.background = '#10b981';
    setTimeout(() => {
      btn.textContent = '${isEn ? 'Send Message' : '发送咨询'}';
      btn.style.background = '';
      e.target.reset();
    }, 3000);
  }

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
    });
  });
</script>
</body>
</html>`;
}

function getTemplateColors(template) {
  const colorMap = {
    'law-firm':    { primary: '#1e3a5f', secondary: '#2d5986', accent: '#c9a84c' },
    'immigration': { primary: '#1a4731', secondary: '#2d6a4f', accent: '#74c69d' },
    'consulting':  { primary: '#1e293b', secondary: '#334155', accent: '#3b82f6' },
    'saas':        { primary: '#4f46e5', secondary: '#7c3aed', accent: '#06b6d4' },
    'ecommerce':   { primary: '#dc2626', secondary: '#b91c1c', accent: '#f59e0b' },
    'local-service': { primary: '#0369a1', secondary: '#0284c7', accent: '#38bdf8' },
    'education':   { primary: '#7c3aed', secondary: '#6d28d9', accent: '#f59e0b' },
    'healthcare':  { primary: '#0f766e', secondary: '#0d9488', accent: '#34d399' },
  };
  return colorMap[template] || colorMap['consulting'];
}
