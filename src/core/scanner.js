const lighthouse = require('lighthouse').default || require('lighthouse');
const puppeteer = require('puppeteer');
const config = require('../../config/default');
const db = require('../utils/db');
const path = require('path');
const fs = require('fs');

class PerformanceScanner {
  constructor() {
    this.browser = null;
    this.isRunning = false;
    this.scanCount = 0;           // 当前浏览器累计扫描次数
    this.RESTART_EVERY = 5;       // 每扫描 5 个站点重启浏览器，防止状态污染
  }

  async init() {
    // 如果浏览器进程已断开，先清理
    if (this.browser && !this.browser.isConnected()) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--window-size=1920,1080'
        ]
      });
    }
    return this.browser;
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
  }

  /**
   * 巡检单个站点
   */
  async scanSite(site) {
    const scanId = db.createScan(site.id);
    const startTime = Date.now();
    console.log(`[Scanner] 开始巡检: ${site.name} (${site.url})`);

    try {
      await this.init();

      // 如果需要登录，先处理登录
      if (site.login_required && site.login_url) {
        await this.handleLogin(site);
      }

      // ==================== 采集策略：Lighthouse 直跑四维度 + Puppeteer 仅补安全检测 ====================

      // 第 1 步：Lighthouse 直跑（性能 + 无障碍 + 最佳实践 + SEO，~10-20s）
      console.log(`[Scanner] ${site.name} Lighthouse 直跑四维度...`);
      const lhResult = await this._runLighthouseWithRetry(site, 2);
      const { bestData: lhData, bestResult, attempts } = lhResult;

      const data = lhData || {};
      data.duration = Date.now() - startTime;

      // 第 2 步：Puppeteer 仅跑安全检测（~3-5s）
      let securityResult = null;
      try {
        console.log(`[Scanner] ${site.name} Puppeteer 安全检测...`);
        securityResult = await this.captureSecurityOnly(site);
        if (securityResult) {
          data.score_security = securityResult.score;
          // 补充 Lighthouse 拿不到的资源指标
          if (data.total_size == null && securityResult.totalSize != null) data.total_size = securityResult.totalSize;
          if (data.request_count == null && securityResult.requestCount != null) data.request_count = securityResult.requestCount;
          if (data.dom_count == null && securityResult.domCount != null) data.dom_count = securityResult.domCount;
        }
      } catch (e) {
        console.log(`[Scanner] 安全检测失败: ${e.message}`);
      }

      // 性能分兜底：Lighthouse 没出分时用估算
      if (data.score_performance == null && data.fcp != null && data.lcp != null) {
        data.score_performance = this._estimatePerformanceScore(data.fcp, data.lcp, data.tbt, data.cls, data.si);
        console.log(`[Scanner] 性能分估算: ${data.score_performance}`);
      }

      // 统计采集稳定性
      const successCount = attempts.filter(a => a.success).length;
      const totalAttempts = attempts.length;
      const stabilityRate = Math.round((successCount / totalAttempts) * 100);

      // 注入稳定性和安全诊断数据到 raw_data
      if (typeof data.raw_data !== 'object') {
        try { data.raw_data = JSON.parse(data.raw_data || '{}'); } catch (e) { data.raw_data = {}; }
      }
      data.raw_data.stability = { attempts, successCount, totalAttempts, stabilityRate };
      if (securityResult) {
        data.raw_data.puppeteer_diagnostics = { security: securityResult.issues };
      }

      // 判断状态
      if (data.score_performance == null) {
        data.status = 'partial';
        console.log(`[Scanner] 警告: ${site.name} 无法获取性能指标`);
      } else {
        data.status = 'completed';
      }

      if (totalAttempts > 1 && stabilityRate < 100) {
        console.log(`[Scanner] 稳定性警告: ${site.name} 采集成功率 ${stabilityRate}%`);
      }

      // 保存截图
      const screenshotPath = await this.saveScreenshot(site, bestResult);
      data.screenshot_path = screenshotPath;

      // 检查是否需要告警（包括稳定性问题）
      data.alert_triggered = this.checkThresholds(data) || stabilityRate < 100;

      // 更新数据库
      db.updateScan(scanId, data);

      console.log(`[Scanner] 巡检完成: ${site.name} | 性能: ${data.score_performance} | 成功率: ${stabilityRate}% | 耗时: ${data.duration}ms`);

      // 定期重启浏览器，防止 Lighthouse 残留对象导致内存膨胀
      this.scanCount++;
      if (this.scanCount >= this.RESTART_EVERY) {
        console.log(`[Scanner] 已连续扫描 ${this.scanCount} 个站点，重启浏览器释放内存`);
        await this.close();
        this.scanCount = 0;
      }

      return { scanId, ...data, site, stability: { attempts, successCount, totalAttempts, stabilityRate } };
    } catch (error) {
      console.error(`[Scanner] 巡检失败: ${site.name}`, error.message);
      db.updateScan(scanId, {
        status: 'failed',
        raw_data: { error: error.message },
        duration: Date.now() - startTime
      });
      return { scanId, status: 'failed', error: error.message, site };
    }
  }

  /**
   * 巡检所有启用的站点
   */
  async scanAll() {
    if (this.isRunning) {
      console.log('[Scanner] 已有巡检任务运行中，跳过');
      return [];
    }

    this.isRunning = true;
    const sites = db.getEnabledSites();
    const results = [];

    console.log(`[Scanner] 开始批量巡检，共 ${sites.length} 个站点`);

    for (const site of sites) {
      try {
        const result = await this.scanSite(site);
        results.push(result);
      } catch (error) {
        console.error(`[Scanner] 站点 ${site.name} 巡检异常:`, error.message);
        results.push({ site, status: 'failed', error: error.message });
      }
    }

    this.isRunning = false;
    await this.close();

    console.log(`[Scanner] 批量巡检完成，共 ${results.length} 个站点`);
    return results;
  }

  /**
   * 运行 Lighthouse
   */
  async runLighthouse(site) {
    const port = new URL(this.browser.wsEndpoint()).port;

    // 扫描前清理浏览器缓存和状态，避免上一个页面的残留干扰
    try {
      const page = await this.browser.newPage();
      const cdp = await page.createCDPSession();
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.clearBrowserCookies');
      await cdp.send('Storage.clearDataForOrigin', {
        origin: new URL(site.url).origin,
        storageTypes: 'all'
      }).catch(() => {});
      await cdp.detach();
      await page.close();
    } catch (e) {}

    // 优化配置：simulate 模式快 2-3 倍，跳过截图审计省 3-5s
    const flags = {
      port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor: 'desktop',
      screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 },
      throttlingMethod: 'simulate',
      maxWaitForLoad: 15000,
      maxWaitForFcp: 15000,
      skipAudits: ['screenshot-thumbnails', 'final-screenshot', 'full-page-screenshot', 'bf-cache'],
      disableStorageReset: false,
    };

    // 如果站点有自定义 headers（处理多层 JSON 转义）
    let headers = {};
    try {
      let h = site.headers || '{}';
      // 循环解析直到得到对象
      for (let i = 0; i < 3 && typeof h === 'string'; i++) {
        h = JSON.parse(h);
      }
      if (h && typeof h === 'object' && !Array.isArray(h)) headers = h;
    } catch (e) {}

    if (Object.keys(headers).length > 0) {
      flags.extraHeaders = headers;
    }

    const runnerResult = await lighthouse(site.url, flags);
    return runnerResult;
  }

  /**
   * 处理需要登录的站点
   */
  async handleLogin(site) {
    const page = await this.browser.newPage();
    try {
      await page.goto(site.login_url, { waitUntil: 'networkidle2', timeout: 30000 });

      // 通用登录逻辑 - 尝试常见选择器
      const usernameSelectors = ['input[name="username"]', 'input[name="account"]', 'input[name="email"]', 'input[type="text"]', '#username', '#account'];
      const passwordSelectors = ['input[name="password"]', 'input[type="password"]', '#password'];
      const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', '.login-btn', '.submit-btn', 'button.btn-primary'];

      for (const sel of usernameSelectors) {
        const el = await page.$(sel);
        if (el) { await el.type(site.login_user); break; }
      }

      for (const sel of passwordSelectors) {
        const el = await page.$(sel);
        if (el) { await el.type(site.login_pass); break; }
      }

      for (const sel of submitSelectors) {
        const el = await page.$(sel);
        if (el) { await el.click(); break; }
      }

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

      // 获取 cookies 并设置到浏览器
      const cookies = await page.cookies();
      if (cookies.length > 0) {
        const cdp = await this.browser.target().createCDPSession();
        try {
          for (const cookie of cookies) {
            await cdp.send('Network.setCookie', cookie).catch(() => {});
          }
        } finally {
          await cdp.detach().catch(() => {});
        }
      }
    } finally {
      await page.close();
    }
  }

  /**
   * 解析 Lighthouse 结果
   */
  parseResult(result) {
    const { lhr } = result;
    const categories = lhr.categories;
    const audits = lhr.audits;

    // 四大评分
    let perfScore = categories.performance?.score ?? null;

    // Lighthouse 有时返回 performance.score = null，但 FCP/LCP 有值
    // 用对数正态评分曲线估算性能分（与 Lighthouse 一致）
    if (perfScore == null) {
      const fcp = audits['first-contentful-paint']?.numericValue ?? null;
      const lcp = audits['largest-contentful-paint']?.numericValue ?? null;
      if (fcp != null && lcp != null) {
        const tbt = audits['total-blocking-time']?.numericValue ?? null;
        const cls = audits['cumulative-layout-shift']?.numericValue ?? null;
        const si = audits['speed-index']?.numericValue ?? null;
        const estimated = this._estimatePerformanceScore(fcp, lcp, tbt, cls, si);
        perfScore = estimated / 100; // parseResult 后续会 * 100
        console.log(`[Scanner] 性能分估算(对数正态): FCP=${Math.round(fcp)}ms LCP=${Math.round(lcp)}ms TBT=${tbt != null ? Math.round(tbt) : 'N/A'}ms CLS=${cls != null ? cls.toFixed(3) : 'N/A'} → ${estimated}`);
      }
    }

    // 三维度由 Puppeteer 独立采集，这里不再从 Lighthouse 解析
    const scores = {
      score_performance: perfScore == null ? null : Math.round(perfScore * 100),
      score_accessibility: categories.accessibility?.score != null ? Math.round(categories.accessibility.score * 100) : null,
      score_best_practices: categories['best-practices']?.score != null ? Math.round(categories['best-practices'].score * 100) : null,
      score_seo: categories.seo?.score != null ? Math.round(categories.seo.score * 100) : null,
      score_security: null
    };

    // 核心 Web 指标（null = 未采集，0 = 真实的 0）
    const metrics = {
      fcp: audits['first-contentful-paint']?.numericValue ?? null,
      lcp: audits['largest-contentful-paint']?.numericValue ?? null,
      cls: audits['cumulative-layout-shift']?.numericValue ?? null,
      tbt: audits['total-blocking-time']?.numericValue ?? null,
      si: audits['speed-index']?.numericValue ?? null,
      tti: audits['interactive']?.numericValue ?? null
    };

    // 资源指标
    const resources = {
      total_size: audits['total-byte-weight']?.numericValue ?? null,
      request_count: audits['network-requests']?.details?.items?.length ?? null,
      dom_count: audits['dom-size']?.numericValue ?? null
    };

    // 精简原始数据（不存完整报告，太大）
    const raw_data = {
      fetchTime: lhr.fetchTime,
      finalUrl: lhr.finalDisplayedUrl,
      categories: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, { score: v.score, title: v.title }])
      ),
      diagnostics: this.extractDiagnostics(audits),
      opportunities: this.extractOpportunities(audits)
    };

    return { ...scores, ...metrics, ...resources, raw_data };
  }

  /**
   * 从子审计项加权估算类别分数（兜底）
   */
  estimateCategoryScore(audits, auditWeights) {
    let totalWeight = 0;
    let weightedSum = 0;
    let validCount = 0;

    for (const { id, weight } of auditWeights) {
      const audit = audits[id];
      if (audit && audit.score != null) {
        weightedSum += audit.score * weight;
        totalWeight += weight;
        validCount++;
      }
    }

    // 至少需要 3 个有效审计项才估算，否则数据不够可靠
    if (validCount < 3 || totalWeight === 0) return null;
    return weightedSum / totalWeight;
  }

  /**
   * 提取诊断信息
   */
  extractDiagnostics(audits) {
    const diagnosticKeys = [
      'mainthread-work-breakdown', 'bootup-time', 'font-display',
      'third-party-summary', 'largest-contentful-paint-element',
      'layout-shift-elements', 'long-tasks', 'render-blocking-resources',
      'unused-css-rules', 'unused-javascript', 'modern-image-formats',
      'uses-optimized-images', 'uses-text-compression', 'uses-responsive-images',
      'efficient-animated-content', 'duplicated-javascript', 'legacy-javascript'
    ];

    const diagnostics = {};
    for (const key of diagnosticKeys) {
      if (audits[key] && audits[key].score !== null && audits[key].score < 1) {
        diagnostics[key] = {
          title: audits[key].title,
          description: audits[key].description?.substring(0, 200),
          score: audits[key].score,
          displayValue: audits[key].displayValue,
          numericValue: audits[key].numericValue
        };
      }
    }
    return diagnostics;
  }

  /**
   * 提取优化建议
   */
  extractOpportunities(audits) {
    const opportunities = [];
    for (const [key, audit] of Object.entries(audits)) {
      if (audit.details?.type === 'opportunity' && audit.details?.overallSavingsMs > 0) {
        opportunities.push({
          id: key,
          title: audit.title,
          savings: audit.details.overallSavingsMs,
          savingsBytes: audit.details.overallSavingsBytes || 0,
          displayValue: audit.displayValue
        });
      }
    }
    return opportunities.sort((a, b) => b.savings - a.savings);
  }

  /**
   * Lighthouse 跑 3 次取中位数（消除波动，准确率最高）
   * 如果前 2 次差距 ≤3 分，跳过第 3 次（节省时间）
   */
  async _runLighthouseWithRetry(site, maxRuns = 3) {
    const attempts = [];
    const successfulRuns = []; // { score, data, result }

    for (let attempt = 1; attempt <= maxRuns; attempt++) {
      try {
        console.log(`[Scanner] ${site.name} Lighthouse 第 ${attempt}/${maxRuns} 次...`);
        const result = await this.runLighthouse(site);
        const data = this.parseResult(result);
        const perfScore = data.score_performance ?? -1;

        attempts.push({ attempt, success: perfScore >= 0, score: perfScore >= 0 ? perfScore : null, error: null });

        if (perfScore >= 0) {
          console.log(`[Scanner] ${site.name} 第 ${attempt} 次: 性能=${perfScore}`);
          successfulRuns.push({ score: perfScore, data, result });
        } else {
          console.log(`[Scanner] ${site.name} 第 ${attempt} 次性能分为 null`);
        }

        // 跑完 2 次后，如果差距 ≤3 分，跳过第 3 次（稳定性够好）
        if (attempt === 2 && successfulRuns.length === 2) {
          const diff = Math.abs(successfulRuns[0].score - successfulRuns[1].score);
          if (diff <= 3) {
            console.log(`[Scanner] ${site.name} 前两次差 ${diff} 分，跳过第3次`);
            break;
          }
          console.log(`[Scanner] ${site.name} 前两次差 ${diff} 分，补跑第3次提高准确度`);
        }

        if (attempt < maxRuns) await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        attempts.push({ attempt, success: false, score: null, error: err.message });
        console.log(`[Scanner] ${site.name} 第 ${attempt} 次异常: ${err.message}`);
        if (attempt < maxRuns) {
          await new Promise(r => setTimeout(r, 2000));
          await this.close();
          await this.init();
        }
      }
    }

    // 所有维度都取多次中位数/平均（消除 Lighthouse 波动）
    let bestData = null, bestResult = null;
    if (successfulRuns.length >= 2) {
      // 对每个维度独立取平均/中位数
      const medianOf = (arr) => {
        const valid = arr.filter(v => v != null && v >= 0).sort((a,b) => a-b);
        if (valid.length === 0) return null;
        if (valid.length === 1) return valid[0];
        if (valid.length === 2) return Math.round((valid[0] + valid[1]) / 2);
        return valid[1]; // 3个取中位数
      };

      const merged = { ...successfulRuns[0].data };
      merged.score_performance = medianOf(successfulRuns.map(r => r.data.score_performance));
      merged.score_accessibility = medianOf(successfulRuns.map(r => r.data.score_accessibility));
      merged.score_best_practices = medianOf(successfulRuns.map(r => r.data.score_best_practices));
      merged.score_seo = medianOf(successfulRuns.map(r => r.data.score_seo));

      // 指标也取中位数
      for (const key of ['fcp','lcp','cls','tbt','si','tti','total_size','request_count','dom_count']) {
        merged[key] = medianOf(successfulRuns.map(r => r.data[key]));
      }

      bestData = merged;
      bestResult = successfulRuns[Math.floor(successfulRuns.length / 2)].result;
      console.log(`[Scanner] ${site.name} ${successfulRuns.length}次取中位数: 性能=${merged.score_performance} A11y=${merged.score_accessibility} BP=${merged.score_best_practices} SEO=${merged.score_seo}`);
    } else if (successfulRuns.length === 1) {
      bestData = successfulRuns[0].data;
      bestResult = successfulRuns[0].result;
    }

    return { bestData: bestData || {}, bestResult, attempts };
  }

  /**
   * 对数正态分布 CDF（Lighthouse 评分曲线核心）
   * median: 指标中位数基准值, p10: 第 10 百分位值（得分 0.9 的点）
   */
  /**
   * Gauss 误差函数近似（Abramowitz & Stegun，与 Lighthouse shared/statistics.js 一致）
   */
  _erf(x) {
    const sign = Math.sign(x);
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
    return sign * (1 - y * Math.exp(-x * x));
  }

  /**
   * 对数正态评分（完全复刻 Lighthouse shared/statistics.js → getLogNormalScore）
   * 公式: score = 0.5 * erfc(ln(value/median) * INVERSE_ERFC_ONE_FIFTH / (-ln(p10/median)))
   */
  _logNormalScore(value, p10, median) {
    if (value <= 0) return 1;
    const INVERSE_ERFC_ONE_FIFTH = 0.9061938024368232;
    const xLogRatio = Math.log(value / median);
    const p10LogRatio = -Math.log(p10 / median);
    if (p10LogRatio === 0) return value <= median ? 1 : 0;
    const standardizedX = xLogRatio * INVERSE_ERFC_ONE_FIFTH / p10LogRatio;
    const percentile = (1 - this._erf(standardizedX)) / 2;
    return Math.max(0, Math.min(1, percentile));
  }

  /**
   * 单指标评分（复刻 Lighthouse shared/util.js → computeLogNormalScore）
   * 包含 >0.9 时的线性提升
   */
  _metricScore(value, p10, median) {
    if (value == null) return 0.5;
    let score = this._logNormalScore(value, p10, median);
    // Lighthouse 对 >0.9 的分数做线性提升，使接近满分更容易
    if (score > 0.9) {
      score += 0.05 * (score - 0.9);
    }
    return Math.min(1, score);
  }

  /**
   * 性能分估算（完全复刻 Lighthouse v11 评分）
   * p10/median 来源: Lighthouse 源码各 metric audit 文件（desktop 模式）
   * 权重来源: core/config/default-config.js
   */
  _estimatePerformanceScore(fcp, lcp, tbt, cls, si) {
    const fcpS = this._metricScore(fcp, 934, 1600);
    const lcpS = this._metricScore(lcp, 1200, 2400);
    const tbtS = this._metricScore(tbt, 150, 350);
    const clsS = this._metricScore(cls, 0.1, 0.25);
    const siS  = this._metricScore(si, 1311, 2300);
    // Lighthouse v11 权重: FCP 10%, SI 10%, LCP 25%, TBT 30%, CLS 25%
    const weighted = fcpS * 0.1 + siS * 0.1 + lcpS * 0.25 + tbtS * 0.3 + clsS * 0.25;
    // Lighthouse 用 Math.floor 而非 Math.round
    return Math.floor(weighted * 100);
  }

  /**
   * Puppeteer 仅安全检测（轻量，~3-5s）
   */
  async captureSecurityOnly(site) {
    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      let response;
      try {
        response = await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 15000 });
      } catch (e) {
        response = await page.goto(site.url, { waitUntil: 'load', timeout: 10000 }).catch(() => null);
      }

      // 资源指标（Lighthouse 可能没有）
      const resourceMetrics = await page.evaluate(() => {
        const entries = performance.getEntriesByType('resource');
        return {
          totalSize: entries.reduce((a, e) => a + (e.transferSize || 0), 0),
          requestCount: entries.length,
          domCount: document.querySelectorAll('*').length
        };
      });

      // 前端安全检测（页面内 DOM 分析）
      const securityResult = await page.evaluate(() => {
        const checks = [];
        const w = (pass, weight, msg, severity) => {
          checks.push({ pass, weight, severity: severity || 'medium' });
          if (!pass) checks.push({ issue: msg, severity: severity || 'medium' });
        };

        w(location.protocol === 'https:', 5, '未使用 HTTPS，数据传输不安全', 'critical');

        const mixedResources = [...document.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"][rel="stylesheet"], iframe[src^="http:"]')];
        w(mixedResources.length === 0, 4, `${mixedResources.length} 个 HTTP 混合内容资源`, 'high');

        const insecureForms = [...document.querySelectorAll('form[action^="http:"]')].length;
        w(insecureForms === 0, 2, `${insecureForms} 个表单提交到非 HTTPS 地址`, 'high');

        const pwdFields = document.querySelectorAll('input[type="password"]');
        const pwdNoAuto = [...pwdFields].filter(el => el.getAttribute('autocomplete') === 'off' || el.getAttribute('autocomplete') === 'new-password').length;
        w(pwdFields.length === 0 || pwdNoAuto === pwdFields.length, 1, `${pwdFields.length - pwdNoAuto} 个密码框未设置 autocomplete=off`, 'medium');

        const html = document.documentElement.innerHTML;
        const sensitivePatterns = [
          { re: /['"](?:sk-|ak_|AKIA)[A-Za-z0-9]{20,}['"]/, name: 'API Key/Secret Key' },
          { re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/, name: '硬编码密码' },
          { re: /(?:mysql|postgres|mongodb|redis):\/\/[^'">\s]+/, name: '数据库连接串' },
          { re: /(?:Bearer|token)\s+[A-Za-z0-9._\-]{20,}/, name: 'Token/Bearer 凭证' },
        ];
        const leaks = [];
        const scripts = [...document.querySelectorAll('script:not([src])')].map(s => s.textContent).join('\n');
        const comments = html.match(/<!--[\s\S]*?-->/g) || [];
        const checkText = scripts + '\n' + comments.join('\n');
        for (const p of sensitivePatterns) { if (p.re.test(checkText)) leaks.push(p.name); }
        w(leaks.length === 0, 4, `源码中发现敏感信息: ${leaks.join(', ')}`, 'critical');

        const extScripts = [...document.querySelectorAll('script[src]')].filter(s => { try { return new URL(s.src).hostname !== location.hostname; } catch(e) { return false; } });
        const noIntegrity = extScripts.filter(s => !s.getAttribute('integrity')).length;
        w(extScripts.length === 0 || noIntegrity / extScripts.length < 0.5, 2, `${noIntegrity}/${extScripts.length} 个外部脚本未使用 SRI`, 'medium');

        const unsafeBlank = [...document.querySelectorAll('a[target="_blank"]')].filter(a => { const rel = (a.getAttribute('rel') || '').toLowerCase(); return !rel.includes('noopener') && !rel.includes('noreferrer'); }).length;
        w(unsafeBlank === 0, 1, `${unsafeBlank} 个 target="_blank" 链接缺少 rel="noopener noreferrer"`, 'low');

        const unsafeIframes = [...document.querySelectorAll('iframe')].filter(f => !f.getAttribute('sandbox')).length;
        w(unsafeIframes === 0, 2, `${unsafeIframes} 个 iframe 未设置 sandbox 属性`, 'medium');

        const inlineHandlers = document.querySelectorAll('[onclick], [onerror], [onload], [onmouseover], [onfocus]').length;
        w(inlineHandlers < 10, 1, `${inlineHandlers} 个内联事件处理器（XSS 风险）`, 'low');

        const openRedirects = [...document.querySelectorAll('a[href]')].filter(a => /[?&](redirect|url|next|return|goto|target)=/i.test(a.getAttribute('href') || '')).length;
        w(openRedirects === 0, 2, `${openRedirects} 个链接含开放重定向参数`, 'high');

        const allLinks = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href') || '');
        const sensitiveLinks = allLinks.filter(h => /\/(admin|debug|console|swagger|api-doc|graphql|phpmyadmin|wp-admin|\.env|\.git|actuator)/i.test(h));
        w(sensitiveLinks.length === 0, 3, `页面暴露 ${sensitiveLinks.length} 个敏感路径链接: ${sensitiveLinks.slice(0, 3).join(', ')}`, 'high');

        const bodyText = document.body?.innerText || '';
        const errorLeaks = [];
        if (/at\s+\w+\s+\([\w/.]+:\d+:\d+\)/.test(bodyText)) errorLeaks.push('堆栈信息');
        if (/(?:sql|mysql|postgres|oracle|sqlite)\s*(?:error|exception|syntax)/i.test(bodyText)) errorLeaks.push('数据库错误');
        if (/(?:Warning|Fatal error|Parse error):\s+.+\s+in\s+\/[\w/]+\.php/i.test(bodyText)) errorLeaks.push('PHP 错误');
        w(errorLeaks.length === 0, 3, `页面泄露: ${errorLeaks.join(', ')}`, 'high');

        const passed = checks.filter(c => c.weight && c.pass);
        const totalWeight = checks.filter(c => c.weight).reduce((a, c) => a + c.weight, 0);
        const passedWeight = passed.reduce((a, c) => a + c.weight, 0);
        const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 100;
        const issues = checks.filter(c => c.issue).map(c => ({ issue: c.issue, severity: c.severity }));
        return { score, issues, totalWeight, passedWeight };
      });

      // 外部安全检测：HTTP 安全头 + Cookie
      let secExtChecks = 0, secExtFail = 0;
      const secExtIssues = [];

      try {
        const respHeaders = response ? response.headers() : {};
        const headerChecks = [
          { name: 'Content-Security-Policy', weight: 4, severity: 'high', alias: ['content-security-policy'] },
          { name: 'X-Frame-Options', weight: 3, severity: 'high', alias: ['x-frame-options'] },
          { name: 'X-Content-Type-Options', weight: 2, severity: 'medium', alias: ['x-content-type-options'] },
          { name: 'Strict-Transport-Security', weight: 3, severity: 'high', alias: ['strict-transport-security'] },
          { name: 'X-XSS-Protection', weight: 1, severity: 'low', alias: ['x-xss-protection'] },
          { name: 'Referrer-Policy', weight: 2, severity: 'medium', alias: ['referrer-policy'] },
          { name: 'Permissions-Policy', weight: 2, severity: 'medium', alias: ['permissions-policy', 'feature-policy'] },
        ];
        for (const hc of headerChecks) {
          secExtChecks += hc.weight;
          if (!hc.alias.some(a => respHeaders[a] || respHeaders[a.toLowerCase()])) {
            secExtFail += hc.weight;
            secExtIssues.push({ issue: `缺少 ${hc.name} 安全头`, severity: hc.severity });
          }
        }
        const acao = respHeaders['access-control-allow-origin'];
        secExtChecks += 2;
        if (acao === '*') { secExtFail += 2; secExtIssues.push({ issue: 'CORS 配置为 *（允许任意跨域）', severity: 'medium' }); }
      } catch (e) {}

      try {
        const cookies = await page.cookies();
        let insecureCookies = 0;
        const cookieIssues = [];
        for (const c of cookies) {
          const problems = [];
          if (!c.secure && site.url.startsWith('https')) problems.push('无 Secure');
          if (!c.httpOnly && /(?:sess|token|auth|sid|jwt)/i.test(c.name)) problems.push('无 HttpOnly');
          if (problems.length > 0) { insecureCookies++; if (cookieIssues.length < 3) cookieIssues.push(`Cookie "${c.name}": ${problems.join(', ')}`); }
        }
        secExtChecks += 3;
        if (insecureCookies > 0) { secExtFail += 3; secExtIssues.push({ issue: `${insecureCookies} 个 Cookie 安全标志缺失: ${cookieIssues.join('; ')}`, severity: 'high' }); }
      } catch (e) {}

      const secTotalW = securityResult.totalWeight + secExtChecks;
      const secPassedW = securityResult.passedWeight + (secExtChecks - secExtFail);
      const finalScore = secTotalW > 0 ? Math.round((secPassedW / secTotalW) * 100) : 100;
      const allIssues = [...securityResult.issues, ...secExtIssues];

      return { score: finalScore, issues: allIssues, ...resourceMetrics };
    } catch (e) {
      return null;
    } finally {
      try { await page.close(); } catch (e) {}
    }
  }

  /**
   * PageSpeed Insights API 兜底（Google 服务器运行 Lighthouse）
   */
  async fetchPSI(url) {
    try {
      const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=PERFORMANCE&category=ACCESSIBILITY&category=BEST_PRACTICES&category=SEO&strategy=DESKTOP`;
      const https = require('https');
      const data = await new Promise((resolve, reject) => {
        const req = https.get(apiUrl, { timeout: 120000 }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('PSI API 超时')); });
      });

      if (data.error) {
        console.log(`[Scanner] PSI API 错误: ${data.error.message}`);
        return null;
      }

      const cats = data.lighthouseResult?.categories || {};
      const audits = data.lighthouseResult?.audits || {};
      return {
        performance: cats.performance?.score != null ? Math.round(cats.performance.score * 100) : null,
        accessibility: cats.accessibility?.score != null ? Math.round(cats.accessibility.score * 100) : null,
        bestPractices: cats['best-practices']?.score != null ? Math.round(cats['best-practices'].score * 100) : null,
        seo: cats.seo?.score != null ? Math.round(cats.seo.score * 100) : null,
        fcp: audits['first-contentful-paint']?.numericValue ?? null,
        lcp: audits['largest-contentful-paint']?.numericValue ?? null,
        cls: audits['cumulative-layout-shift']?.numericValue ?? null,
        tbt: audits['total-blocking-time']?.numericValue ?? null,
        si: audits['speed-index']?.numericValue ?? null,
      };
    } catch (e) {
      console.log(`[Scanner] PSI API 请求失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 保存页面截图
   */
  async saveScreenshot(site, result) {
    try {
      const screenshotDir = path.join(__dirname, '../../reports/screenshots');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      const { lhr } = result;
      if (lhr.audits['final-screenshot']?.details?.data) {
        const base64Data = lhr.audits['final-screenshot'].details.data.replace(/^data:image\/\w+;base64,/, '');
        const fileName = `${site.id}_${Date.now()}.jpg`;
        const filePath = path.join(screenshotDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        return `screenshots/${fileName}`;
      }
    } catch (error) {
      console.error('[Scanner] 截图保存失败:', error.message);
    }
    return null;
  }

  /**
   * 全维度 Puppeteer 兜底采集
   * Lighthouse 超时/失败时，直接用浏览器 API 采集四个维度的数据
   */
  async captureWebVitals(site) {
    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width: 1920, height: 1080 });

      // 收集控制台错误
      const consoleErrors = [];
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      page.on('pageerror', err => consoleErrors.push(err.message));

      // 注入 PerformanceObserver
      await page.evaluateOnNewDocument(() => {
        window.__webVitals = { lcp: 0, cls: 0, fcp: 0, tbt: 0 };
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) window.__webVitals.lcp = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__webVitals.cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) window.__webVitals.tbt += entry.duration - 50;
          }
        }).observe({ type: 'longtask', buffered: true });
      });

      let response;
      try {
        response = await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 20000 });
      } catch (navErr) {
        // networkidle2 超时，降级用 load 事件
        response = await page.goto(site.url, { waitUntil: 'load', timeout: 15000 }).catch(() => null);
      }
      await new Promise(r => setTimeout(r, 3000));

      // ==================== 性能指标 ====================
      const vitals = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] || {};
        const paintEntries = performance.getEntriesByType('paint');
        const fcpEntry = paintEntries.find(e => e.name === 'first-contentful-paint');
        const resources = performance.getEntriesByType('resource');
        // 注意：所有指标用 null 表示未采集，0 表示真实的 0
        const lcp = window.__webVitals?.lcp;
        const cls = window.__webVitals?.cls;
        const tbt = window.__webVitals?.tbt;
        const dcl = nav.domContentLoadedEventEnd ?? null;
        const loadEnd = nav.loadEventEnd ?? null;
        return {
          fcp: fcpEntry ? fcpEntry.startTime : null,
          lcp: (lcp != null && lcp > 0) ? lcp : null,
          cls: cls != null ? cls : null,
          tbt: tbt != null ? tbt : null,
          ttfb: nav.responseStart ?? null,
          domContentLoaded: dcl,
          load: loadEnd,
          si: dcl != null ? Math.round((dcl + (loadEnd ?? dcl)) / 2) : null,
          tti: nav.domInteractive ?? null,
          totalSize: resources.reduce((a, r) => a + (r.transferSize ?? 0), 0),
          requestCount: resources.length,
          domCount: document.querySelectorAll('*').length,
        };
      });

      // ==================== 无障碍检测（axe-core 引擎，和 Lighthouse 同源） ====================
      let a11yResult;
      try {
        const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
        await page.evaluate(axeSource);
        const axePromise = page.evaluate(async () => {
          const results = await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] },
            resultTypes: ['violations'],
          });
          return {
            violations: results.violations.map(v => ({
              id: v.id,
              impact: v.impact,
              description: v.help,
              count: v.nodes.length
            })),
            passes: results.passes?.length || 0,
            total: (results.passes?.length || 0) + results.violations.length
          };
        });
        const axeTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('axe-core 超时(30s)')), 30000));
        const axeResults = await Promise.race([axePromise, axeTimeout]);

        // 用 Lighthouse 的加权方式计算分数
        // Lighthouse a11y: 每个审计项按 impact 加权（critical=10, serious=7, moderate=3, minor=1）
        const impactWeight = { critical: 10, serious: 7, moderate: 3, minor: 1 };
        const totalChecks = axeResults.total;
        const violations = axeResults.violations;
        let totalWeight = totalChecks * 3; // 平均每项权重 3
        let lostWeight = 0;
        const issues = [];

        for (const v of violations) {
          const w = impactWeight[v.impact] || 3;
          lostWeight += w;
          issues.push(`${v.description} (${v.count}个元素, ${v.impact})`);
        }

        const score = totalWeight > 0 ? Math.max(0, Math.min(100, Math.round((1 - lostWeight / totalWeight) * 100))) : 100;
        a11yResult = { score, issues };
        console.log(`[Scanner] axe-core 无障碍: ${score} 分, ${violations.length} 个问题, ${axeResults.passes} 项通过`);
      } catch (axeErr) {
        console.log(`[Scanner] axe-core 失败，使用简化检测: ${axeErr.message}`);
        // 降级：简化检测
        a11yResult = await page.evaluate(() => {
          let score = 100; const issues = [];
          const imgs = document.querySelectorAll('img');
          const noAlt = [...imgs].filter(i => !i.hasAttribute('alt')).length;
          if (noAlt > 0) { score -= Math.min(20, noAlt * 2); issues.push(`${noAlt} 张图片缺少 alt`); }
          if (!document.documentElement.getAttribute('lang')) { score -= 7; issues.push('缺少 html lang'); }
          if (!document.title.trim()) { score -= 7; issues.push('缺少标题'); }
          if (!document.querySelector('meta[name="viewport"]')) { score -= 10; issues.push('缺少 viewport'); }
          const emptyBtns = [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length;
          if (emptyBtns > 0) { score -= Math.min(10, emptyBtns); issues.push(`${emptyBtns} 个按钮无文本`); }
          return { score: Math.max(0, score), issues };
        });
      }

      // ==================== 最佳实践检测（对标 Lighthouse best-practices 审计项） ====================
      const bpResult = await page.evaluate(() => {
        const checks = [];
        const w = (pass, weight, msg) => { checks.push({ pass, weight }); if (!pass) checks.push({ issue: msg }); };

        // is-on-https (weight:5)
        w(location.protocol === 'https:', 5, '未使用 HTTPS');

        // 混合内容检测
        const mixedContent = [...document.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"]')].length;
        w(mixedContent === 0, 3, `${mixedContent} 个 HTTP 混合内容资源`);

        // geolocation-on-start (weight:1) - 检查是否有 geolocation 调用
        w(true, 1, ''); // 无法在 evaluate 中检测，默认通过

        // notification-on-start (weight:1) - 同上
        w(true, 1, '');

        // paste-preventing-inputs (weight:3)
        const pasteBlocked = [...document.querySelectorAll('input')].filter(i => i.getAttribute('onpaste') === 'return false' || i.getAttribute('oncopy') === 'return false').length;
        w(pasteBlocked === 0, 3, `${pasteBlocked} 个输入框禁止粘贴`);

        // image-aspect-ratio (weight:1)
        const imgs = document.querySelectorAll('img');
        let distorted = 0;
        imgs.forEach(img => {
          if (img.naturalWidth && img.naturalHeight && img.width && img.height) {
            const natRatio = img.naturalWidth / img.naturalHeight;
            const dispRatio = img.width / img.height;
            if (Math.abs(natRatio - dispRatio) > 0.1) distorted++;
          }
        });
        w(distorted === 0, 1, `${distorted} 张图片宽高比异常`);

        // image-size-responsive (weight:1)
        let oversized = 0;
        imgs.forEach(img => {
          if (img.naturalWidth && img.width && img.naturalWidth > img.width * 2.5) oversized++;
        });
        w(oversized === 0, 1, `${oversized} 张图片分辨率远大于显示尺寸`);

        // doctype (weight:1)
        w(!!document.doctype, 1, '缺少 DOCTYPE 声明');

        // charset (weight:1)
        w(!!(document.querySelector('meta[charset]') || document.querySelector('meta[http-equiv="Content-Type"]')), 1, '缺少 charset 声明');

        // no-unload-listeners (weight:1) - 无法在 evaluate 中检测
        w(true, 1, '');

        // deprecations (weight:5) - 检测废弃 API
        let deprecated = 0;
        if (document.all !== undefined && typeof document.all === 'object') deprecated++; // document.all
        w(deprecated === 0, 5, `使用了 ${deprecated} 个废弃 API`);

        // third-party-cookies (weight:5) - 粗略检测第三方脚本数量
        const thirdPartyScripts = [...document.querySelectorAll('script[src]')].filter(s => {
          try { return new URL(s.src).hostname !== location.hostname; } catch(e) { return false; }
        }).length;
        w(thirdPartyScripts < 20, 5, `${thirdPartyScripts} 个第三方脚本（可能带第三方 cookie）`);

        // inspector-issues (weight:1) - 无法在 evaluate 中检测
        w(true, 1, '');

        const passed = checks.filter(c => c.weight && c.pass);
        const totalWeight = checks.filter(c => c.weight).reduce((a, c) => a + c.weight, 0);
        const passedWeight = passed.reduce((a, c) => a + c.weight, 0);
        const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 100;
        const issues = checks.filter(c => c.issue).map(c => c.issue);

        return { score, issues, passedWeight, totalWeight };
      });

      // errors-in-console (weight:1) - 外部合并计算
      if (consoleErrors.length > 0) {
        const bpTotalW = (bpResult.totalWeight || 28) + 1;
        const bpPassedW = bpResult.passedWeight || Math.round(bpResult.score * (bpResult.totalWeight || 28) / 100);
        // 控制台有错误 → 这 1 权重不得分
        bpResult.score = Math.round((bpPassedW / bpTotalW) * 100);
        bpResult.issues.push(`${consoleErrors.length} 个控制台错误`);
      }

      // ==================== SEO 检测（对标 Lighthouse 全部 14 项 SEO 审计） ====================
      const seoResult = await page.evaluate(() => {
        const checks = [];
        const w = (pass, weight, msg) => { checks.push({ pass, weight }); if (!pass) checks.push({ issue: msg }); };

        // viewport (weight:1)
        w(!!document.querySelector('meta[name="viewport"]'), 1, '缺少 viewport meta');

        // document-title (weight:1)
        w(!!document.title.trim(), 1, '缺少页面标题');

        // meta-description (weight:1)
        const desc = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim();
        w(!!desc, 1, '缺少 meta description');

        // http-status-code (weight:1) - 由外部补充

        // link-text (weight:1) - 检查是否有描述性不足的链接文本
        const genericTexts = ['点击这里','click here','更多','more','了解更多','learn more','read more','查看','详情','here','链接'];
        const badLinks = [...document.querySelectorAll('a')].filter(a => {
          const t = a.textContent.trim().toLowerCase();
          return t && genericTexts.includes(t);
        }).length;
        w(badLinks <= 2, 1, `${badLinks} 个链接文本描述性不足`);

        // crawlable-anchors (weight:1) - a 标签有有效 href
        const uncrawlable = [...document.querySelectorAll('a')].filter(a => {
          const href = a.getAttribute('href');
          return !href || href === '#' || href === 'javascript:void(0)' || href.startsWith('javascript:');
        }).length;
        w(uncrawlable <= 3, 1, `${uncrawlable} 个不可爬取的链接`);

        // is-crawlable (weight:1) - 检查 robots meta 和 X-Robots-Tag
        const robotsMeta = document.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
        w(!robotsMeta.includes('noindex'), 1, 'robots meta 设置了 noindex');

        // image-alt (weight:1)
        const imgs = document.querySelectorAll('img');
        const noAlt = [...imgs].filter(i => !i.hasAttribute('alt')).length;
        w(imgs.length === 0 || noAlt / imgs.length < 0.5, 1, `${noAlt}/${imgs.length} 张图片缺少 alt`);

        // hreflang (weight:1)
        const hreflang = document.querySelectorAll('link[rel="alternate"][hreflang]');
        // 如果有多语言链接，检查是否包含自引用
        if (hreflang.length > 0) {
          const selfRef = [...hreflang].some(l => {
            try { return new URL(l.href).pathname === location.pathname; } catch(e) { return false; }
          });
          w(selfRef, 1, 'hreflang 缺少自引用');
        } else {
          w(true, 1, ''); // 无多语言页面，默认通过
        }

        // canonical (weight:1)
        w(!!document.querySelector('link[rel="canonical"]'), 1, '缺少 canonical 链接');

        // font-size (weight:1) - 检查是否有过小字体（< 12px）
        const smallText = [...document.querySelectorAll('p, span, a, li, td')].slice(0, 100).filter(el => {
          const size = parseFloat(getComputedStyle(el).fontSize);
          return size < 12 && el.textContent.trim();
        }).length;
        w(smallText <= 5, 1, `${smallText} 个元素字体小于 12px`);

        // tap-targets (weight:1) - 检查可点击元素尺寸 >= 48x48
        const tappable = document.querySelectorAll('a, button, input, select, textarea, [onclick]');
        let tooSmall = 0;
        [...tappable].slice(0, 100).forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24) && el.textContent.trim()) tooSmall++;
        });
        w(tooSmall <= 3, 1, `${tooSmall} 个点击目标尺寸过小`);

        // plugins (weight:1) - 检查 Flash 等过时插件
        const hasPlugins = document.querySelectorAll('embed, object, applet').length;
        w(hasPlugins === 0, 1, `页面使用了 ${hasPlugins} 个过时插件`);

        // robots.txt (weight:1) - 由外部补充

        const passed = checks.filter(c => c.weight && c.pass);
        const totalWeight = checks.filter(c => c.weight).reduce((a, c) => a + c.weight, 0);
        const passedWeight = passed.reduce((a, c) => a + c.weight, 0);
        const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 100;
        const issues = checks.filter(c => c.issue).map(c => c.issue);

        return { score, issues, totalWeight, passedWeight };
      });

      // 外部补充：http-status-code (weight:1) 和 robots.txt (weight:1)
      const httpStatus = response?.status() || 200;
      const seoTotalW = (seoResult.totalWeight || 12) + 2;
      let seoExternalFail = 0;
      if (httpStatus >= 400) { seoExternalFail++; seoResult.issues.push(`HTTP 状态码 ${httpStatus}`); }
      // robots.txt 检测
      let robotsPage = null;
      try {
        const robotsUrl = new URL('/robots.txt', site.url).href;
        robotsPage = await this.browser.newPage();
        const robotsResp = await robotsPage.goto(robotsUrl, { timeout: 5000 }).catch(() => null);
        const robotsOk = robotsResp && robotsResp.status() === 200;
        if (!robotsOk) { seoExternalFail++; seoResult.issues.push('robots.txt 不可访问'); }
      } catch (e) {
        seoExternalFail++;
        seoResult.issues.push('robots.txt 检测失败');
      } finally {
        if (robotsPage) await robotsPage.close().catch(() => {});
      }
      // 重新计算分数（合并外部检测项）
      const seoPassedW = (seoResult.passedWeight || Math.round(seoResult.score * seoResult.totalWeight / 100)) + (2 - seoExternalFail);
      seoResult.score = Math.round((seoPassedW / seoTotalW) * 100);

      // ==================== 安全评估（HTTP 安全头 + 接口/信息暴露 + Cookie 安全 + 前端安全） ====================
      const securityResult = await page.evaluate(() => {
        const checks = [];
        const w = (pass, weight, msg, severity) => {
          checks.push({ pass, weight, severity: severity || 'medium' });
          if (!pass) checks.push({ issue: msg, severity: severity || 'medium' });
        };

        // === 1. 前端可检测的安全项 ===

        // HTTPS (weight:5, critical)
        w(location.protocol === 'https:', 5, '未使用 HTTPS，数据传输不安全', 'critical');

        // 混合内容 (weight:4, high)
        const mixedResources = [
          ...document.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"][rel="stylesheet"], iframe[src^="http:"], video[src^="http:"], audio[src^="http:"]')
        ];
        w(mixedResources.length === 0, 4, `${mixedResources.length} 个 HTTP 混合内容资源（图片/脚本/样式/iframe）`, 'high');

        // 表单安全：action 是否指向 HTTPS (weight:2, high)
        const insecureForms = [...document.querySelectorAll('form[action^="http:"]')].length;
        w(insecureForms === 0, 2, `${insecureForms} 个表单提交到非 HTTPS 地址`, 'high');

        // 表单 autocomplete：密码字段应关闭 autocomplete (weight:1, medium)
        const pwdFields = document.querySelectorAll('input[type="password"]');
        const pwdNoAuto = [...pwdFields].filter(el => el.getAttribute('autocomplete') === 'off' || el.getAttribute('autocomplete') === 'new-password').length;
        w(pwdFields.length === 0 || pwdNoAuto === pwdFields.length, 1, `${pwdFields.length - pwdNoAuto} 个密码框未设置 autocomplete=off`, 'medium');

        // 页面源码敏感信息泄露 (weight:4, critical)
        const html = document.documentElement.innerHTML;
        const sensitivePatterns = [
          { re: /['"](?:sk-|ak_|AKIA)[A-Za-z0-9]{20,}['"]/, name: 'API Key/Secret Key' },
          { re: /['"][A-Za-z0-9+/]{40,}={0,2}['"]/, name: '疑似 Base64 编码密钥' },
          { re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/, name: '硬编码密码' },
          { re: /(?:mysql|postgres|mongodb|redis):\/\/[^'">\s]+/, name: '数据库连接串' },
          { re: /(?:Bearer|token)\s+[A-Za-z0-9._\-]{20,}/, name: 'Token/Bearer 凭证' },
        ];
        const leaks = [];
        // 只检查注释和 script 标签内的内容
        const scripts = [...document.querySelectorAll('script:not([src])')].map(s => s.textContent).join('\n');
        const comments = html.match(/<!--[\s\S]*?-->/g) || [];
        const checkText = scripts + '\n' + comments.join('\n');
        for (const p of sensitivePatterns) {
          if (p.re.test(checkText)) leaks.push(p.name);
        }
        w(leaks.length === 0, 4, `源码中发现敏感信息: ${leaks.join(', ')}`, 'critical');

        // 外部脚本安全：第三方脚本是否使用 integrity (weight:2, medium)
        const extScripts = [...document.querySelectorAll('script[src]')].filter(s => {
          try { return new URL(s.src).hostname !== location.hostname; } catch(e) { return false; }
        });
        const noIntegrity = extScripts.filter(s => !s.getAttribute('integrity')).length;
        w(extScripts.length === 0 || noIntegrity / extScripts.length < 0.5, 2, `${noIntegrity}/${extScripts.length} 个外部脚本未使用 SRI (Subresource Integrity)`, 'medium');

        // target="_blank" 安全 (weight:1, low)
        const unsafeBlank = [...document.querySelectorAll('a[target="_blank"]')].filter(a => {
          const rel = (a.getAttribute('rel') || '').toLowerCase();
          return !rel.includes('noopener') && !rel.includes('noreferrer');
        }).length;
        w(unsafeBlank === 0, 1, `${unsafeBlank} 个 target="_blank" 链接缺少 rel="noopener noreferrer"`, 'low');

        // iframe 安全 (weight:2, medium)
        const unsafeIframes = [...document.querySelectorAll('iframe')].filter(f => !f.getAttribute('sandbox')).length;
        w(unsafeIframes === 0, 2, `${unsafeIframes} 个 iframe 未设置 sandbox 属性`, 'medium');

        // 内联事件处理器 (weight:1, low) — 大量内联 onclick 等可能是 XSS 风险
        const inlineHandlers = document.querySelectorAll('[onclick], [onerror], [onload], [onmouseover], [onfocus]').length;
        w(inlineHandlers < 10, 1, `${inlineHandlers} 个内联事件处理器（XSS 风险）`, 'low');

        // 开放重定向检测 (weight:2, high)
        const openRedirects = [...document.querySelectorAll('a[href]')].filter(a => {
          const href = a.getAttribute('href') || '';
          return /[?&](redirect|url|next|return|goto|target)=/i.test(href);
        }).length;
        w(openRedirects === 0, 2, `${openRedirects} 个链接含开放重定向参数`, 'high');

        // 信息暴露：页面中的调试/管理入口链接 (weight:3, high)
        const allLinks = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href') || '');
        const sensitiveLinks = allLinks.filter(h =>
          /\/(admin|debug|console|swagger|api-doc|graphql|phpmyadmin|wp-admin|\.env|\.git|actuator)/i.test(h)
        );
        w(sensitiveLinks.length === 0, 3, `页面暴露 ${sensitiveLinks.length} 个敏感路径链接: ${sensitiveLinks.slice(0, 3).join(', ')}`, 'high');

        // 错误信息泄露：页面中是否包含堆栈/数据库信息 (weight:3, high)
        const bodyText = document.body?.innerText || '';
        const errorLeaks = [];
        if (/at\s+\w+\s+\([\w/.]+:\d+:\d+\)/.test(bodyText)) errorLeaks.push('堆栈信息');
        if (/(?:sql|mysql|postgres|oracle|sqlite)\s*(?:error|exception|syntax)/i.test(bodyText)) errorLeaks.push('数据库错误');
        if (/(?:Warning|Fatal error|Parse error):\s+.+\s+in\s+\/[\w/]+\.php/i.test(bodyText)) errorLeaks.push('PHP 错误');
        w(errorLeaks.length === 0, 3, `页面泄露: ${errorLeaks.join(', ')}`, 'high');

        const passed = checks.filter(c => c.weight && c.pass);
        const totalWeight = checks.filter(c => c.weight).reduce((a, c) => a + c.weight, 0);
        const passedWeight = passed.reduce((a, c) => a + c.weight, 0);
        const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 100;
        const issues = checks.filter(c => c.issue).map(c => ({ issue: c.issue, severity: c.severity }));

        return { score, issues, totalWeight, passedWeight };
      });

      // === 2. 外部安全检测（需要独立请求） ===
      let secExtChecks = 0;
      let secExtFail = 0;
      const secExtIssues = [];

      // 2a. HTTP 安全头检测 (通过 CDP 获取响应头)
      try {
        const respHeaders = response ? response.headers() : {};
        const headerChecks = [
          { name: 'Content-Security-Policy', weight: 4, severity: 'high', alias: ['content-security-policy'] },
          { name: 'X-Frame-Options', weight: 3, severity: 'high', alias: ['x-frame-options'] },
          { name: 'X-Content-Type-Options', weight: 2, severity: 'medium', alias: ['x-content-type-options'] },
          { name: 'Strict-Transport-Security', weight: 3, severity: 'high', alias: ['strict-transport-security'] },
          { name: 'X-XSS-Protection', weight: 1, severity: 'low', alias: ['x-xss-protection'] },
          { name: 'Referrer-Policy', weight: 2, severity: 'medium', alias: ['referrer-policy'] },
          { name: 'Permissions-Policy', weight: 2, severity: 'medium', alias: ['permissions-policy', 'feature-policy'] },
        ];
        for (const hc of headerChecks) {
          secExtChecks += hc.weight;
          const found = hc.alias.some(a => respHeaders[a] || respHeaders[a.toLowerCase()]);
          if (!found) {
            secExtFail += hc.weight;
            secExtIssues.push({ issue: `缺少 ${hc.name} 安全头`, severity: hc.severity });
          }
        }
      } catch (e) {}

      // 2b. Cookie 安全标志检测
      try {
        const cookies = await page.cookies();
        let insecureCookies = 0;
        const cookieIssues = [];
        for (const c of cookies) {
          const problems = [];
          if (!c.secure && site.url.startsWith('https')) problems.push('无 Secure');
          if (!c.httpOnly && /(?:sess|token|auth|sid|jwt)/i.test(c.name)) problems.push('无 HttpOnly');
          if (c.sameSite === 'None' && !c.secure) problems.push('SameSite=None 无 Secure');
          if (problems.length > 0) {
            insecureCookies++;
            if (cookieIssues.length < 3) cookieIssues.push(`Cookie "${c.name}": ${problems.join(', ')}`);
          }
        }
        secExtChecks += 3;
        if (insecureCookies > 0) {
          secExtFail += 3;
          secExtIssues.push({ issue: `${insecureCookies} 个 Cookie 安全标志缺失: ${cookieIssues.join('; ')}`, severity: 'high' });
        }
      } catch (e) {}

      // 2c. CORS 检测（直接读当前页面响应头，无额外请求）
      try {
        const corsHeaders = response ? response.headers() : {};
        const acao = corsHeaders['access-control-allow-origin'];
        secExtChecks += 2;
        if (acao === '*') {
          secExtFail += 2;
          secExtIssues.push({ issue: 'CORS 配置为 Access-Control-Allow-Origin: *（允许任意域名跨域访问）', severity: 'medium' });
        }
      } catch (e) {}

      // 2d. Source Map 引用检测（只检查页面 script 标签是否有 sourceMappingURL，不发额外请求）
      try {
        const hasSourceMap = await page.evaluate(() => {
          const scripts = [...document.querySelectorAll('script[src]')];
          // 检查 script 标签的 sourceMappingURL 注释（内联脚本）
          const inlineScripts = [...document.querySelectorAll('script:not([src])')];
          let mapCount = 0;
          inlineScripts.forEach(s => { if (/\/\/[#@]\s*sourceMappingURL=/.test(s.textContent)) mapCount++; });
          // 检查外部脚本是否 .min.js（通常有 .map 文件）
          const minScripts = scripts.filter(s => /\.min\.js/.test(s.src)).length;
          return { mapCount, minScripts, totalExtScripts: scripts.length };
        });
        secExtChecks += 2;
        if (hasSourceMap.mapCount > 0) {
          secExtFail += 2;
          secExtIssues.push({ issue: `${hasSourceMap.mapCount} 个内联脚本包含 sourceMappingURL（可能泄露源码）`, severity: 'medium' });
        }
      } catch (e) {}

      // 合并前端检测 + 外部检测分数
      const secTotalW = securityResult.totalWeight + secExtChecks;
      const secPassedW = securityResult.passedWeight + (secExtChecks - secExtFail);
      const finalSecScore = secTotalW > 0 ? Math.round((secPassedW / secTotalW) * 100) : 100;
      const allSecIssues = [
        ...securityResult.issues,
        ...secExtIssues
      ];

      const secFinal = { score: finalSecScore, issues: allSecIssues, totalWeight: secTotalW, passedWeight: secPassedW };

      const fm = v => v != null ? Math.round(v) + 'ms' : 'N/A';
      console.log(`[Scanner] Puppeteer 全维度采集: FCP=${fm(vitals.fcp)} LCP=${fm(vitals.lcp)} CLS=${vitals.cls != null ? vitals.cls.toFixed(3) : 'N/A'} TBT=${fm(vitals.tbt)} | A11y=${a11yResult.score} BP=${bpResult.score} SEO=${seoResult.score} Security=${secFinal.score}`);

      return {
        ...vitals,
        totalSize: vitals.totalSize,
        requestCount: vitals.requestCount,
        domCount: vitals.domCount,
        // 五个维度的备用评分
        a11yScore: a11yResult.score,
        a11yIssues: a11yResult.issues,
        bpScore: bpResult.score,
        bpIssues: bpResult.issues,
        seoScore: seoResult.score,
        seoIssues: seoResult.issues,
        securityScore: secFinal.score,
        securityIssues: secFinal.issues,
      };
    } catch (e) {
      return null;
    } finally {
      try { page.removeAllListeners(); await page.close(); } catch (e) {}
    }
  }

  /**
   * 检查阈值告警
   */
  checkThresholds(data) {
    const t = config.alert.thresholds;
    const below = (val, threshold) => val != null && val >= 0 && val < threshold;
    const above = (val, threshold) => val != null && val > threshold;
    return (
      below(data.score_performance, t.performance) ||
      below(data.score_accessibility, t.accessibility) ||
      below(data.score_best_practices, t['best-practices']) ||
      below(data.score_seo, t.seo) ||
      above(data.fcp, t.FCP) ||
      above(data.lcp, t.LCP) ||
      above(data.cls, t.CLS) ||
      above(data.tbt, t.TBT)
    );
  }
}

// 默认单例（向后兼容）
const defaultInstance = new PerformanceScanner();
module.exports = defaultInstance;
module.exports.PerformanceScanner = PerformanceScanner;
