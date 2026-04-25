/**
 * Enhanced AI Module with Optimization, Writing Assistance, Presets, and Keyword Suggestions
 * POST /api/ai/generate           → generate single landing page
 * POST /api/ai/optimize           → optimize existing HTML content
 * POST /api/ai/write-assist       → AI-assisted writing for sections
 * POST /api/ai/suggest-keywords   → suggest SEO keywords
 * GET  /api/ai/presets            → list AI prompt presets
 * GET  /api/ai/templates          → list available templates
 */
import { jsonResponse, errorResponse, generateSlug, logAudit } from './utils.js';

export async function handleAIEnhanced(request, env, path) {
  if (path === '/api/ai/generate' && request.method === 'POST') {
    return await generatePage(request, env);
  }
  if (path === '/api/ai/optimize' && request.method === 'POST') {
    return await optimizeContent(request, env);
  }
  if (path === '/api/ai/write-assist' && request.method === 'POST') {
    return await writeAssist(request, env);
  }
  if (path === '/api/ai/suggest-keywords' && request.method === 'POST') {
    return await suggestKeywords(request, env);
  }
  if (path === '/api/ai/presets' && request.method === 'GET') {
    return jsonResponse(AI_PRESETS);
  }
  if (path === '/api/ai/templates' && request.method === 'GET') {
    return jsonResponse(TEMPLATES);
  }
  return errorResponse('Not Found', 404);
}

// ─── AI Presets (Industry-specific prompt templates) ──────────────────────
const AI_PRESETS = [
  {
    id: 'law-firm-basic',
    name: '律师事务所 - 基础版',
    category: 'legal',
    description: '适用于小型律师事务所的基础落地页',
    prompt: `你是一位专业的律师事务所网页文案撰写专家。请基于以下信息生成一个专业的律师事务所落地页HTML代码：
- 业务名称：{business_name}
- 主要服务：{services}
- 服务城市：{city}
- 联系电话：{phone}

要求：
1. 包含专业的头部导航和英雄区域
2. 包含服务介绍、成功案例、团队介绍、客户评价等版块
3. 突出专业性和信任度
4. 包含明确的CTA按钮（立即咨询、预约服务等）
5. 响应式设计，适配移动设备
6. 包含完整的 Schema 结构化数据
7. SEO 友好的 Meta 标签和标题
8. 使用现代化的 CSS 样式，配色专业`
  },
  {
    id: 'law-firm-premium',
    name: '律师事务所 - 高级版',
    category: 'legal',
    description: '适用于大型律师事务所的高级落地页',
    prompt: `你是一位顶级的法律营销专家和网页设计师。请基于以下信息生成一个高端专业的律师事务所落地页HTML代码：
- 事务所名称：{business_name}
- 专业领域：{services}
- 服务范围：{city}
- 联系方式：{phone} / {email}
- 事务所规模：{firm_size}

要求：
1. 设计高端专业，体现大型事务所的实力
2. 包含完整的业务线介绍（民商事、刑事、行政等）
3. 展示资深律师团队和专业背景
4. 包含真实案例研究和成功率数据
5. 包含客户评价和行业认证
6. 包含详细的服务流程和收费说明
7. 包含在线预约系统和即时咨询功能
8. 完整的 SEO 优化和结构化数据
9. 支持多语言切换
10. 现代化的交互设计和动画效果`
  },
  {
    id: 'saas-product',
    name: 'SaaS 产品 - 标准版',
    category: 'tech',
    description: '适用于 SaaS 产品的推广落地页',
    prompt: `你是一位经验丰富的 SaaS 营销专家。请基于以下信息生成一个高转化率的 SaaS 产品落地页HTML代码：
- 产品名称：{business_name}
- 核心功能：{services}
- 目标用户：{target_audience}
- 定价：{pricing}

要求：
1. 包含吸引人的价值主张和英雄区域
2. 清晰展示产品的核心功能和优势
3. 包含功能对比表格
4. 包含用户评价和案例研究
5. 包含定价表和对比
6. 包含免费试用 CTA 按钮
7. 包含常见问题解答
8. 包含安全认证和合规信息
9. 响应式设计和快速加载
10. 包含集成和 API 文档链接`
  },
  {
    id: 'ecommerce-product',
    name: '电商产品 - 销售版',
    category: 'ecommerce',
    description: '适用于电商产品的销售落地页',
    prompt: `你是一位顶级的电商转化率优化专家。请基于以下信息生成一个高转化率的产品销售落地页HTML代码：
- 产品名称：{business_name}
- 产品特点：{services}
- 价格：{pricing}
- 库存状态：{inventory_status}

要求：
1. 包含高质量的产品图片和视频展示
2. 清晰的产品描述和规格说明
3. 包含用户评价和星级评分
4. 包含限时优惠和库存提示
5. 包含多种支付方式选项
6. 包含退货政策和保证
7. 包含相关产品推荐
8. 包含购物车和快速购买按钮
9. 包含配送信息和预计到达时间
10. 移动优先设计`
  },
  {
    id: 'local-service',
    name: '本地服务 - 标准版',
    category: 'local',
    description: '适用于本地服务商的落地页',
    prompt: `你是一位本地服务营销专家。请基于以下信息生成一个本地服务落地页HTML代码：
- 商家名称：{business_name}
- 服务类型：{services}
- 服务城市：{city}
- 营业时间：{business_hours}

要求：
1. 包含商家信息和位置地图
2. 包含营业时间和联系方式
3. 包含服务项目和价格
4. 包含客户评价和评分
5. 包含在线预约功能
6. 包含相关资质和认证
7. 包含周边环境和停车信息
8. 包含优惠活动和促销信息
9. 本地 SEO 优化（NAP 一致性）
10. 响应式设计`
  }
];

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

