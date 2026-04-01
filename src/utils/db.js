const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '../../data/perf-monitor.db');
const SCREENSHOT_DIR = path.join(__dirname, '../../reports/screenshots');

// 获取本地时间字符串（YYYY-MM-DD HH:mm:ss）
function localNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// N 天前的本地时间字符串（与 localNow 保持同时区）
function daysAgoLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let db = null;

// 确保 data 目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function getDb() {
  if (db) return db;
  throw new Error('Database not initialized. Call initDb() first.');
}

function initDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform_name TEXT DEFAULT '',
      url TEXT NOT NULL,
      group_name TEXT DEFAULT '默认分组',
      login_required INTEGER DEFAULT 0,
      login_url TEXT,
      login_user TEXT,
      login_pass TEXT,
      headers TEXT DEFAULT '{}',
      cookies TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      scan_cron TEXT DEFAULT '0 */6 * * *',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_records (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      score_performance INTEGER,
      score_accessibility INTEGER,
      score_best_practices INTEGER,
      score_seo INTEGER,
      score_security INTEGER,
      fcp REAL, lcp REAL, cls REAL, tbt REAL, si REAL, tti REAL,
      total_size INTEGER, request_count INTEGER, dom_count INTEGER,
      raw_data TEXT,
      ai_analysis TEXT, ai_suggestions TEXT,
      alert_triggered INTEGER DEFAULT 0, alert_sent INTEGER DEFAULT 0,
      screenshot_path TEXT,
      duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_reports (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      scan_id TEXT NOT NULL,
      report_type TEXT DEFAULT 'single',
      content TEXT NOT NULL,
      suggestions TEXT,
      risk_level TEXT DEFAULT 'low',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      scan_id TEXT NOT NULL,
      type TEXT NOT NULL,
      level TEXT DEFAULT 'warning',
      message TEXT NOT NULL,
      detail TEXT,
      channel TEXT,
      sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_config (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'daily',
      enabled INTEGER DEFAULT 0,
      cron TEXT DEFAULT '0 9 * * *',
      webhook_type TEXT DEFAULT 'feishu',
      webhook_url TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_push_log (
      id TEXT PRIMARY KEY,
      config_id TEXT,
      report_type TEXT NOT NULL,
      status TEXT DEFAULT 'success',
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // AI 模型配置（多配置，仅一个可启用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT DEFAULT '',
      base_url TEXT DEFAULT '',
      enabled INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  // AI Token 用量记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      purpose TEXT DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  // 索引
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_scan_site ON scan_records(site_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_scan_time ON scan_records(created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_alert_site ON alerts(site_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_report_push_log_time ON report_push_log(created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_token_usage_time ON ai_token_usage(created_at)');
  } catch (e) {}

  // 检查是否需要添加 platform_name 列（兼容升级）
  try {
    db.prepare('SELECT platform_name FROM sites LIMIT 1').get();
  } catch (e) {
    try { db.exec('ALTER TABLE sites ADD COLUMN platform_name TEXT DEFAULT ""'); } catch (e2) {}
  }

  // 检查是否需要添加 score_security 列（兼容升级）
  try {
    db.prepare('SELECT score_security FROM scan_records LIMIT 1').get();
  } catch (e) {
    try { db.exec('ALTER TABLE scan_records ADD COLUMN score_security INTEGER'); } catch (e2) {}
  }

  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// ==================== 基础操作 ====================
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params) || null;
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

// ==================== 站点操作 ====================
function addSite(site) {
  const id = uuidv4();
  run(
    `INSERT INTO sites (id, name, platform_name, url, group_name, login_required, login_url, login_user, login_pass, headers, cookies, scan_cron, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, site.name, site.platform_name || '', site.url, site.group_name || '默认分组',
     site.login_required ? 1 : 0, site.login_url || null,
     site.login_user || null, site.login_pass || null,
     JSON.stringify(site.headers || {}), site.cookies || '',
     site.scan_cron || '0 */6 * * *', localNow(), localNow()]
  );
  return { id, ...site };
}

function updateSite(id, site) {
  run(
    `UPDATE sites SET name=?, platform_name=?, url=?, group_name=?, login_required=?, login_url=?, login_user=?, login_pass=?, headers=?, cookies=?, scan_cron=?, enabled=?, updated_at=? WHERE id=?`,
    [site.name, site.platform_name || '', site.url, site.group_name || '默认分组',
     site.login_required ? 1 : 0, site.login_url || null,
     site.login_user || null, site.login_pass || null,
     JSON.stringify(site.headers || {}), site.cookies || '',
     site.scan_cron || '0 */6 * * *', site.enabled !== undefined ? (site.enabled ? 1 : 0) : 1, localNow(), id]
  );
  return getSite(id);
}

function deleteSite(id) {
  // 清理该站点的截图文件
  const scans = all('SELECT screenshot_path FROM scan_records WHERE site_id=? AND screenshot_path IS NOT NULL', [id]);
  for (const { screenshot_path } of scans) {
    const fullPath = path.join(__dirname, '../../reports', screenshot_path);
    try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) {}
  }
  // 级联删除关联数据
  run('DELETE FROM scan_records WHERE site_id=?', [id]);
  run('DELETE FROM ai_reports WHERE site_id=?', [id]);
  run('DELETE FROM alerts WHERE site_id=?', [id]);
  run('DELETE FROM sites WHERE id=?', [id]);
}
function getSite(id) { return get('SELECT * FROM sites WHERE id=?', [id]); }
function getAllSites() { return all('SELECT * FROM sites ORDER BY group_name, name'); }
function getEnabledSites() { return all('SELECT * FROM sites WHERE enabled=1 ORDER BY group_name, name'); }
function getSitesByGroup(group) { return all('SELECT * FROM sites WHERE group_name=? ORDER BY name', [group]); }

// ==================== 巡检记录操作 ====================
function createScan(siteId) {
  const id = uuidv4();
  run(`INSERT INTO scan_records (id, site_id, status, created_at) VALUES (?, ?, 'running', ?)`, [id, siteId, localNow()]);
  return id;
}

function updateScan(id, data) {
  run(
    `UPDATE scan_records SET status=?, score_performance=?, score_accessibility=?,
     score_best_practices=?, score_seo=?, score_security=?, fcp=?, lcp=?, cls=?, tbt=?, si=?, tti=?,
     total_size=?, request_count=?, dom_count=?, raw_data=?,
     ai_analysis=?, ai_suggestions=?, alert_triggered=?, screenshot_path=?, duration=?
     WHERE id=?`,
    [data.status, data.score_performance, data.score_accessibility,
     data.score_best_practices, data.score_seo, data.score_security,
     data.fcp, data.lcp, data.cls, data.tbt, data.si, data.tti,
     data.total_size, data.request_count, data.dom_count,
     JSON.stringify(data.raw_data || {}),
     data.ai_analysis || null, data.ai_suggestions || null,
     data.alert_triggered ? 1 : 0, data.screenshot_path || null,
     data.duration || 0, id]
  );
  return get('SELECT * FROM scan_records WHERE id=?', [id]);
}

function getScan(id) { return get('SELECT * FROM scan_records WHERE id=?', [id]); }
function getSiteScanHistory(siteId, limit = 50) {
  return all('SELECT * FROM scan_records WHERE site_id=? ORDER BY created_at DESC LIMIT ?', [siteId, limit]);
}
function getLatestScan(siteId) {
  return get('SELECT * FROM scan_records WHERE site_id=? AND status IN (\'completed\',\'partial\') ORDER BY created_at DESC LIMIT 1', [siteId]);
}
function getAllScans(limit = 100) {
  return all('SELECT sr.*, s.name as site_name, s.url as site_url FROM scan_records sr JOIN sites s ON sr.site_id=s.id WHERE sr.status IN (\'completed\',\'partial\') ORDER BY sr.created_at DESC LIMIT ?', [limit]);
}
function getSiteTrend(siteId, limit = 30) {
  return all(
    `SELECT score_performance, score_accessibility, score_best_practices, score_seo, score_security,
     fcp, lcp, cls, tbt, si, created_at
     FROM scan_records WHERE site_id=? AND status IN ('completed','partial')
     ORDER BY created_at DESC LIMIT ?`, [siteId, limit]
  );
}
function getSiteStats(siteId) {
  return get(
    `SELECT COUNT(*) as total,
     SUM(CASE WHEN status IN ('completed','partial') THEN 1 ELSE 0 END) as completed,
     SUM(CASE WHEN alert_triggered=1 THEN 1 ELSE 0 END) as alerts,
     AVG(CASE WHEN score_performance IS NOT NULL AND score_performance >= 0 THEN score_performance END) as avg_performance
     FROM scan_records WHERE site_id=?`, [siteId]
  );
}

// ==================== AI 报告操作 ====================
function saveReport(report) {
  const id = uuidv4();
  run(
    `INSERT INTO ai_reports (id, site_id, scan_id, report_type, content, suggestions, risk_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, report.site_id, report.scan_id, report.report_type || 'single',
     report.content, report.suggestions || null, report.risk_level || 'low', localNow()]
  );
  return id;
}

function getReportByScan(scanId) { return get('SELECT * FROM ai_reports WHERE scan_id=?', [scanId]); }
function getSiteReports(siteId, limit = 20) { return all('SELECT * FROM ai_reports WHERE site_id=? ORDER BY created_at DESC LIMIT ?', [siteId, limit]); }

// ==================== 告警操作 ====================
function saveAlert(alert) {
  const id = uuidv4();
  run(
    `INSERT INTO alerts (id, site_id, scan_id, type, level, message, detail, channel, sent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, alert.site_id, alert.scan_id, alert.type,
     alert.level || 'warning', alert.message, alert.detail || null,
     alert.channel || null, alert.sent ? 1 : 0, localNow()]
  );
  return id;
}

function getSiteAlerts(siteId, limit = 50) { return all('SELECT * FROM alerts WHERE site_id=? ORDER BY created_at DESC LIMIT ?', [siteId, limit]); }
function getRecentAlerts(limit = 50) { return all('SELECT a.*, s.name as site_name, s.url as site_url, s.platform_name, s.group_name FROM alerts a JOIN sites s ON a.site_id=s.id ORDER BY a.created_at DESC LIMIT ?', [limit]); }

// ==================== 仪表盘统计 ====================
function getDashboardStats() {
  const totalSites = get('SELECT COUNT(*) as count FROM sites WHERE enabled=1')?.count || 0;
  const totalScans = get('SELECT COUNT(*) as count FROM scan_records')?.count || 0;
  const totalAlerts = get('SELECT COUNT(*) as count FROM alerts')?.count || 0;

  const avgScores = get(`
    SELECT
      AVG(CASE WHEN score_performance IS NOT NULL AND score_performance >= 0 THEN score_performance END) as performance,
      AVG(CASE WHEN score_accessibility IS NOT NULL AND score_accessibility >= 0 THEN score_accessibility END) as accessibility,
      AVG(CASE WHEN score_best_practices IS NOT NULL AND score_best_practices >= 0 THEN score_best_practices END) as best_practices,
      AVG(CASE WHEN score_seo IS NOT NULL AND score_seo >= 0 THEN score_seo END) as seo,
      AVG(CASE WHEN score_security IS NOT NULL AND score_security >= 0 THEN score_security END) as security
    FROM scan_records WHERE status IN ('completed','partial')
    AND created_at = (SELECT MAX(created_at) FROM scan_records sr2 WHERE sr2.site_id = scan_records.site_id AND sr2.status IN ('completed','partial'))
  `) || { performance: null, accessibility: null, best_practices: null, seo: null, security: null };

  const siteScores = all(`
    SELECT s.id, s.name, s.platform_name, s.url, s.group_name,
    sr.score_performance, sr.score_accessibility, sr.score_best_practices, sr.score_seo, sr.score_security,
    sr.fcp, sr.lcp, sr.cls, sr.tbt, sr.created_at as last_scan
    FROM sites s
    LEFT JOIN scan_records sr ON s.id = sr.site_id
    AND sr.created_at = (SELECT MAX(created_at) FROM scan_records WHERE site_id = s.id AND status IN ('completed','partial'))
    WHERE s.enabled = 1
    ORDER BY s.group_name, s.name
  `);

  return { totalSites, totalScans, totalAlerts, avgScores, siteScores };
}

// ==================== 部门操作 ====================
function addDepartment(name) {
  const id = uuidv4();
  const maxOrder = get('SELECT MAX(sort_order) as max_order FROM departments')?.max_order || 0;
  run('INSERT INTO departments (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)', [id, name, maxOrder + 1, localNow()]);
  return { id, name };
}

function getAllDepartments() {
  return all('SELECT * FROM departments ORDER BY sort_order, name');
}

function deleteDepartment(id) {
  const dept = get('SELECT * FROM departments WHERE id=?', [id]);
  if (dept) {
    run('UPDATE sites SET group_name="默认分组" WHERE group_name=?', [dept.name]);
    run('DELETE FROM departments WHERE id=?', [id]);
  }
}

function renameDepartment(id, newName) {
  const dept = get('SELECT * FROM departments WHERE id=?', [id]);
  if (dept) {
    run('UPDATE sites SET group_name=? WHERE group_name=?', [newName, dept.name]);
    run('UPDATE departments SET name=? WHERE id=?', [newName, id]);
  }
}

// ==================== 健康度计算 ====================
function getHealthData() {
  const latestScans = all(`
    SELECT s.id as site_id, s.name, s.platform_name, s.url, s.group_name,
      sr.score_performance, sr.score_accessibility, sr.score_best_practices, sr.score_seo,
      sr.status, sr.created_at as last_scan
    FROM sites s
    LEFT JOIN scan_records sr ON s.id = sr.site_id
      AND sr.created_at = (SELECT MAX(created_at) FROM scan_records WHERE site_id = s.id AND status IN ('completed','partial'))
    WHERE s.enabled = 1
    ORDER BY s.group_name, s.platform_name, s.name
  `);

  const stabilityRows = all(`
    SELECT site_id,
      COUNT(*) as total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
    FROM scan_records
    GROUP BY site_id
  `);
  const stabilityMap = {};
  stabilityRows.forEach(r => {
    stabilityMap[r.site_id] = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 100;
  });

  const sitesWithHealth = latestScans.map(site => {
    const perf = site.score_performance != null && site.score_performance >= 0 ? site.score_performance : null;
    const a11y = site.score_accessibility != null && site.score_accessibility >= 0 ? site.score_accessibility : null;
    const bp = site.score_best_practices != null && site.score_best_practices >= 0 ? site.score_best_practices : null;
    const seo = site.score_seo != null && site.score_seo >= 0 ? site.score_seo : null;
    const sec = site.score_security != null && site.score_security >= 0 ? site.score_security : null;
    const stability = stabilityMap[site.site_id] || 100;

    // 健康度：只算有数据的维度，权重按比例重分配
    let healthScore = null;
    if (perf !== null) {
      const dims = [
        { val: perf, weight: 0.35 },
        { val: a11y, weight: 0.1 },
        { val: bp, weight: 0.1 },
        { val: seo, weight: 0.1 },
        { val: sec, weight: 0.15 },
        { val: stability, weight: 0.2 }
      ];
      const validDims = dims.filter(d => d.val != null);
      const totalWeight = validDims.reduce((a, d) => a + d.weight, 0);
      healthScore = Math.round(validDims.reduce((a, d) => a + d.val * (d.weight / totalWeight), 0));
    }

    return { ...site, stability, health_score: healthScore };
  });

  const validSites = sitesWithHealth.filter(s => s.health_score !== null);
  const globalHealth = validSites.length > 0
    ? Math.round(validSites.reduce((a, s) => a + s.health_score, 0) / validSites.length)
    : null;

  // 每个维度独立过滤 null，只算有数据的站点
  const safeAvg = (arr, key) => {
    const valid = arr.filter(s => s[key] != null && s[key] >= 0);
    return valid.length > 0 ? Math.round(valid.reduce((a, s) => a + s[key], 0) / valid.length) : null;
  };
  const perfAvg = safeAvg(validSites, 'score_performance');
  const a11yAvg = safeAvg(validSites, 'score_accessibility');
  const bpAvg = safeAvg(validSites, 'score_best_practices');
  const seoAvg = safeAvg(validSites, 'score_seo');
  const secAvg = safeAvg(validSites, 'score_security');
  const stabilityAvg = validSites.length > 0 ? Math.round(validSites.reduce((a, s) => a + s.stability, 0) / validSites.length) : 100;

  const deptMap = {};
  sitesWithHealth.forEach(s => {
    const dept = s.group_name || '默认分组';
    if (!deptMap[dept]) deptMap[dept] = [];
    deptMap[dept].push(s);
  });

  const deptHealth = Object.entries(deptMap).map(([name, sites]) => {
    const valid = sites.filter(s => s.health_score !== null);
    const avg = valid.length > 0 ? Math.round(valid.reduce((a, s) => a + s.health_score, 0) / valid.length) : null;
    return { name, health_score: avg, site_count: sites.length, valid_count: valid.length };
  }).sort((a, b) => (b.health_score ?? -1) - (a.health_score ?? -1));

  const platMap = {};
  sitesWithHealth.forEach(s => {
    const key = `${s.group_name || '默认分组'}|||${s.platform_name || '未分类'}`;
    if (!platMap[key]) platMap[key] = [];
    platMap[key].push(s);
  });

  const platformHealth = Object.entries(platMap).map(([key, sites]) => {
    const [dept, platform] = key.split('|||');
    const valid = sites.filter(s => s.health_score !== null);
    const perfValid = valid.filter(s => s.score_performance != null && s.score_performance >= 0);
    const avgPerf = perfValid.length > 0 ? Math.round(perfValid.reduce((a, s) => a + s.score_performance, 0) / perfValid.length) : null;
    const avgHealth = valid.length > 0 ? Math.round(valid.reduce((a, s) => a + s.health_score, 0) / valid.length) : null;
    const passCount = valid.filter(s => s.health_score >= 60).length;
    const passRate = valid.length > 0 ? Math.round((passCount / valid.length) * 100) : 0;
    return {
      department: dept, platform, page_count: sites.length,
      avg_performance: avgPerf, avg_health: avgHealth, pass_rate: passRate,
      status: avgHealth >= 80 ? 'healthy' : avgHealth >= 60 ? 'warning' : 'critical'
    };
  }).sort((a, b) => b.avg_health - a.avg_health);

  return {
    globalHealth,
    dimensions: { performance: perfAvg, accessibility: a11yAvg, bestPractices: bpAvg, seo: seoAvg, security: secAvg, stability: stabilityAvg },
    deptHealth, platformHealth, sites: sitesWithHealth
  };
}

function getHealthRanking() {
  const healthData = getHealthData();

  // 按项目聚合
  const projectMap = new Map();
  for (const site of healthData.sites) {
    const key = `${site.group_name || '默认分组'}|||${site.platform_name || '未分类'}`;
    if (!projectMap.has(key)) projectMap.set(key, []);
    projectMap.get(key).push(site);
  }

  const projects = [];
  for (const [key, pages] of projectMap) {
    const [dept, platform] = key.split('|||');
    const valid = pages.filter(s => s.health_score !== null);
    if (valid.length === 0) continue;

    const avg = (arr, f) => {
      const vals = arr.filter(s => s[f] != null && s[f] >= 0);
      return vals.length > 0 ? Math.round(vals.reduce((a, s) => a + s[f], 0) / vals.length) : null;
    };

    projects.push({
      department: dept,
      platform,
      page_count: pages.length,
      performance: avg(valid, 'score_performance'),
      health_score: avg(valid, 'health_score'),
      pages: pages.map(s => ({
        name: s.name, url: s.url, site_id: s.site_id,
        score_performance: s.score_performance,
        health_score: s.health_score,
      })),
    });
  }

  const sorted = [...projects].sort((a, b) => (a.health_score ?? -1) - (b.health_score ?? -1));

  const worst = sorted.slice(0, 10).map((p, i) => ({ rank: i + 1, ...p }));
  const best = [...projects].sort((a, b) => (b.health_score ?? -1) - (a.health_score ?? -1)).slice(0, 10).map((p, i) => ({ rank: i + 1, ...p }));

  return { worst, best };
}

// ==================== 报告推送配置操作 ====================
function getReportConfigs() {
  return all('SELECT * FROM report_config ORDER BY type');
}

function getReportConfig(id) {
  return get('SELECT * FROM report_config WHERE id=?', [id]);
}

function getReportConfigByType(type) {
  return get('SELECT * FROM report_config WHERE type=?', [type]);
}

function saveReportConfig(config) {
  const existing = getReportConfigByType(config.type);
  if (existing) {
    run(
      `UPDATE report_config SET enabled=?, cron=?, webhook_type=?, webhook_url=? WHERE id=?`,
      [config.enabled ? 1 : 0, config.cron || '0 9 * * *', config.webhook_type || 'feishu', config.webhook_url || '', existing.id]
    );
    return getReportConfig(existing.id);
  } else {
    const id = uuidv4();
    run(
      `INSERT INTO report_config (id, type, enabled, cron, webhook_type, webhook_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, config.type, config.enabled ? 1 : 0, config.cron || '0 9 * * *', config.webhook_type || 'feishu', config.webhook_url || '', localNow()]
    );
    return getReportConfig(id);
  }
}

function deleteReportConfig(id) {
  run('DELETE FROM report_config WHERE id=?', [id]);
}

// ==================== 推送日志操作 ====================
function addReportPushLog(log) {
  const id = uuidv4();
  run(
    `INSERT INTO report_push_log (id, config_id, report_type, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, log.config_id || null, log.report_type, log.status || 'success', log.detail || null, localNow()]
  );
  return id;
}

function getReportPushLogs(limit = 50) {
  return all('SELECT * FROM report_push_log ORDER BY created_at DESC LIMIT ?', [limit]);
}

// ==================== 排行榜数据 ====================
function getRankingData(sortBy = 'health_score', order = 'desc', department = '全部') {
  const latestScans = all(`
    SELECT s.id as site_id, s.name, s.platform_name, s.url, s.group_name,
      sr.score_performance, sr.score_accessibility, sr.score_best_practices, sr.score_seo, sr.score_security,
      sr.status, sr.created_at as last_scan
    FROM sites s
    LEFT JOIN scan_records sr ON s.id = sr.site_id
      AND sr.created_at = (SELECT MAX(created_at) FROM scan_records WHERE site_id = s.id AND status IN ('completed','partial'))
    WHERE s.enabled = 1
    ORDER BY s.group_name, s.platform_name, s.name
  `);

  const prevScans = all(`
    SELECT sr.site_id,
      sr.score_performance, sr.score_accessibility, sr.score_best_practices, sr.score_seo, sr.score_security
    FROM scan_records sr
    WHERE sr.status IN ('completed','partial')
      AND sr.created_at = (
        SELECT MAX(sr2.created_at) FROM scan_records sr2
        WHERE sr2.site_id = sr.site_id AND sr2.status IN ('completed','partial')
          AND sr2.created_at < (SELECT MAX(sr3.created_at) FROM scan_records sr3 WHERE sr3.site_id = sr.site_id AND sr3.status IN ('completed','partial'))
      )
  `);
  const prevMap = {};
  prevScans.forEach(r => { prevMap[r.site_id] = r; });

  const stabilityRows = all(`
    SELECT site_id,
      COUNT(*) as total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
    FROM scan_records
    GROUP BY site_id
  `);
  const stabilityMap = {};
  stabilityRows.forEach(r => {
    stabilityMap[r.site_id] = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 100;
  });

  let sites = latestScans.map(site => {
    const perf = site.score_performance != null && site.score_performance >= 0 ? site.score_performance : null;
    const a11y = site.score_accessibility != null && site.score_accessibility >= 0 ? site.score_accessibility : null;
    const bp = site.score_best_practices != null && site.score_best_practices >= 0 ? site.score_best_practices : null;
    const seo = site.score_seo != null && site.score_seo >= 0 ? site.score_seo : null;
    const sec = site.score_security != null && site.score_security >= 0 ? site.score_security : null;
    const stability = stabilityMap[site.site_id] || 100;

    let healthScore = null;
    if (perf !== null) {
      const dims = [
        { val: perf, weight: 0.35 },
        { val: a11y, weight: 0.1 },
        { val: bp, weight: 0.1 },
        { val: seo, weight: 0.1 },
        { val: sec, weight: 0.15 },
        { val: stability, weight: 0.2 }
      ];
      const validDims = dims.filter(d => d.val != null);
      const totalWeight = validDims.reduce((a, d) => a + d.weight, 0);
      healthScore = Math.round(validDims.reduce((a, d) => a + d.val * (d.weight / totalWeight), 0));
    }

    const prev = prevMap[site.site_id];
    let prevHealthScore = null;
    if (prev && prev.score_performance != null) {
      const prevStab = stabilityMap[site.site_id] || 100;
      const prevPerf = prev.score_performance != null && prev.score_performance >= 0 ? prev.score_performance : null;
      const prevA11y = prev.score_accessibility != null && prev.score_accessibility >= 0 ? prev.score_accessibility : null;
      const prevBp = prev.score_best_practices != null && prev.score_best_practices >= 0 ? prev.score_best_practices : null;
      const prevSeo = prev.score_seo != null && prev.score_seo >= 0 ? prev.score_seo : null;
      const prevSec = prev.score_security != null && prev.score_security >= 0 ? prev.score_security : null;
      const prevDims = [
        { val: prevPerf, weight: 0.35 }, { val: prevA11y, weight: 0.1 },
        { val: prevBp, weight: 0.1 }, { val: prevSeo, weight: 0.1 },
        { val: prevSec, weight: 0.15 }, { val: prevStab, weight: 0.2 }
      ].filter(d => d.val != null);
      const prevTotal = prevDims.reduce((a, d) => a + d.weight, 0);
      prevHealthScore = prevTotal > 0 ? Math.round(prevDims.reduce((a, d) => a + d.val * (d.weight / prevTotal), 0)) : null;
    }

    return {
      site_id: site.site_id, name: site.name, platform_name: site.platform_name || '',
      department: site.group_name || '默认分组', url: site.url,
      score_performance: perf, score_accessibility: a11y, score_best_practices: bp, score_seo: seo, score_security: sec,
      stability, health_score: healthScore, last_scan: site.last_scan,
      prev_health_score: prevHealthScore,
      prev_performance: prev ? prev.score_performance : null,
      prev_accessibility: prev ? prev.score_accessibility : null,
      prev_best_practices: prev ? prev.score_best_practices : null,
      prev_seo: prev ? prev.score_seo : null,
      scanned: site.last_scan != null
    };
  });

  if (department && department !== '全部') {
    sites = sites.filter(s => s.department === department);
  }

  const sortKey = sortBy === 'performance' ? 'score_performance'
    : sortBy === 'accessibility' ? 'score_accessibility'
    : sortBy === 'best_practices' ? 'score_best_practices'
    : sortBy === 'seo' ? 'score_seo'
    : sortBy === 'security' ? 'score_security'
    : sortBy === 'stability' ? 'stability'
    : 'health_score';

  sites.sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;  // null 排末尾
    if (vb == null) return -1;
    return order === 'asc' ? va - vb : vb - va;
  });

  const totalSites = sites.length;
  const scannedSites = sites.filter(s => s.scanned).length;
  const validSites = sites.filter(s => s.health_score !== null);
  const avgHealth = validSites.length > 0
    ? Math.round(validSites.reduce((a, s) => a + s.health_score, 0) / validSites.length)
    : 0;
  const passCount = validSites.filter(s => s.health_score >= 60).length;
  const passRate = validSites.length > 0 ? Math.round((passCount / validSites.length) * 100) : 0;

  return { sites, summary: { totalSites, scannedSites, avgHealth, passRate } };
}

// ==================== 项目级排行榜 ====================
function getProjectRankingData(sortBy = 'health_score', order = 'desc', department = '全部') {
  const { sites } = getRankingData('health_score', 'desc', department);

  // 按项目分组（部门+平台）
  const projectMap = new Map();
  for (const site of sites) {
    const key = `${site.department}|||${site.platform_name || '未分类'}`;
    if (!projectMap.has(key)) projectMap.set(key, []);
    projectMap.get(key).push(site);
  }

  // 聚合每个项目的指标
  const projects = [];
  for (const [key, pageSites] of projectMap) {
    const [dept, platform] = key.split('|||');
    const valid = pageSites.filter(s => s.health_score !== null);
    const scanned = pageSites.filter(s => s.scanned);

    const avg = (arr, field) => {
      const vals = arr.filter(s => s[field] != null);
      return vals.length > 0 ? Math.round(vals.reduce((a, s) => a + s[field], 0) / vals.length) : null;
    };

    const health = avg(valid, 'health_score');
    const perf = avg(valid, 'score_performance');
    const a11y = avg(valid, 'score_accessibility');
    const bp = avg(valid, 'score_best_practices');
    const seo = avg(valid, 'score_seo');
    const sec = avg(valid, 'score_security');
    const stab = avg(pageSites, 'stability');

    // 上一次的平均健康度
    const prevValid = pageSites.filter(s => s.prev_health_score !== null);
    const prevHealth = avg(prevValid, 'prev_health_score');

    const passCount = valid.filter(s => s.health_score >= 60).length;
    const passRate = valid.length > 0 ? Math.round((passCount / valid.length) * 100) : 0;

    projects.push({
      department: dept,
      platform,
      page_count: pageSites.length,
      scanned_count: scanned.length,
      health_score: health,
      score_performance: perf,
      score_accessibility: a11y,
      score_best_practices: bp,
      score_seo: seo,
      score_security: sec,
      stability: stab,
      prev_health_score: prevHealth,
      pass_rate: passRate,
      pages: pageSites.map(s => ({
        site_id: s.site_id, name: s.name, url: s.url,
        score_performance: s.score_performance,
        score_accessibility: s.score_accessibility,
        score_best_practices: s.score_best_practices,
        score_seo: s.score_seo,
        score_security: s.score_security,
        health_score: s.health_score,
        stability: s.stability,
        last_scan: s.last_scan,
      })),
    });
  }

  // 排序
  const sortKey = sortBy === 'performance' ? 'score_performance'
    : sortBy === 'accessibility' ? 'score_accessibility'
    : sortBy === 'best_practices' ? 'score_best_practices'
    : sortBy === 'seo' ? 'score_seo'
    : sortBy === 'security' ? 'score_security'
    : sortBy === 'stability' ? 'stability'
    : 'health_score';

  projects.sort((a, b) => {
    const va = a[sortKey] != null ? a[sortKey] : -1;
    const vb = b[sortKey] != null ? b[sortKey] : -1;
    return order === 'asc' ? va - vb : vb - va;
  });

  // 总摘要
  const totalProjects = projects.length;
  const totalPages = sites.length;
  const validProjects = projects.filter(p => p.health_score !== null);
  const avgHealth = validProjects.length > 0
    ? Math.round(validProjects.reduce((a, p) => a + p.health_score, 0) / validProjects.length) : 0;
  const projectPassCount = validProjects.filter(p => p.health_score >= 60).length;
  const projectPassRate = validProjects.length > 0 ? Math.round((projectPassCount / validProjects.length) * 100) : 0;

  return { projects, summary: { totalProjects, totalPages, avgHealth, passRate: projectPassRate } };
}

// ==================== 数据清理 ====================
function cleanup() {
  console.log('[DB Cleanup] 开始数据生命周期清理...');

  const cutoff90 = daysAgoLocal(90);
  let deletedScans = 0;
  let deletedFiles = 0;

  // 1. 每个站点只保留最近 100 条扫描记录，删除更早的及其截图
  const siteIds = all('SELECT id FROM sites');
  for (const { id } of siteIds) {
    const cutoffRow = get(
      `SELECT created_at FROM scan_records WHERE site_id = ?
       ORDER BY created_at DESC LIMIT 1 OFFSET 99`,
      [id]
    );
    if (!cutoffRow) continue;

    // 取出待删除记录的截图路径
    const oldRecords = all(
      `SELECT id, screenshot_path FROM scan_records
       WHERE site_id = ? AND created_at < ?`,
      [id, cutoffRow.created_at]
    );

    for (const rec of oldRecords) {
      if (rec.screenshot_path) {
        const fullPath = path.join(__dirname, '../../reports', rec.screenshot_path);
        try { if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); deletedFiles++; } } catch (e) {}
      }
    }

    const result = run(
      `DELETE FROM scan_records WHERE site_id = ? AND created_at < ?`,
      [id, cutoffRow.created_at]
    );
    deletedScans += result.changes;
  }

  // 2. 删除已删除站点的孤儿扫描记录及截图
  const orphanScans = all(
    `SELECT sr.id, sr.screenshot_path FROM scan_records sr
     LEFT JOIN sites s ON sr.site_id = s.id WHERE s.id IS NULL`
  );
  for (const rec of orphanScans) {
    if (rec.screenshot_path) {
      const fullPath = path.join(__dirname, '../../reports', rec.screenshot_path);
      try { if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); deletedFiles++; } } catch (e) {}
    }
  }
  const orphanResult = run(
    `DELETE FROM scan_records WHERE site_id NOT IN (SELECT id FROM sites)`
  );
  deletedScans += orphanResult.changes;

  // 3. 清理 90 天前的告警、AI 报告、推送日志、Token 用量
  const alertResult = run('DELETE FROM alerts WHERE created_at < ?', [cutoff90]);
  const reportResult = run('DELETE FROM ai_reports WHERE created_at < ?', [cutoff90]);
  const pushLogResult = run('DELETE FROM report_push_log WHERE created_at < ?', [cutoff90]);
  const tokenResult = run('DELETE FROM ai_token_usage WHERE created_at < ?', [cutoff90]);

  // 4. 清理无主截图文件（不属于任何扫描记录的截图）
  try {
    if (fs.existsSync(SCREENSHOT_DIR)) {
      const files = fs.readdirSync(SCREENSHOT_DIR);
      const validPaths = new Set(
        all('SELECT screenshot_path FROM scan_records WHERE screenshot_path IS NOT NULL')
          .map(r => path.basename(r.screenshot_path))
      );
      for (const file of files) {
        if (file.startsWith('.')) continue;
        if (!validPaths.has(file)) {
          try { fs.unlinkSync(path.join(SCREENSHOT_DIR, file)); deletedFiles++; } catch (e) {}
        }
      }
    }
  } catch (e) {}

  console.log(`[DB Cleanup] 完成. 扫描记录: -${deletedScans}, 截图: -${deletedFiles}, 告警: -${alertResult.changes}, AI报告: -${reportResult.changes}, 推送日志: -${pushLogResult.changes}, Token用量: -${tokenResult.changes}`);
}

// ==================== AI Token 用量 ====================
function logTokenUsage({ provider, model, input_tokens, output_tokens, purpose }) {
  run(
    `INSERT INTO ai_token_usage (provider, model, input_tokens, output_tokens, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [provider, model, input_tokens || 0, output_tokens || 0, purpose || '', localNow()]
  );
}

function getTokenUsageSummary() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(todayStart); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(todayStart); monthAgo.setDate(monthAgo.getDate() - 30);

  const fmt = d => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;
  };

  const query = (since) => get(
    `SELECT COUNT(*) as calls, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens
     FROM ai_token_usage WHERE created_at >= ?`, [since]
  );

  return {
    today: query(fmt(todayStart)),
    week: query(fmt(weekAgo)),
    month: query(fmt(monthAgo)),
  };
}

function getTokenUsageDetail(period = 'day', limit = 30) {
  let groupExpr, labelExpr;
  if (period === 'month') {
    groupExpr = `substr(created_at, 1, 7)`;
    labelExpr = groupExpr;
  } else if (period === 'week') {
    // 按周一分组
    groupExpr = `substr(created_at, 1, 10)`;
    labelExpr = groupExpr;
  } else {
    groupExpr = `substr(created_at, 1, 10)`;
    labelExpr = groupExpr;
  }

  return all(
    `SELECT ${labelExpr} as label, provider, model,
     COUNT(*) as calls, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
     FROM ai_token_usage
     GROUP BY ${groupExpr}, provider, model
     ORDER BY label DESC
     LIMIT ?`, [limit]
  );
}

// ==================== AI 模型配置（多配置） ====================
function getAllAiConfigs() {
  return all('SELECT * FROM ai_model_configs ORDER BY enabled DESC, created_at DESC');
}

function getActiveAiConfig() {
  return get('SELECT * FROM ai_model_configs WHERE enabled=1 LIMIT 1');
}

// 兼容旧接口：返回当前启用的配置
function getAiConfig() {
  const active = getActiveAiConfig();
  if (active) {
    return {
      provider: active.provider, model: active.model,
      api_key: active.api_key, base_url: active.base_url, enabled: true,
    };
  }
  return { provider: 'anthropic', model: '', api_key: '', base_url: '', enabled: false };
}

function addAiConfig(cfg) {
  const id = uuidv4();
  run(
    `INSERT INTO ai_model_configs (id, name, provider, model, api_key, base_url, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, cfg.name || `${cfg.provider}/${cfg.model}`, cfg.provider, cfg.model || '', cfg.api_key || '', cfg.base_url || '', localNow()]
  );
  return get('SELECT * FROM ai_model_configs WHERE id=?', [id]);
}

function updateAiConfig(id, cfg) {
  const existing = get('SELECT * FROM ai_model_configs WHERE id=?', [id]);
  if (!existing) return null;
  run(
    `UPDATE ai_model_configs SET name=?, provider=?, model=?, api_key=?, base_url=? WHERE id=?`,
    [cfg.name || existing.name, cfg.provider || existing.provider, cfg.model || existing.model,
     cfg.api_key !== undefined ? cfg.api_key : existing.api_key,
     cfg.base_url !== undefined ? cfg.base_url : existing.base_url, id]
  );
  return get('SELECT * FROM ai_model_configs WHERE id=?', [id]);
}

function deleteAiConfig(id) {
  run('DELETE FROM ai_model_configs WHERE id=?', [id]);
}

function enableAiConfig(id) {
  // 先全部禁用，再启用指定的
  run('UPDATE ai_model_configs SET enabled=0');
  if (id) run('UPDATE ai_model_configs SET enabled=1 WHERE id=?', [id]);
}

function disableAllAiConfigs() {
  run('UPDATE ai_model_configs SET enabled=0');
}

// 兼容旧 saveAiConfig（测试连接时用）
function saveAiConfig(cfg) {
  // 不再写入，仅供兼容
  return getAiConfig();
}

module.exports = {
  initDb, closeDb, cleanup,
  db: { get: getDb },
  addDepartment, getAllDepartments, deleteDepartment, renameDepartment,
  addSite, updateSite, deleteSite, getSite, getAllSites, getEnabledSites, getSitesByGroup,
  createScan, updateScan, getScan, getSiteScanHistory, getLatestScan, getAllScans, getSiteTrend, getSiteStats,
  saveReport, getReportByScan, getSiteReports,
  saveAlert, getSiteAlerts, getRecentAlerts,
  getDashboardStats,
  getHealthData, getHealthRanking, getRankingData, getProjectRankingData,
  logTokenUsage, getTokenUsageSummary, getTokenUsageDetail,
  getAllAiConfigs, getActiveAiConfig, getAiConfig, addAiConfig, updateAiConfig, deleteAiConfig, enableAiConfig, disableAllAiConfigs, saveAiConfig,
  getReportConfigs, getReportConfig, getReportConfigByType, saveReportConfig, deleteReportConfig,
  addReportPushLog, getReportPushLogs
};
