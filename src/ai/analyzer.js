const config = require('../../config/default');
const db = require('../utils/db');
const https = require('https');
const http = require('http');

// 预设模型供应商配置
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    models: [
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'o3', name: 'o3' },
      { id: 'o3-mini', name: 'o3 Mini' },
      { id: 'o4-mini', name: 'o4 Mini' },
    ],
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1' },
    ],
  },
  qwen: {
    name: '通义千问 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    models: [
      { id: 'qwen-max', name: 'Qwen Max' },
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen-turbo', name: 'Qwen Turbo' },
      { id: 'qwen-long', name: 'Qwen Long' },
    ],
  },
  zhipu: {
    name: '智谱 (GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus' },
      { id: 'glm-4-flash', name: 'GLM-4 Flash' },
      { id: 'glm-4-long', name: 'GLM-4 Long' },
    ],
  },
  moonshot: {
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K' },
      { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K' },
      { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K' },
    ],
  },
  baichuan: {
    name: '百川 (Baichuan)',
    baseUrl: 'https://api.baichuan-ai.com',
    models: [
      { id: 'Baichuan4', name: 'Baichuan 4' },
      { id: 'Baichuan3-Turbo', name: 'Baichuan 3 Turbo' },
    ],
  },
  doubao: {
    name: '豆包 (Doubao)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-pro-32k', name: 'Doubao Pro 32K（需填写实际 Endpoint ID）' },
      { id: 'doubao-lite-32k', name: 'Doubao Lite 32K（需填写实际 Endpoint ID）' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat',
    models: [
      { id: 'abab6.5s-chat', name: 'ABAB 6.5s' },
      { id: 'abab5.5-chat', name: 'ABAB 5.5' },
    ],
  },
  ollama: {
    name: 'Ollama (本地部署)',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3', name: 'Llama 3' },
      { id: 'qwen2', name: 'Qwen 2' },
      { id: 'mistral', name: 'Mistral' },
      { id: 'gemma2', name: 'Gemma 2' },
      { id: 'deepseek-r1', name: 'DeepSeek R1' },
      { id: 'phi3', name: 'Phi 3' },
    ],
  },
  custom: {
    name: '自定义 (OpenAI 兼容)',
    baseUrl: '',
    models: [],
  },
};

// 价格表：每百万 token 的美元价格 [input, output]
const MODEL_PRICING = {
  'claude-opus-4-6': [15, 75],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5-20251001': [0.8, 4],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'o3': [10, 40],
  'o3-mini': [1.1, 4.4],
  'o4-mini': [1.1, 4.4],
  'deepseek-chat': [0.27, 1.1],
  'deepseek-reasoner': [0.55, 2.19],
  'qwen-max': [2.4, 9.6],
  'qwen-plus': [0.8, 2],
  'qwen-turbo': [0.3, 0.6],
  'qwen-long': [0.5, 2],
  'glm-4-plus': [1.4, 1.4],
  'glm-4-flash': [0.014, 0.014],
  'glm-4-long': [0.14, 0.14],
  'moonshot-v1-8k': [1.7, 1.7],
  'moonshot-v1-32k': [3.4, 3.4],
  'moonshot-v1-128k': [8.5, 8.5],
};

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (inputTokens * pricing[0] + outputTokens * pricing[1]) / 1_000_000;
}

class AIAnalyzer {
  /**
   * 获取当前 AI 配置（优先数据库，降级到环境变量）
   */
  _getConfig() {
    try {
      const dbCfg = db.getAiConfig();
      if (dbCfg.api_key) return dbCfg;
    } catch (e) {}
    // 降级到环境变量
    return {
      provider: 'anthropic',
      model: config.ai.model || 'claude-sonnet-4-6',
      api_key: config.ai.apiKey || '',
      base_url: '',
    };
  }

  hasApiKey() {
    const cfg = this._getConfig();
    if (!cfg.enabled) return false;
    return cfg.api_key && cfg.api_key !== 'your_api_key_here';
  }

  /**
   * 统一调用 AI API（自动适配供应商）
   */
  async callAI(prompt, maxTokens = 2000, purpose = '') {
    const cfg = this._getConfig();
    if (!cfg.api_key) throw new Error('NO_API_KEY');

    const provider = cfg.provider || 'anthropic';

    let result;
    if (provider === 'anthropic') {
      result = await this._callAnthropic(cfg, prompt, maxTokens);
    } else {
      result = await this._callOpenAICompat(cfg, prompt, maxTokens);
    }

    // 记录 token 用量
    try {
      db.logTokenUsage({
        provider,
        model: cfg.model || '',
        input_tokens: result.usage?.input_tokens || 0,
        output_tokens: result.usage?.output_tokens || 0,
        purpose,
      });
    } catch (e) {
      console.error('[TokenUsage] 记录失败:', e.message);
    }

    return result.text;
  }