// ─── Generate Landing Page ────────────────────────────────────────────────
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
    preset_id = null,
    save = true,
    custom_prompt = ''
  } = body;

  if (!business_name) return errorResponse('business_name 不能为空', 400);

  let prompt = custom_prompt;
  if (!prompt && preset_id) {
    const preset = AI_PRESETS.find(p => p.id === preset_id);
    if (preset) {
      prompt = preset.prompt
        .replace('{business_name}', business_name)
        .replace('{services}', service)
        .replace('{city}', city)
        .replace('{phone}', phone)
        .replace('{email}', email);
    }
  }
  if (!prompt) {
    prompt = buildPrompt({
      business_name, business_type, service, city, country, lang, keywords, phone, email, address, template
    });
  }

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
      await logAudit(env, 'AI_GENERATE', `slug: ${slug}, preset: ${preset_id}`);
      return jsonResponse({ slug, title, id: result.meta?.last_row_id, preview_url: `/p/${slug}` }, 201);
    } catch (e) {
      return errorResponse('保存失败: ' + e.message, 500);
    }
  }

  return jsonResponse({ slug, title, html_content: htmlContent });
}

// ─── Optimize Existing Content ─────────────────────────────────────────────
async function optimizeContent(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const { html_content, optimization_type = 'general', lang = 'zh' } = body;
  if (!html_content) return errorResponse('html_content 不能为空', 400);

  const optimizationPrompts = {
    general: `请优化以下 HTML 落地页内容，提高可读性、专业性和转化率。保留所有 HTML 结构，只修改文本内容：\n\n${html_content}`,
    seo: `请优化以下 HTML 落地页的 SEO，改进标题、描述、关键词密度和内容结构。保留 HTML 结构：\n\n${html_content}`,
    copywriting: `请改进以下 HTML 落地页的文案，使其更具说服力和吸引力。保留 HTML 结构：\n\n${html_content}`,
    mobile: `请优化以下 HTML 落地页以适配移动设备，改进排版和交互。保留 HTML 结构：\n\n${html_content}`,
  };

  const prompt = optimizationPrompts[optimization_type] || optimizationPrompts.general;

  try {
    const optimized = await callAI(env, prompt, 'optimize', '', '', lang, '');
    await logAudit(env, 'AI_OPTIMIZE', `type: ${optimization_type}`);
    return jsonResponse({ optimized_content: optimized });
  } catch (e) {
    return errorResponse('优化失败: ' + e.message, 500);
  }
}

