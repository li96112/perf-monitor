const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const scanner = require('../core/scanner');
const crawler = require('../core/crawler');
const analyzer = require('../ai/analyzer');
const scheduler = require('../scheduler/cron');
const reportPusher = require('../scheduler/report-pusher');
const config = require('../../config/default');

// 统一数据标准化：-1 → null，保证前端只处理一种"无数据"
const SCORE_KEYS = ['score_performance', 'score_accessibility', 'score_best_practices', 'score_seo', 'score_security'];
const METRIC_KEYS = ['fcp', 'lcp', 'cls', 'tbt', 'si', 'tti', 'total_size', 'request_count', 'dom_count'];
function normalizeScan(scan) {
  if (!scan) return scan;
  const out = { ...scan };
  for (const key of SCORE_KEYS) {
    if (out[key] != null && out[key] < 0) out[key] = null;
  }
  for (const key of METRIC_KEYS) {
    if (out[key] != null && out[key] < 0) out[key] = null;
  }
  return out;
}
function normalizeScans(scans) {
  if (!Array.isArray(scans)) return scans;
  return scans.map(normalizeScan);
}

// ==================== 部门管理 ====================
router.get('/departments', (req, res) => {
  const depts = db.getAllDepartments();
  res.json({ success: true, data: depts });
});