  /**
   * Anthropic Claude API
   */
  _callAnthropic(cfg, prompt, maxTokens) {
    const baseUrl = cfg.base_url || PROVIDERS.anthropic.baseUrl;
    const parsed = new URL(baseUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const data = JSON.stringify({
      model: cfg.model || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    return new Promise((resolve, reject) => {
      const req = client.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: (() => {
          let p = parsed.pathname.replace(/\/+$/, '');
          if (!p.endsWith('/v1') && !p.includes('/v1/')) p += '/v1';
          return p + '/messages';
        })(),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.api_key,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result.content && result.content[0]) {
              resolve({
                text: result.content[0].text,
                usage: { input_tokens: result.usage?.input_tokens || 0, output_tokens: result.usage?.output_tokens || 0 }
              });
            } else {
              reject(new Error(result.error?.message || 'Anthropic API 返回异常'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('API 请求超时')); });
      req.write(data);
      req.end();
    });
  }

  /**
   * OpenAI 兼容 API（OpenAI / DeepSeek / Qwen / 自定义）
   */
  _callOpenAICompat(cfg, prompt, maxTokens) {
    const providerInfo = PROVIDERS[cfg.provider];
    const baseUrl = cfg.base_url || (providerInfo ? providerInfo.baseUrl : '');
    if (!baseUrl) throw new Error('未配置 API Base URL');

    const parsed = new URL(baseUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    // 构造请求体，o 系列模型用 max_completion_tokens
    const isOModel = /^o\d/.test(cfg.model || '');
    const body = {
      model: cfg.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '你是一位资深前端性能优化专家。请始终使用 JSON 格式输出。' },
        { role: 'user', content: prompt },
      ],
    };
    if (isOModel) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }
    const data = JSON.stringify(body);

    // 路径：如果 baseUrl 已包含 /v1 就不再追加
    let apiPath = parsed.pathname.replace(/\/+$/, '');
    if (!apiPath.endsWith('/v1') && !apiPath.includes('/v1/')) {
      apiPath += '/v1';
    }
    apiPath += '/chat/completions';

    return new Promise((resolve, reject) => {
      const req = client.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.api_key}`,
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result.choices && result.choices[0]?.message?.content) {
              resolve({
                text: result.choices[0].message.content,
                usage: { input_tokens: result.usage?.prompt_tokens || 0, output_tokens: result.usage?.completion_tokens || 0 }
              });
            } else {
              reject(new Error(result.error?.message || 'API 返回异常'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, () => { req.destroy(); reject(new Error('API 请求超时')); });
      req.write(data);
      req.end();
    });
  }

  /**
   * 测试连接
   */
  async testConnection() {
    return this.testConnectionWith(null);
  }

  /**
   * 用临时配置测试连接（不保存到数据库）
   */
  async testConnectionWith(tempCfg) {
    // 合并：临时配置覆盖已保存的配置
    const saved = this._getConfig();
    const cfg = {
      provider: tempCfg?.provider || saved.provider,
      model: tempCfg?.model || saved.model,
      api_key: tempCfg?.api_key || saved.api_key,
      base_url: tempCfg?.base_url !== undefined ? tempCfg.base_url : saved.base_url,
    };

    if (!cfg.api_key) return { success: false, error: '未配置 API Key' };
    console.log('[AI Test] provider:', cfg.provider, 'model:', cfg.model, 'base_url:', cfg.base_url || '(default)');

    try {
      // 临时替换配置来调用
      const origGetConfig = this._getConfig.bind(this);
      this._getConfig = () => cfg;
      const reply = await this.callAI('请回复"OK"，只需要回复这两个字', 100, 'test');
      this._getConfig = origGetConfig;
      return { success: true, reply: reply.substring(0, 100) };
    } catch (e) {
      console.error('[AI Test] 失败:', e.message);
      return { success: false, error: e.message };
    }
  }

  /**
   * 获取可选供应商和模型列表
   */
  static getProviders() {
    return PROVIDERS;
  }

  // ==================== 分析逻辑（不变） ====================

  async analyzeScan(scanData, site) {
    const history = db.getSiteTrend(site.id, 10);

    const prompt = `你是一位资深前端性能优化专家。请分析以下网站的性能巡检数据，给出专业的分析报告。

## 网站信息
- 名称: ${site.name}
- URL: ${site.url}

## 当前巡检评分 (0-100)
- 性能: ${scanData.score_performance != null ? scanData.score_performance : '采集失败'}
- 无障碍: ${scanData.score_accessibility != null ? scanData.score_accessibility : '采集失败'}
- 最佳实践: ${scanData.score_best_practices != null ? scanData.score_best_practices : '采集失败'}
- SEO: ${scanData.score_seo != null ? scanData.score_seo : '采集失败'}

## 核心 Web 指标
- FCP (首次内容绘制): ${scanData.fcp != null ? Math.round(scanData.fcp) + 'ms' : '未采集'}
- LCP (最大内容绘制): ${scanData.lcp != null ? Math.round(scanData.lcp) + 'ms' : '未采集'}
- CLS (累积布局偏移): ${scanData.cls != null ? scanData.cls.toFixed(4) : '未采集'}
- TBT (总阻塞时间): ${scanData.tbt != null ? Math.round(scanData.tbt) + 'ms' : '未采集'}
- SI (速度指数): ${scanData.si != null ? Math.round(scanData.si) + 'ms' : '未采集'}
- TTI (可交互时间): ${scanData.tti != null ? Math.round(scanData.tti) + 'ms' : '未采集'}

## 资源信息
- 页面总大小: ${scanData.total_size != null ? (scanData.total_size / 1024 / 1024).toFixed(2) + 'MB' : '未采集'}
- 请求数: ${scanData.request_count != null ? scanData.request_count : '未采集'}
- DOM 节点数: ${scanData.dom_count != null ? scanData.dom_count : '未采集'}

## 诊断问题
${JSON.stringify(scanData.raw_data?.diagnostics || {}, null, 2)}

## 优化机会
${JSON.stringify(scanData.raw_data?.opportunities || [], null, 2)}

${history.length > 1 ? `## 历史趋势 (最近${history.length}次)
${history.map(h => `${h.created_at}: 性能=${h.score_performance ?? '无'}, LCP=${h.lcp != null ? Math.round(h.lcp) + 'ms' : '无'}`).join('\n')}` : ''}

请按以下JSON格式输出，不要包含其他内容：
{
  "summary": "一句话总结当前性能状况",
  "risk_level": "low/medium/high/critical",
  "score_analysis": {
    "performance": "性能评分分析",
    "accessibility": "无障碍评分分析",
    "best_practices": "最佳实践分析",
    "seo": "SEO分析"
  },
  "core_issues": [
    { "issue": "问题描述", "impact": "high/medium/low", "detail": "详细说明" }
  ],
  "suggestions": [
    { "title": "优化建议标题", "priority": "P0/P1/P2", "description": "具体操作步骤", "expected_improvement": "预期提升效果" }
  ],
  "trend_analysis": "趋势分析（如有历史数据）"
}`;

    let analysis;
    try {
      if (this.hasApiKey()) {
        const response = await this.callAI(prompt, 2000, 'scan_analysis');
        analysis = this.parseJSON(response);
      } else {
        analysis = this.generateFallbackAnalysis(scanData);
      }

      db.saveReport({
        site_id: site.id,
        scan_id: scanData.scanId,
        report_type: 'single',
        content: JSON.stringify(analysis),
        suggestions: JSON.stringify(analysis.suggestions || []),
        risk_level: analysis.risk_level || 'low'
      });

      return analysis;
    } catch (error) {
      console.error('[AI] 分析失败:', error.message);
      try {
        return this.generateFallbackAnalysis(scanData);
      } catch (e2) {
        return { summary: '分析失败', risk_level: 'low', core_issues: [], suggestions: [] };
      }
    }
  }

  async compareAnalysis(siteId) {
    const history = db.getSiteTrend(siteId, 30);
    const site = db.getSite(siteId);

    if (history.length < 2) {
      return { message: '数据不足，至少需要2次巡检记录' };
    }

    const latest = history[0];
    const previous = history[1];

    const fmtMetric = (v, isCls) => v == null ? '未采集' : isCls ? v.toFixed(4) : Math.round(v) + 'ms';
    const fmtScore = (v) => v != null ? v : '未采集';

    const prompt = `你是前端性能专家，请对比分析该网站两次巡检的变化：

## 网站: ${site.name} (${site.url})

## 最新一次 (${latest.created_at})
性能: ${fmtScore(latest.score_performance)}, FCP: ${fmtMetric(latest.fcp)}, LCP: ${fmtMetric(latest.lcp)}, CLS: ${fmtMetric(latest.cls, true)}, TBT: ${fmtMetric(latest.tbt)}

## 上一次 (${previous.created_at})
性能: ${fmtScore(previous.score_performance)}, FCP: ${fmtMetric(previous.fcp)}, LCP: ${fmtMetric(previous.lcp)}, CLS: ${fmtMetric(previous.cls, true)}, TBT: ${fmtMetric(previous.tbt)}

## 30次趋势数据
${history.map(h => `${h.created_at}: P=${fmtScore(h.score_performance)}`).join(', ')}

请按JSON格式输出：
{
  "summary": "变化总结",
  "changes": [{ "metric": "指标名", "before": "之前值", "after": "现在值", "change": "变化描述", "severity": "good/neutral/bad" }],
  "possible_causes": ["可能原因1", "可能原因2"],
  "recommendations": ["建议1", "建议2"],
  "overall_trend": "整体趋势判断"
}`;

    try {
      if (!this.hasApiKey()) {
        const hasBoth = latest.score_performance != null && previous.score_performance != null;
        const perfChange = hasBoth ? latest.score_performance - previous.score_performance : null;
        const changeText = perfChange != null ? `${perfChange >= 0 ? '+' : ''}${perfChange}` : '无法计算';
        return {
          summary: hasBoth
            ? `性能评分从 ${previous.score_performance} 变为 ${latest.score_performance}（${changeText}）`
            : `最新性能: ${latest.score_performance ?? '未采集'}，上次: ${previous.score_performance ?? '未采集'}`,
          changes: [
            { metric: '性能', before: previous.score_performance ?? '未采集', after: latest.score_performance ?? '未采集', change: changeText, severity: perfChange != null ? (perfChange >= 0 ? 'good' : 'bad') : 'neutral' }
          ],
          possible_causes: ['需接入 AI API 获取更详细的原因分析'],
          recommendations: ['在设置页面配置 AI 模型可获得智能分析'],
          overall_trend: `最近 ${history.length} 次巡检数据已记录`
        };
      }
      const response = await this.callAI(prompt, 2000, 'compare_analysis');
      return this.parseJSON(response);
    } catch (error) {
      return { error: error.message };
    }
  }

  generateFallbackAnalysis(scanData) {
    const issues = [];
    const suggestions = [];

    // 解析 Lighthouse 原始诊断数据
    let rawData = scanData.raw_data || {};
    if (typeof rawData === 'string') { try { rawData = JSON.parse(rawData); } catch (e) { rawData = {}; } }
    const diagnostics = rawData.diagnostics || {};
    const opportunities = rawData.opportunities || [];

    const perfScore = scanData.score_performance;
    const hasPerf = perfScore != null && perfScore >= 0;

    // ==================== 1. 从 Lighthouse 诊断中提取真实问题 ====================

    // 诊断项 → 问题描述映射
    const diagMap = {
      'render-blocking-resources': {
        issue: '存在渲染阻塞资源',
        detail: (d) => `${d.displayValue || ''}。页面加载时有 CSS/JS 文件阻塞了首次渲染，浏览器必须等这些资源下载完才能显示内容`,
        fix: '1. 非关键 CSS 用 media 属性延迟加载 2. JS 加 defer/async 属性 3. 内联首屏关键 CSS 4. 移除未使用的 CSS/JS',
        impact: 'high', priority: 'P0', improvement: '可显著降低 FCP/LCP'
      },
      'unused-javascript': {
        issue: '存在大量未使用的 JavaScript',
        detail: (d) => `${d.displayValue || ''}。页面加载了未被执行的 JS 代码，白白浪费了下载和解析时间`,
        fix: '1. 代码拆分 (Code Splitting)，按路由/组件懒加载 2. 用 webpack-bundle-analyzer 找出无用代码 3. 移除未使用的第三方库 4. 用 Tree Shaking 消除死代码',
        impact: 'high', priority: 'P0', improvement: '减少 JS 体积，降低 TBT'
      },
      'unused-css-rules': {
        issue: '存在大量未使用的 CSS',
        detail: (d) => `${d.displayValue || ''}。页面加载了未被引用的 CSS 规则，增加了下载时间和样式计算开销`,
        fix: '1. 用 PurgeCSS / UnCSS 移除未使用样式 2. 按组件拆分 CSS 3. 避免全量引入 UI 框架样式（按需加载）',
        impact: 'medium', priority: 'P1', improvement: '减少 CSS 体积，加快渲染'
      },
      'mainthread-work-breakdown': {
        issue: '主线程工作负载过重',
        detail: (d) => `${d.displayValue || ''}。浏览器主线程被大量任务占据，导致页面交互卡顿、响应迟钝`,
        fix: '1. 将耗时计算移到 Web Worker 2. 拆分长任务（单个任务 > 50ms 就应拆分）3. 减少 DOM 操作和强制回流 4. 延迟加载非首屏功能',
        impact: 'high', priority: 'P1', improvement: '降低 TBT，提升交互流畅度'
      },
      'bootup-time': {
        issue: 'JavaScript 启动耗时过长',
        detail: (d) => `${d.displayValue || ''}。JS 的解析、编译和执行占用了大量时间，拖慢了页面可交互速度`,
        fix: '1. 减少 JS 总量，按需加载 2. 避免在首屏执行复杂逻辑 3. 使用更高效的第三方库 4. 优化热路径代码（频繁调用的函数）',
        impact: 'high', priority: 'P1', improvement: '加快 TTI'
      },
      'modern-image-formats': {
        issue: '图片未使用现代格式',
        detail: (d) => `${d.displayValue || ''}。页面使用了 JPEG/PNG 等传统格式，WebP/AVIF 格式可大幅减小体积`,
        fix: '1. 将图片转换为 WebP 或 AVIF 格式 2. 使用 <picture> 标签做格式降级 3. 配置 CDN 自动转换图片格式',
        impact: 'medium', priority: 'P1', improvement: '图片体积减少 25-50%'
      },
      'uses-optimized-images': {
        issue: '图片未充分压缩',
        detail: (d) => `${d.displayValue || ''}。图片文件比最优压缩大很多，浪费带宽`,
        fix: '1. 使用 TinyPNG/Squoosh 压缩图片 2. 配置 CDN 端图片压缩 3. 根据显示尺寸提供合适分辨率（不要用 2000px 图显示 200px 区域）',
        impact: 'medium', priority: 'P1', improvement: '减少图片传输量'
      },
      'uses-responsive-images': {
        issue: '图片尺寸与显示尺寸不匹配',
        detail: (d) => `${d.displayValue || ''}。加载的图片远大于实际显示尺寸，浪费流量和内存`,
        fix: '1. 使用 srcset 提供不同分辨率 2. 图片裁剪到实际显示尺寸 3. 使用 CDN 的动态裁剪功能',
        impact: 'medium', priority: 'P2', improvement: '减少不必要的图片下载量'
      },
      'uses-text-compression': {
        issue: '文本资源未启用压缩',
        detail: (d) => `${d.displayValue || ''}。HTML/CSS/JS 等文本资源未开启 Gzip/Brotli 压缩，传输量远大于必要`,
        fix: '1. 在 Nginx/CDN 配置中启用 gzip 或 brotli 2. 确保 Content-Encoding 头正确返回 3. 检查所有文本类型 MIME 都已覆盖',
        impact: 'high', priority: 'P0', improvement: '文本资源体积减少 60-80%'
      },
      'font-display': {
        issue: '字体加载阻塞文本显示',
        detail: (d) => `页面使用了自定义字体但未设置 font-display，字体下载期间文本不可见（FOIT）`,
        fix: '1. 给 @font-face 添加 font-display: swap 2. 预加载关键字体 <link rel="preload"> 3. 使用系统字体栈作为后备',
        impact: 'medium', priority: 'P1', improvement: '消除字体加载导致的空白闪烁'
      },
      'third-party-summary': {
        issue: '第三方脚本影响性能',
        detail: (d) => `${d.displayValue || ''}。第三方脚本（广告、统计、SDK 等）占用了大量加载时间和主线程资源`,
        fix: '1. 审查每个第三方脚本的必要性 2. 延迟加载非关键第三方脚本 3. 使用 Partytown 等方案将第三方脚本移到 Web Worker 4. 设置第三方脚本的性能预算',
        impact: 'medium', priority: 'P1', improvement: '减少第三方脚本对主线程的占用'
      },
      'largest-contentful-paint-element': {
        issue: 'LCP 元素加载缓慢',
        detail: (d) => `${d.displayValue || '页面最大内容元素（通常是首屏大图或标题文字）渲染耗时过长'}`,
        fix: '1. 预加载 LCP 资源 <link rel="preload"> 2. 如果是图片，压缩并使用 CDN 3. 如果是文字，确保字体快速加载 4. 减少 LCP 元素前的阻塞资源',
        impact: 'high', priority: 'P0', improvement: '直接降低 LCP 指标'
      },
      'layout-shift-elements': {
        issue: '页面存在布局偏移元素',
        detail: (d) => `页面中有元素在加载过程中发生了位置移动，导致用户体验抖动`,
        fix: '1. 给图片/视频设置明确的宽高属性 2. 预留广告位空间 3. 避免在现有内容上方动态插入 DOM 4. 使用 CSS contain 属性限制重排范围',
        impact: 'medium', priority: 'P1', improvement: '降低 CLS 指标'
      },
      'long-tasks': {
        issue: '存在超过 50ms 的长任务',
        detail: (d) => `${d.displayValue || ''}。长任务会阻塞主线程，导致页面无法响应用户操作`,
        fix: '1. 用 requestIdleCallback / setTimeout 拆分长任务 2. 将密集计算移到 Web Worker 3. 使用虚拟滚动优化大列表渲染 4. 按需初始化组件',
        impact: 'high', priority: 'P1', improvement: '降低 TBT，提升交互响应'
      },
      'duplicated-javascript': {
        issue: '存在重复的 JavaScript 模块',
        detail: (d) => `${d.displayValue || ''}。同一个 JS 模块被打包了多次，增加了不必要的体积`,
        fix: '1. 检查 webpack/vite 打包配置，启用 splitChunks 去重 2. 统一第三方库版本 3. 用 pnpm 避免幽灵依赖导致的重复',
        impact: 'medium', priority: 'P2', improvement: '减少 JS 体积'
      },
      'legacy-javascript': {
        issue: '向旧浏览器发送了现代 JS 的 polyfill',
        detail: (d) => `${d.displayValue || ''}。发送了不必要的 polyfill 代码给已支持这些特性的现代浏览器`,
        fix: '1. 使用 module/nomodule 模式区分新旧浏览器 2. 根据 browserslist 配置精确 polyfill 3. 使用 @babel/preset-env 的 useBuiltIns: usage',
        impact: 'low', priority: 'P2', improvement: '减少不必要的 JS 体积'
      },
      'efficient-animated-content': {
        issue: '使用了低效的动画格式',
        detail: (d) => `${d.displayValue || ''}。页面使用 GIF 等低效格式播放动画，应替换为视频格式`,
        fix: '1. 将 GIF 转为 MP4/WebM 视频 2. 使用 <video autoplay muted loop> 替代 GIF 3. 短动画考虑用 CSS 动画或 Lottie',
        impact: 'medium', priority: 'P2', improvement: '大幅减少动画资源体积'
      },
    };

    // 遍历 Lighthouse 实际诊断出的问题
    for (const [key, diag] of Object.entries(diagnostics)) {
      const mapping = diagMap[key];
      if (!mapping) continue;
      const detail = typeof mapping.detail === 'function' ? mapping.detail(diag) : mapping.detail;
      issues.push({ issue: mapping.issue, impact: mapping.impact, detail });
      suggestions.push({
        title: mapping.issue, priority: mapping.priority,
        description: mapping.fix, expected_improvement: mapping.improvement
      });
    }

    // ==================== 2. 从 Lighthouse Opportunities 提取可量化的优化建议 ====================
    for (const opp of opportunities) {
      // 跳过已在 diagnostics 中覆盖的
      if (diagMap[opp.id] && diagnostics[opp.id]) continue;

      const savingsMs = Math.round(opp.savings || 0);
      const savingsKB = opp.savingsBytes ? Math.round(opp.savingsBytes / 1024) : 0;
      let savingsText = '';
      if (savingsMs > 0) savingsText += `可节省 ${savingsMs}ms`;
      if (savingsKB > 0) savingsText += `${savingsText ? '，' : '可节省 '}${savingsKB}KB`;

      const impact = savingsMs > 1000 ? 'high' : savingsMs > 300 ? 'medium' : 'low';
      const priority = savingsMs > 1000 ? 'P0' : savingsMs > 300 ? 'P1' : 'P2';

      issues.push({
        issue: opp.title,
        impact,
        detail: `${opp.displayValue || ''}。${savingsText}`
      });
      suggestions.push({
        title: opp.title,
        priority,
        description: `Lighthouse 建议优化此项（${savingsText}）`,
        expected_improvement: savingsText || '提升加载性能'
      });
    }

    // ==================== 3. 核心 Web 指标异常（补充诊断未覆盖的，需先确认有数据） ====================
    if (scanData.lcp != null && scanData.lcp > 4000 && !diagnostics['largest-contentful-paint-element']) {
      issues.push({ issue: 'LCP 最大内容绘制超标', impact: 'high',
        detail: `LCP ${Math.round(scanData.lcp)}ms（阈值 2500ms 良好，4000ms 差）。用户需要等待 ${(scanData.lcp / 1000).toFixed(1)} 秒才能看到主要内容` });
      suggestions.push({ title: '优化 LCP', priority: 'P0',
        description: '1. 预加载 LCP 资源 2. 优化服务器响应时间 (TTFB) 3. 压缩和优化 LCP 图片 4. 移除 LCP 前的渲染阻塞资源',
        expected_improvement: 'LCP 降至 2.5s 以内' });
    } else if (scanData.lcp != null && scanData.lcp > 2500 && !diagnostics['largest-contentful-paint-element']) {
      issues.push({ issue: 'LCP 偏高', impact: 'medium',
        detail: `LCP ${Math.round(scanData.lcp)}ms，处于"需改善"区间（良好标准 < 2500ms）` });
    }

    if (scanData.cls != null && scanData.cls > 0.25 && !diagnostics['layout-shift-elements']) {
      issues.push({ issue: 'CLS 累积布局偏移超标', impact: 'high',
        detail: `CLS ${scanData.cls.toFixed(4)}（阈值 0.1 良好，0.25 差）。页面元素在加载过程中发生了明显的位置跳动` });
      suggestions.push({ title: '降低 CLS', priority: 'P1',
        description: '1. 所有图片/视频标签必须设置 width 和 height 2. 不要在已有内容上方动态插入元素 3. 字体加载使用 font-display: swap 4. 广告位预留固定空间',
        expected_improvement: 'CLS 降至 0.1 以内' });
    } else if (scanData.cls != null && scanData.cls > 0.1 && !diagnostics['layout-shift-elements']) {
      issues.push({ issue: 'CLS 偏高', impact: 'medium',
        detail: `CLS ${scanData.cls.toFixed(4)}，处于"需改善"区间（良好标准 < 0.1）` });
    }

    if (scanData.fcp != null && scanData.fcp > 3000) {
      issues.push({ issue: 'FCP 首次内容绘制过慢', impact: 'medium',
        detail: `FCP ${Math.round(scanData.fcp)}ms（良好标准 < 1800ms）。用户等了 ${(scanData.fcp / 1000).toFixed(1)} 秒才看到第一个内容元素` });
    }

    if (scanData.tbt != null && scanData.tbt > 600 && !diagnostics['long-tasks'] && !diagnostics['mainthread-work-breakdown']) {
      issues.push({ issue: '总阻塞时间过长', impact: 'high',
        detail: `TBT ${Math.round(scanData.tbt)}ms（良好标准 < 200ms）。主线程被长时间占据，页面点击/滚动会出现明显延迟` });
    }

    // ==================== 4. 资源维度问题 ====================
    if (scanData.total_size != null && scanData.total_size > 5 * 1024 * 1024) {
      issues.push({ issue: '页面总体积过大', impact: 'high',
        detail: `页面总资源 ${(scanData.total_size / 1024 / 1024).toFixed(1)}MB，弱网环境下加载可能需要 ${Math.round(scanData.total_size / 1024 / 500)}s+` });
      suggestions.push({ title: '减小页面体积', priority: 'P0',
        description: '1. 启用 Gzip/Brotli 压缩 2. 图片转 WebP 并按需裁剪 3. 按路由拆分 JS 4. 移除未使用的依赖',
        expected_improvement: '页面体积减少 40-60%' });
    } else if (scanData.total_size != null && scanData.total_size > 3 * 1024 * 1024) {
      issues.push({ issue: '页面体积偏大', impact: 'medium',
        detail: `页面总资源 ${(scanData.total_size / 1024 / 1024).toFixed(1)}MB，建议控制在 3MB 以内` });
    }

    if (scanData.request_count != null && scanData.request_count > 100) {
      issues.push({ issue: 'HTTP 请求数过多', impact: 'medium',
        detail: `共 ${scanData.request_count} 个请求。过多请求会增加连接开销和排队等待时间` });
      suggestions.push({ title: '合并减少请求', priority: 'P2',
        description: '1. 合并小文件（CSS/JS Bundle）2. 使用 CSS Sprite 或 SVG Sprite 合并图标 3. 内联小于 4KB 的资源 4. 启用 HTTP/2 多路复用',
        expected_improvement: '减少连接开销' });
    }

    if (scanData.dom_count != null && scanData.dom_count > 1500) {
      issues.push({ issue: 'DOM 节点数过多', impact: scanData.dom_count > 3000 ? 'high' : 'medium',
        detail: `共 ${scanData.dom_count} 个 DOM 节点（建议 < 1500）。过多的 DOM 节点会增加内存占用，拖慢样式计算和 JS 操作` });
      suggestions.push({ title: '精简 DOM 结构', priority: 'P2',
        description: '1. 使用虚拟滚动处理长列表 2. 按需渲染（不可见区域不生成 DOM）3. 减少无意义的包裹层 div 4. 组件卸载时清理 DOM',
        expected_improvement: '降低内存占用和样式计算耗时' });
    }

    // ==================== 5. 稳定性问题 ====================
    if (scanData.stability) {
      const { successCount, totalAttempts, stabilityRate } = scanData.stability;
      if (totalAttempts > 1 && stabilityRate < 100) {
        const stabImpact = successCount === 0 ? 'high' : 'medium';
        issues.push({
          issue: '页面访问稳定性不足', impact: stabImpact,
          detail: `采集成功率 ${stabilityRate}%（${successCount}/${totalAttempts} 次成功）。部分用户可能遇到白屏或超时`
        });
        suggestions.push({
          title: '排查页面稳定性问题', priority: successCount === 0 ? 'P0' : 'P1',
          description: '1. 检查服务器/CDN 是否间歇性超时 2. 排查 JS 报错是否导致白屏（查 Sentry 等监控）3. 检查关键接口是否有超时或 5xx 4. 确认页面是否有反爬策略误杀',
          expected_improvement: '提升可用性至 99.9%+'
        });
      }
    }

    // ==================== 6. 评分分析 ====================
    const riskLevel = !hasPerf ? 'high' : perfScore < 40 ? 'critical' : perfScore < 60 ? 'high' : perfScore < 80 ? 'medium' : 'low';
    const perfText = hasPerf ? `${perfScore}/100` : '采集失败';

    // 生成具体的评分分析
    const perfAnalysis = !hasPerf ? '性能数据采集失败，页面可能存在严重的加载或渲染问题，需要排查页面可用性' :
      perfScore >= 90 ? `${perfScore} 分，性能优秀。核心指标均在良好范围` :
      perfScore >= 70 ? `${perfScore} 分，性能良好但有优化空间。${scanData.lcp > 2500 ? 'LCP 偏高需关注。' : ''}${scanData.tbt > 200 ? '主线程阻塞时间偏长。' : ''}` :
      perfScore >= 50 ? `${perfScore} 分，性能需改善。${issues.slice(0, 3).map(i => i.issue).join('、')}等问题影响了评分` :
      `${perfScore} 分，性能较差，急需优化。存在 ${issues.length} 个需要关注的问题`;

    const a11yScore = scanData.score_accessibility;
    const a11yAnalysis = a11yScore == null || a11yScore === -1 ? '无障碍数据采集失败' :
      a11yScore >= 90 ? `${a11yScore} 分，无障碍体验优秀` :
      a11yScore >= 70 ? `${a11yScore} 分，部分元素缺少无障碍属性（如 alt、aria-label）` :
      `${a11yScore} 分，无障碍问题较多，需检查图片 alt 属性、颜色对比度、表单标签等`;

    const bpScore = scanData.score_best_practices;
    const bpAnalysis = bpScore == null || bpScore === -1 ? '最佳实践数据采集失败' :
      bpScore >= 90 ? `${bpScore} 分，符合最佳实践` :
      bpScore >= 70 ? `${bpScore} 分，存在部分不规范的实现` :
      `${bpScore} 分，多个最佳实践未遵循，建议检查 HTTPS、安全头、控制台错误等`;

    const seoScore = scanData.score_seo;
    const seoAnalysis = seoScore == null || seoScore === -1 ? 'SEO 数据采集失败' :
      seoScore >= 90 ? `${seoScore} 分，SEO 配置良好` :
      seoScore >= 70 ? `${seoScore} 分，部分 SEO 配置缺失（如 meta description、canonical）` :
      `${seoScore} 分，SEO 配置不完善，可能影响搜索引擎收录`;

    // 按 impact 排序：high → medium → low
    const impactOrder = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => (impactOrder[a.impact] || 2) - (impactOrder[b.impact] || 2));
    suggestions.sort((a, b) => {
      const pa = a.priority === 'P0' ? 0 : a.priority === 'P1' ? 1 : 2;
      const pb = b.priority === 'P0' ? 0 : b.priority === 'P1' ? 1 : 2;
      return pa - pb;
    });

    // 总结
    const highCount = issues.filter(i => i.impact === 'high').length;
    const summaryText = !hasPerf ? '性能数据采集失败，需排查页面可用性' :
      highCount === 0 ? '整体表现良好，仅有少量可优化项' :
      highCount <= 2 ? `发现 ${highCount} 个高优问题：${issues.filter(i => i.impact === 'high').map(i => i.issue).join('、')}` :
      `发现 ${highCount} 个高优问题，建议优先处理：${issues.filter(i => i.impact === 'high').slice(0, 3).map(i => i.issue).join('、')}`;

    return {
      summary: `性能 ${perfText}，${summaryText}`,
      risk_level: riskLevel,
      score_analysis: {
        performance: perfAnalysis,
        accessibility: a11yAnalysis,
        best_practices: bpAnalysis,
        seo: seoAnalysis
      },
      core_issues: issues,
      suggestions: suggestions,
      trend_analysis: issues.length === 0 ? '当前各项指标正常' : `共发现 ${issues.length} 个问题（${highCount} 个高优），建议按 P0→P1→P2 优先级逐步优化`,
      _mode: 'fallback'
    };
  }

  parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return JSON.parse(match[1].trim());
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) return JSON.parse(braceMatch[0]);
      throw new Error('无法解析 AI 返回的 JSON');
    }
  }
}

const analyzerInstance = new AIAnalyzer();
analyzerInstance.PROVIDERS = PROVIDERS;
analyzerInstance.estimateCost = estimateCost;
analyzerInstance.MODEL_PRICING = MODEL_PRICING;
module.exports = analyzerInstance;