// ─── AI-Assisted Writing ───────────────────────────────────────────────────
async function writeAssist(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const { section_title, section_type = 'description', context = '', lang = 'zh', tone = 'professional' } = body;
  if (!section_title) return errorResponse('section_title 不能为空', 400);

  const toneDescriptions = {
    professional: '专业、正式、可信',
    friendly: '友好、亲切、易懂',
    persuasive: '说服力强、激励人心、行动导向',
    technical: '技术性强、准确、详细',
    casual: '轻松、随意、有趣'
  };

  const sectionPrompts = {
    description: `请为以下内容撰写一段专业的产品/服务描述（300-500字）：
标题：${section_title}
背景信息：${context}
语言：${lang}
语气：${toneDescriptions[tone]}

要求：
1. 清晰表达价值主张
2. 突出核心优势
3. 包含具体的数据或案例
4. 使用行动导向的语言
5. 适合落地页使用`,

    benefits: `请为以下内容撰写一个优势列表（5-8个要点）：
标题：${section_title}
背景信息：${context}
语言：${lang}
语气：${toneDescriptions[tone]}

要求：
1. 每个要点 20-50 字
2. 使用符号或编号列表格式
3. 突出用户获益
4. 使用具体的、可衡量的表述`,

    testimonial: `请为以下内容撰写一个客户评价（100-150字）：
标题：${section_title}
背景信息：${context}
语言：${lang}
语气：${toneDescriptions[tone]}

要求：
1. 包含客户名字和身份
2. 具体描述问题和解决方案
3. 包含数据或结果
4. 真实可信`,

    cta: `请为以下内容撰写一个行动号召文案（20-50字）：
标题：${section_title}
背景信息：${context}
语言：${lang}
语气：${toneDescriptions[tone]}

要求：
1. 简洁有力
2. 包含明确的行动
3. 创造紧迫感
4. 突出价值`
  };

  const prompt = sectionPrompts[section_type] || sectionPrompts.description;

  try {
    const content = await callAI(env, prompt, section_title, '', '', lang, '');
    await logAudit(env, 'AI_WRITE_ASSIST', `type: ${section_type}, title: ${section_title}`);
    return jsonResponse({ content, section_type, section_title });
  } catch (e) {
    return errorResponse('写作辅助失败: ' + e.message, 500);
  }
}

// ─── Suggest Keywords ──────────────────────────────────────────────────────
async function suggestKeywords(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const { business_name, service_description, target_market = '', lang = 'zh', count = 20 } = body;
  if (!business_name || !service_description) {
    return errorResponse('business_name 和 service_description 不能为空', 400);
  }

  const prompt = `你是一位 SEO 专家。请基于以下信息建议 ${count} 个高价值的 SEO 关键词（按搜索量和竞争度排序）：

业务名称：${business_name}
服务描述：${service_description}
目标市场：${target_market}
语言：${lang}

要求：
1. 返回 JSON 格式的关键词列表
2. 每个关键词包含：关键词、搜索意图、估计搜索量、竞争度、推荐指数
3. 包含短尾词、中尾词和长尾词的混合
4. 优先考虑本地化和行业特定的关键词
5. 避免过度竞争的通用词

返回格式：
{
  "keywords": [
    {"keyword": "关键词", "intent": "搜索意图", "volume": "搜索量", "competition": "竞争度", "score": 评分}
  ]
}`;

  try {
    const response = await callAI(env, prompt, business_name, service_description, target_market, lang, '');
    let keywords = [];
    try {
      const parsed = JSON.parse(response);
      keywords = parsed.keywords || [];
    } catch {
      // 如果 AI 返回的不是有效 JSON，尝试解析
      keywords = parseKeywordsFromText(response);
    }
    await logAudit(env, 'AI_SUGGEST_KEYWORDS', `business: ${business_name}, count: ${keywords.length}`);
    return jsonResponse({ keywords, count: keywords.length });
  } catch (e) {
    return errorResponse('关键词建议失败: ' + e.message, 500);
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────
function buildPrompt(params) {
  const { business_name, business_type, service, city, country, lang, keywords, phone, email, address, template } = params;
  return `你是一位专业的落地页设计师和文案撰写师。请基于以下信息生成一个专业的 HTML 落地页：

业务名称：${business_name}
业务类型：${business_type}
主要服务：${service}
服务城市：${city}
国家：${country}
语言：${lang}
关键词：${keywords}
联系电话：${phone}
邮箱：${email}
地址：${address}

要求：
1. 生成完整的 HTML 代码（包含 DOCTYPE、head、body）
2. 包含响应式 CSS 样式（使用 <style> 标签）
3. 包含 SEO Meta 标签和结构化数据（Schema.org）
4. 设计专业、现代、易于转化
5. 包含清晰的 CTA 按钮
6. 包含联系方式和地图
7. 适配移动设备
8. 加载速度优化`;
}

async function callAI(env, prompt, business_name, service, city, lang, template) {
  const messages = [
    {
      role: 'system',
      content: '你是一位专业的网页设计师、文案撰写师和 SEO 专家。请生成高质量的内容。'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', { messages });
  return response.response;
}

function parseKeywordsFromText(text) {
  // 尝试从文本中解析关键词
  const lines = text.split('\n').filter(l => l.trim());
  const keywords = [];
  for (const line of lines) {
    if (line.includes('关键词') || line.includes('keyword')) {
      keywords.push({
        keyword: line.replace(/^[\d.、-]+/, '').trim(),
        intent: '搜索意图',
        volume: '中等',
        competition: '中等',
        score: 7
      });
    }
  }
  return keywords.slice(0, 20);
}