router.post('/departments', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: '部门名称必填' });
    const dept = db.addDepartment(name);
    res.json({ success: true, data: dept });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/departments/:id', (req, res) => {
  try {
    db.deleteDepartment(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 仪表盘 ====================
router.get('/dashboard', (req, res) => {
  try {
    const stats = db.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 平台删除 ====================
// 项目级域名批量替换
router.put('/platforms/domain', (req, res) => {
  try {
    const { group_name, platform_name, old_domain, new_domain } = req.body;
    if (!group_name || !platform_name || !new_domain) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }
    const sites = db.getAllSites().filter(s => s.group_name === group_name && s.platform_name === platform_name);
    let updated = 0;
    for (const site of sites) {
      try {
        const urlObj = new URL(site.url);
        // 如果指定了旧域名，只替换匹配的；否则替换所有
        if (old_domain && urlObj.hostname !== old_domain) continue;
        urlObj.hostname = new_domain;
        db.updateSite(site.id, { ...site, url: urlObj.toString() });
        updated++;
      } catch (e) {
        // URL 解析失败，跳过
      }
    }
    res.json({ success: true, data: { updated, total: sites.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 项目级巡检频率更新
router.put('/platforms/cron', (req, res) => {
  try {
    const { group_name, platform_name, scan_cron } = req.body;
    if (!group_name || !platform_name || !scan_cron) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }
    const sites = db.getAllSites().filter(s => s.group_name === group_name && s.platform_name === platform_name);
    let updated = 0;
    for (const site of sites) {
      db.updateSite(site.id, { ...site, scan_cron });
      updated++;
    }
    scheduler.refresh();
    res.json({ success: true, data: { updated } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/platforms', (req, res) => {
  try {
    const { group_name, platform_name } = req.query;
    if (!group_name || !platform_name) {
      return res.status(400).json({ success: false, error: '需要 group_name 和 platform_name 参数' });
    }
    const sites = db.getAllSites().filter(s => s.group_name === group_name && s.platform_name === platform_name);
    let deleted = 0;
    for (const site of sites) {
      scheduler.removeJob(site.id);
      db.deleteSite(site.id);
      deleted++;
    }
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 站点管理 ====================
router.get('/sites', (req, res) => {
  const sites = db.getAllSites();
  res.json({ success: true, data: sites });
});

// ==================== 站点自动发现 ====================
router.post('/sites/discover', async (req, res) => {
  try {
    const { url, depth, maxPages } = req.body;
    if (!url) return res.status(400).json({ success: false, error: '入口 URL 必填' });

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ success: false, error: 'URL 需以 http:// 或 https:// 开头' });
    }

    const maxD = Math.min(parseInt(depth) || 2, 3);
    const maxP = Math.min(parseInt(maxPages) || 50, 100);

    const pages = await crawler.discover(url, maxD, maxP);
    await crawler.close();

    res.json({ success: true, data: pages });
  } catch (err) {
    try { await crawler.close(); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sites/batch-add', (req, res) => {
  try {
    const { sites, group_name, platform_name } = req.body;
    if (!sites || !Array.isArray(sites) || sites.length === 0) {
      return res.status(400).json({ success: false, error: '请至少选择一个页面' });
    }
    if (!group_name) return res.status(400).json({ success: false, error: '部门名称必填' });
    if (!platform_name) return res.status(400).json({ success: false, error: '平台名称必填' });

    // 自动创建不存在的部门
    const existingDept = db.getAllDepartments().find(d => d.name === group_name);
    if (!existingDept) {
      db.addDepartment(group_name);
    }

    const results = { success: 0, failed: 0, errors: [], created: [] };

    for (const item of sites) {
      try {
        const name = item.name || item.title || '未命名页面';
        const url = item.url;
        if (!url) {
          results.failed++;
          results.errors.push({ url: '', reason: 'URL 为空' });
          continue;
        }

        const site = db.addSite({
          name,
          platform_name,
          url,
          group_name,
          scan_cron: '0 */6 * * *'
        });

        // 添加定时任务
        const fullSite = db.getSite(site.id);
        if (fullSite) scheduler.addJob(fullSite);

        results.success++;
        results.created.push({ name, url });
      } catch (err) {
        results.failed++;
        results.errors.push({ url: item.url, reason: err.message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/sites/:id', (req, res) => {
  const site = db.getSite(req.params.id);
  if (!site) return res.status(404).json({ success: false, error: '站点不存在' });
  res.json({ success: true, data: site });
});

router.post('/sites', (req, res) => {
  try {
    const { name, platform_name, url, group_name, login_required, login_url, login_user, login_pass, headers, cookies, scan_cron } = req.body;
    if (!name || !url) return res.status(400).json({ success: false, error: '名称和URL必填' });

    const site = db.addSite({ name, platform_name, url, group_name, login_required, login_url, login_user, login_pass, headers, cookies, scan_cron });

    // 添加定时任务
    const fullSite = db.getSite(site.id);
    if (fullSite) scheduler.addJob(fullSite);

    res.json({ success: true, data: site });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/sites/:id', (req, res) => {
  try {
    const site = db.updateSite(req.params.id, req.body);
    if (!site) return res.status(404).json({ success: false, error: '站点不存在' });

    // 刷新定时任务
    scheduler.addJob(site);

    res.json({ success: true, data: site });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/sites/:id', (req, res) => {
  try {
    scheduler.removeJob(req.params.id);
    db.deleteSite(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 批量导入站点 ====================
router.post('/sites/import', (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || !csv.trim()) {
      return res.status(400).json({ success: false, error: 'CSV 内容不能为空' });
    }

    const lines = csv.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const results = { success: 0, failed: 0, errors: [], created: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 解析 CSV 行，支持逗号分隔
      const parts = line.split(',').map(s => s.trim());

      if (parts.length < 4) {
        results.failed++;
        results.errors.push({ line: i + 1, content: line, reason: '格式错误：至少需要 部门,平台名称,页面名称,URL 四列' });
        continue;
      }

      const [group_name, platform_name, name, url, scan_cron] = parts;

      if (!group_name || !platform_name || !name || !url) {
        results.failed++;
        results.errors.push({ line: i + 1, content: line, reason: '部门、平台名称、页面名称、URL 均不能为空' });
        continue;
      }

      // 简单校验 URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        results.failed++;
        results.errors.push({ line: i + 1, content: line, reason: 'URL 格式不正确，需以 http:// 或 https:// 开头' });
        continue;
      }

      try {
        // 自动创建不存在的部门
        const existingDept = db.getAllDepartments().find(d => d.name === group_name);
        if (!existingDept) {
          db.addDepartment(group_name);
        }

        // 创建站点
        const site = db.addSite({
          name,
          platform_name,
          url,
          group_name,
          scan_cron: scan_cron || '0 */6 * * *'
        });

        // 添加定时任务
        const fullSite = db.getSite(site.id);
        if (fullSite) scheduler.addJob(fullSite);

        results.success++;
        results.created.push({ name, platform_name, url, group_name });
      } catch (err) {
        results.failed++;
        results.errors.push({ line: i + 1, content: line, reason: err.message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 巡检操作 ====================
// 停止巡检（必须在 /scan/:siteId 前面，否则 stop 会被当成 siteId）
router.post('/scan/stop', (req, res) => {
  try {
    scheduler.stopCurrentScan();
    res.json({ success: true, message: '巡检已停止' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 巡检单个站点
router.post('/scan/:siteId', async (req, res) => {
  try {
    const site = db.getSite(req.params.siteId);
    if (!site) return res.status(404).json({ success: false, error: '站点不存在' });
    const result = scheduler.queueBatch([site]);
    const msg = result.queued ? `已加入队列（队列 ${result.queueSize} 个）` : '巡检任务已启动';
    res.json({ success: true, message: msg, queued: result.queued, siteId: site.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/scan-all', async (req, res) => {
  try {
    const sites = db.getEnabledSites();
    const result = scheduler.queueBatch(sites);
    const msg = result.skipped
      ? '巡检正在进行中，无需重复提交'
      : result.queued
        ? `${sites.length} 个页面已加入队列（队列 ${result.queueSize} 个）`
        : `已启动 ${sites.length} 个页面的巡检`;
    res.json({ success: true, message: msg, count: sites.length, queued: result.queued, skipped: result.skipped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 按部门巡检
router.post('/scan-department', async (req, res) => {
  try {
    const { group_name } = req.body;
    if (!group_name) return res.status(400).json({ success: false, error: '部门名称必填' });
    const sites = db.getEnabledSites().filter(s => s.group_name === group_name);
    if (sites.length === 0) return res.json({ success: true, message: '该部门下没有站点', count: 0 });
    const result = scheduler.queueBatch(sites);
    const msg = result.queued ? `${sites.length} 个页面已加入队列` : `已启动 ${sites.length} 个页面的巡检`;
    res.json({ success: true, message: msg, count: sites.length, queued: result.queued });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 按平台巡检
router.post('/scan-platform', async (req, res) => {
  try {
    const { group_name, platform_name } = req.body;
    if (!group_name || !platform_name) return res.status(400).json({ success: false, error: '部门和平台名称必填' });
    const sites = db.getEnabledSites().filter(s => s.group_name === group_name && s.platform_name === platform_name);
    if (sites.length === 0) return res.json({ success: true, message: '该平台下没有站点', count: 0 });
    const result = scheduler.queueBatch(sites);
    const msg = result.queued ? `${sites.length} 个页面已加入队列` : `已启动 ${sites.length} 个页面的巡检`;
    res.json({ success: true, message: msg, count: sites.length, queued: result.queued });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 巡检进度查询
router.get('/scan/progress', (req, res) => {
  const progress = scheduler.getScanProgress();
  res.json({ success: true, data: progress });
});

// 巡检状态查询（兼容）
router.get('/scan/status', (req, res) => {
  res.json({ success: true, data: { scanning: scheduler.scanLock } });
});

// ==================== 巡检记录 ====================
router.get('/scans', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const scans = normalizeScans(db.getAllScans(limit));
  res.json({ success: true, data: scans });
});

router.get('/scans/:id', (req, res) => {
  const scan = normalizeScan(db.getScan(req.params.id));
  if (!scan) return res.status(404).json({ success: false, error: '记录不存在' });
  res.json({ success: true, data: scan });
});

router.get('/sites/:siteId/scans', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const scans = normalizeScans(db.getSiteScanHistory(req.params.siteId, limit));
  res.json({ success: true, data: scans });
});

router.get('/sites/:siteId/latest', (req, res) => {
  const scan = normalizeScan(db.getLatestScan(req.params.siteId));
  res.json({ success: true, data: scan });
});

// ==================== 趋势和统计 ====================
router.get('/sites/:siteId/trend', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  const trend = normalizeScans(db.getSiteTrend(req.params.siteId, limit));
  res.json({ success: true, data: trend });
});

router.get('/sites/:siteId/stats', (req, res) => {
  const stats = db.getSiteStats(req.params.siteId);
  res.json({ success: true, data: stats });
});

// ==================== AI 分析 ====================
router.get('/sites/:siteId/reports', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const reports = db.getSiteReports(req.params.siteId, limit);
  res.json({ success: true, data: reports });
});

router.post('/sites/:siteId/analyze', async (req, res) => {
  try {
    const analysis = await analyzer.compareAnalysis(req.params.siteId);
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 告警 ====================
router.get('/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const alerts = db.getRecentAlerts(limit);
  res.json({ success: true, data: alerts });
});

router.get('/sites/:siteId/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const alerts = db.getSiteAlerts(req.params.siteId, limit);
  res.json({ success: true, data: alerts });
});

// ==================== 定时任务管理 ====================
router.get('/scheduler/status', (req, res) => {
  const status = scheduler.getStatus();
  // 按项目（部门+平台）分组
  const groups = {};
  for (const item of status) {
    const site = db.getSite(item.id);
    const dept = site?.group_name || '默认分组';
    const platform = site?.platform_name || '未分类';
    const key = `${dept}|||${platform}`;
    if (!groups[key]) groups[key] = { department: dept, platform, cron: item.cron, sites: [] };
    groups[key].sites.push({ id: item.id, name: item.name, url: item.url });
  }
  res.json({ success: true, data: Object.values(groups) });
});

router.post('/scheduler/refresh', (req, res) => {
  scheduler.refresh();
  res.json({ success: true, message: '定时任务已刷新' });
});

// ==================== 健康度 ====================
router.get('/health', (req, res) => {
  try {
    const data = db.getHealthData();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/health/ranking', (req, res) => {
  try {
    const data = db.getHealthRanking();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 定时报告推送 ====================
router.post('/report/preview', (req, res) => {
  try {
    const { type } = req.body;
    let content;
    if (type === 'weekly') {
      content = reportPusher.generateWeeklyReport();
    } else {
      content = reportPusher.generateDailyReport();
    }
    res.json({ success: true, data: { content } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/report/push', async (req, res) => {
  try {
    const { type, webhook_type, webhook_url } = req.body;

    // 生成报告
    let content;
    if (type === 'weekly') {
      content = reportPusher.generateWeeklyReport();
    } else {
      content = reportPusher.generateDailyReport();
    }

    if (!webhook_url) {
      return res.status(400).json({ success: false, error: 'Webhook 地址不能为空' });
    }

    // 推送
    let result;
    if (webhook_type === 'dingtalk') {
      result = await reportPusher.pushToDingtalk(webhook_url, content);
    } else {
      result = await reportPusher.pushToFeishu(webhook_url, content);
    }

    // 记录推送日志
    db.addReportPushLog({
      report_type: type || 'daily',
      status: result.success ? 'success' : 'failed',
      detail: result.success ? `推送成功 (${webhook_type})` : `推送失败: ${result.error || '未知错误'}`
    });

    res.json({ success: true, data: result });
  } catch (err) {
    db.addReportPushLog({
      report_type: req.body.type || 'daily',
      status: 'failed',
      detail: `推送异常: ${err.message}`
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 扫描配置 ====================
router.get('/scan/config', (req, res) => {
  res.json({ success: true, data: { throttleEnabled: config.scan.throttleEnabled } });
});

router.put('/scan/config', (req, res) => {
  try {
    if (req.body.throttleEnabled !== undefined) {
      config.scan.throttleEnabled = !!req.body.throttleEnabled;
    }
    res.json({ success: true, data: { throttleEnabled: config.scan.throttleEnabled } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/report/config', (req, res) => {
  try {
    const configs = db.getReportConfigs();
    res.json({ success: true, data: configs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/report/config', (req, res) => {
  try {
    const { configs } = req.body;
    if (!configs || !Array.isArray(configs)) {
      return res.status(400).json({ success: false, error: '配置数据格式错误' });
    }

    const results = [];
    for (const cfg of configs) {
      if (!cfg.type || !['daily', 'weekly'].includes(cfg.type)) continue;
      const saved = db.saveReportConfig(cfg);
      results.push(saved);
    }

    // 刷新定时报告任务
    scheduler.refreshReportJobs();

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/report/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = db.getReportPushLogs(limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 排行榜 ====================
router.get('/ranking', (req, res) => {
  try {
    const sort = req.query.sort || 'health_score';
    const order = req.query.order || 'desc';
    const department = req.query.department || '全部';
    const data = db.getProjectRankingData(sort, order, department);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== AI 模型配置 ====================
router.get('/ai/providers', (req, res) => {
  res.json({ success: true, data: analyzer.PROVIDERS });
});

// 获取所有配置（脱敏）
router.get('/ai/configs', (req, res) => {
  try {
    const configs = db.getAllAiConfigs().map(c => ({
      ...c,
      api_key_masked: c.api_key && c.api_key.length > 10
        ? c.api_key.substring(0, 6) + '***' + c.api_key.slice(-4)
        : (c.api_key ? '***' : ''),
      api_key: undefined, // 不返回明文
    }));
    res.json({ success: true, data: configs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 添加配置
router.post('/ai/configs', (req, res) => {
  try {
    const saved = db.addAiConfig(req.body);
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新配置
router.put('/ai/configs/:id', (req, res) => {
  try {
    const saved = db.updateAiConfig(req.params.id, req.body);
    if (!saved) return res.status(404).json({ success: false, error: '配置不存在' });
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除配置
router.delete('/ai/configs/:id', (req, res) => {
  try {
    db.deleteAiConfig(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 启用某个配置（其他自动禁用）
router.post('/ai/configs/:id/enable', (req, res) => {
  try {
    db.enableAiConfig(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 全部禁用
router.post('/ai/configs/disable-all', (req, res) => {
  try {
    db.disableAllAiConfigs();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 测试连接（临时配置，不保存）
router.post('/ai/test', async (req, res) => {
  try {
    const tempCfg = { ...req.body };
    // 编辑模式没传新 key 时，从数据库取已有 key
    if (!tempCfg.api_key && tempCfg._config_id) {
      const existing = db.getAllAiConfigs().find(c => c.id === tempCfg._config_id);
      if (existing) tempCfg.api_key = existing.api_key;
    }
    if (!tempCfg.api_key) {
      return res.json({ success: true, data: { success: false, error: '未配置 API Key' } });
    }
    const result = await analyzer.testConnectionWith(tempCfg);
    res.json({ success: true, data: result });
  } catch (err) {
    res.json({ success: true, data: { success: false, error: err.message } });
  }
});

// AI 启用状态
router.get('/ai/status', (req, res) => {
  try {
    const active = db.getActiveAiConfig();
    res.json({ success: true, data: { enabled: !!active, provider: active?.provider || null, model: active?.model || null } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 兼容旧接口
router.get('/ai/config', (req, res) => {
  try { res.json({ success: true, data: db.getAiConfig() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ==================== AI Token 用量 ====================
router.get('/ai/token-usage/summary', (req, res) => {
  try {
    const summary = db.getTokenUsageSummary();
    // 计算费用估算
    const detail = db.getTokenUsageDetail('day', 365);
    let totalCost = { today: 0, week: 0, month: 0 };
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);

    for (const row of detail) {
      const cost = analyzer.estimateCost(row.model, row.input_tokens, row.output_tokens);
      if (cost === null) continue;
      const rowDate = new Date(row.label);
      if (row.label === todayStr) totalCost.today += cost;
      if (rowDate >= weekAgo) totalCost.week += cost;
      if (rowDate >= monthAgo) totalCost.month += cost;
    }

    res.json({ success: true, data: {
      ...summary,
      cost: {
        today: +totalCost.today.toFixed(4),
        week: +totalCost.week.toFixed(4),
        month: +totalCost.month.toFixed(4),
      },
      pricing: analyzer.MODEL_PRICING,
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/ai/token-usage/detail', (req, res) => {
  try {
    const period = req.query.period || 'day';
    const limit = parseInt(req.query.limit) || 30;
    const detail = db.getTokenUsageDetail(period, limit);
    // 附加费用
    const rows = detail.map(row => ({
      ...row,
      total_tokens: row.input_tokens + row.output_tokens,
      cost: analyzer.estimateCost(row.model, row.input_tokens, row.output_tokens),
    }));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 截图 ====================
router.get('/screenshot/:filename', (req, res) => {
  const path = require('path');
  const filePath = path.join(__dirname, '../../reports/screenshots', req.params.filename);
  res.sendFile(filePath);
});

module.exports = router;
