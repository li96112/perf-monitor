const cron = require('node-cron');
const scanner = require('../core/scanner');
const { PerformanceScanner } = require('../core/scanner');
const analyzer = require('../ai/analyzer');
const alertService = require('./alert');
const reportPusher = require('./report-pusher');
const config = require('../../config/default');
const db = require('../utils/db');

class Scheduler {
  constructor() {
    this.jobs = new Map();
    this.reportJobs = new Map();
    this.cleanupJob = null;
    this.scanLock = false;
    this.cronJobs = new Map();
    this.scanProgress = null;
    // 巡检队列
    this.scanQueue = [];
    this._currentBatchIds = new Set();
  }

  start() {
    this._rebuildCronJobs();
    console.log(`[Scheduler] 已启动 ${this.cronJobs.size} 个定时巡检任务（覆盖 ${this.jobs.size} 个站点）`);
    this.startReportJobs();
    this.cleanupJob = cron.schedule('0 3 * * *', () => {
      try { db.cleanup(); } catch (e) { console.error('[Scheduler] 清理失败:', e.message); }
    });
  }

  _rebuildCronJobs() {
    for (const [, { job }] of this.cronJobs) { job.stop(); }
    this.cronJobs.clear();
    this.jobs.clear();

    const sites = db.getEnabledSites();
    const projectGroups = new Map();
    for (const site of sites) {
      const key = `${site.group_name || '默认分组'}|||${site.platform_name || '未分类'}`;
      if (!projectGroups.has(key)) projectGroups.set(key, []);
      projectGroups.get(key).push(site);
      this.jobs.set(site.id, site);
    }

    for (const [projectKey, groupSites] of projectGroups) {
      const cronExpr = groupSites[0].scan_cron || '0 */6 * * *';
      const [dept, platform] = projectKey.split('|||');
      if (!cron.validate(cronExpr)) continue;

      const job = cron.schedule(cronExpr, async () => {
        try {
          const currentSites = db.getEnabledSites().filter(
            s => (s.group_name || '默认分组') === dept && (s.platform_name || '未分类') === platform
          );
          if (currentSites.length === 0) return;
          console.log(`[Scheduler] 触发项目巡检: ${dept}/${platform}（${currentSites.length} 个页面）`);
          await this.runBatch(currentSites);
        } catch (e) {
          console.error(`[Scheduler] 定时巡检异常: ${dept}/${platform}`, e.message);
        }
      });

      this.cronJobs.set(projectKey, { job, dept, platform, count: groupSites.length, cron: cronExpr });
      console.log(`[Scheduler] 项目定时任务: ${dept}/${platform} (${cronExpr}) → ${groupSites.length} 个页面`);
    }
  }

  addJob(site) { this.jobs.set(site.id, site); this._rebuildCronJobs(); }
  removeJob(siteId) { if (this.jobs.has(siteId)) { this.jobs.delete(siteId); this._rebuildCronJobs(); } }

  /**
   * 统一巡检入口（带锁 + 进度追踪）
   */
  /**
   * 排队巡检：如果当前有任务在跑，加入队列等待
   */
  queueBatch(sites) {
    if (!this.scanLock) {
      this._currentBatchIds = new Set(sites.map(s => s.id));
      this.runBatch(sites).catch(e => console.error('[Scheduler] 巡检异常:', e.message));
      return { queued: false, running: true };
    }
    // 去重：排除正在跑的批次 + 已在队列的
    const queueIds = new Set(this.scanQueue.map(s => s.id));
    const newSites = sites.filter(s => !this._currentBatchIds.has(s.id) && !queueIds.has(s.id));
    if (newSites.length === 0) {
      console.log('[Scheduler] 所有站点已在巡检中，跳过');
      return { queued: true, queueSize: this.scanQueue.length, skipped: true };
    }
    for (const site of newSites) { this.scanQueue.push(site); this._currentBatchIds.add(site.id); }
    console.log(`[Scheduler] 队列追加 ${newSites.length} 个站点（队列总计 ${this.scanQueue.length}）`);
    return { queued: true, queueSize: this.scanQueue.length };
  }

  /**
   * 处理单个站点的巡检 + AI 分析 + 告警
   */
  async _processSite(scannerInstance, site) {
    const result = await scannerInstance.scanSite(site);

    if (result.status !== 'failed') {
      // AI 分析
      try {
        const analysis = await analyzer.analyzeScan(result, site);
        result.ai_analysis = analysis;
        db.updateScan(result.scanId, {
          ...result,
          ai_analysis: JSON.stringify(analysis),
          ai_suggestions: JSON.stringify(analysis.suggestions || [])
        });
      } catch (err) {
        console.error(`[Scheduler] AI分析失败: ${site.name}`, err.message);
      }

      if (result.alert_triggered) {
        try { await alertService.processAlert(result); } catch (e) {}
      }
    }

    return result;
  }

  async runBatch(sites) {
    if (this.scanLock) {
      console.log(`[Scheduler] 巡检锁定中，跳过 ${sites.length} 个站点`);
      return [];
    }

    this.scanLock = true;
    this._stopRequested = false;
    const concurrency = config.scan.concurrency || 1;

    // 清理之前卡死的 running 记录（超过 10 分钟的）
    try {
      const d = new Date(); d.setMinutes(d.getMinutes() - 10);
      const pad = n => String(n).padStart(2, '0');
      const cutoff = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const cleaned = db.db.get().prepare("UPDATE scan_records SET status='failed', raw_data='{\"error\":\"巡检超时\"}' WHERE status='running' AND created_at < ?").run(cutoff);
      if (cleaned.changes > 0) console.log(`[Scheduler] 清理 ${cleaned.changes} 条卡死的巡检记录`);
    } catch (e) {}

    this.scanProgress = {
      total: sites.length,
      completed: 0,
      current: null,
      results: [],
      startTime: Date.now(),
      concurrency,
    };

    console.log(`[Scheduler] 开始巡检 ${sites.length} 个站点（并发: ${concurrency}）`);

    // 创建 scanner 实例池
    const scanners = [];
    if (concurrency <= 1) {
      scanners.push(scanner); // 用默认单例
    } else {
      for (let i = 0; i < concurrency; i++) {
        scanners.push(new PerformanceScanner());
      }
    }

    try {
      if (concurrency <= 1) {
        // ====== 串行模式（原逻辑） ======
        for (let i = 0; i < sites.length; i++) {
          if (this._stopRequested) {
            console.log(`[Scheduler] 巡检被手动停止（已完成 ${i}/${sites.length}）`);
            break;
          }
          const site = sites[i];
          this.scanProgress.current = { index: i, name: site.name, siteId: site.id, status: 'scanning' };

          try {
            const result = await this._processSite(scanner, site);

            this.scanProgress.completed = i + 1;
            this.scanProgress.current.status = result.status;
            this.scanProgress.current.score = result.score_performance;
            this.scanProgress.results.push({
              siteId: site.id, name: site.name,
              status: result.status, score: result.score_performance
            });

            console.log(`[Scheduler] 完成 ${i + 1}/${sites.length}: ${site.name} (${result.status}, 性能:${result.score_performance ?? '--'})`);
          } catch (error) {
            console.error(`[Scheduler] 巡检异常: ${site.name}`, error.message);
            this.scanProgress.completed = i + 1;
            this.scanProgress.current.status = 'failed';
            this.scanProgress.results.push({
              siteId: site.id, name: site.name, status: 'failed', error: error.message
            });
          }
        }
      } else {
        // ====== 并发模式：工作池 ======
        let nextIndex = 0;

        const worker = async (workerScanner, workerId) => {
          while (true) {
            if (this._stopRequested) break;
            const idx = nextIndex++;
            if (idx >= sites.length) break;

            const site = sites[idx];
            console.log(`[Worker-${workerId}] 开始: ${site.name} (${idx + 1}/${sites.length})`);

            try {
              const result = await this._processSite(workerScanner, site);

              this.scanProgress.completed++;
              this.scanProgress.results.push({
                siteId: site.id, name: site.name,
                status: result.status, score: result.score_performance
              });

              console.log(`[Worker-${workerId}] 完成 ${this.scanProgress.completed}/${sites.length}: ${site.name} (${result.status}, 性能:${result.score_performance ?? '--'})`);
            } catch (error) {
              console.error(`[Worker-${workerId}] 巡检异常: ${site.name}`, error.message);
              this.scanProgress.completed++;
              this.scanProgress.results.push({
                siteId: site.id, name: site.name, status: 'failed', error: error.message
              });
            }
          }
        };

        // 启动 N 个并发 worker
        await Promise.all(scanners.map((s, i) => worker(s, i + 1)));
      }
    } finally {
      // 关闭所有 scanner 实例
      for (const s of scanners) {
        try { await s.close(); } catch (e) {}
      }
      this.scanLock = false;
      if (this.scanProgress) {
        this.scanProgress.current = null;
        this.scanProgress.endTime = Date.now();
      }
      console.log(`[Scheduler] 巡检批次完成，共 ${this.scanProgress?.completed || 0} 个站点`);
      // 5 秒后清除进度并处理队列
      setTimeout(() => {
        this.scanProgress = null;
        // 如果队列里有等待的站点，继续执行
        if (this.scanQueue.length > 0) {
          const next = this.scanQueue.splice(0);
          console.log(`[Scheduler] 队列中有 ${next.length} 个站点，开始执行`);
          this.runBatch(next).catch(e => console.error('[Scheduler] 队列巡检异常:', e.message));
        }
      }, 5000);
    }
  }

  /**
   * 获取巡检进度
   */
  getScanProgress() {
    if (!this.scanProgress && this.scanQueue.length === 0) return null;
    return {
      scanning: this.scanLock,
      total: this.scanProgress?.total || 0,
      completed: this.scanProgress?.completed || 0,
      current: this.scanProgress?.current || null,
      results: this.scanProgress?.results || [],
      elapsed: this.scanProgress ? Date.now() - this.scanProgress.startTime : 0,
      queueSize: this.scanQueue.length,
    };
  }

  stopCurrentScan() {
    console.log('[Scheduler] 手动停止巡检');
    this._stopRequested = true;
    this.scanQueue = [];
    this._currentBatchIds = new Set();
    this.scanLock = false;
    this.scanProgress = null;
  }

  async runScan(site) { return this.runBatch([site]); }
  async runAll() { return this.runBatch(db.getEnabledSites()); }

  startReportJobs() {
    try {
      const configs = db.getReportConfigs();
      for (const config of configs) {
        if (!config.enabled) continue;
        this._addReportJob(config);
      }
      console.log(`[Scheduler] 已启动 ${this.reportJobs.size} 个定时报告任务`);
    } catch (e) {
      console.error('[Scheduler] 启动报告任务失败:', e.message);
    }
  }

  _addReportJob(config) {
    const cronExpr = config.cron || '0 9 * * *';
    if (!cron.validate(cronExpr)) return;

    const existing = this.reportJobs.get(config.type);
    if (existing) { existing.job.stop(); this.reportJobs.delete(config.type); }

    const job = cron.schedule(cronExpr, async () => {
      try {
        await this._executeReportPush(config);
      } catch (e) {
        console.error(`[Scheduler] 报告推送异常: ${config.type}`, e.message);
      }
    });
    this.reportJobs.set(config.type, { job, config });
  }

  async _executeReportPush(config) {
    try {
      const content = config.type === 'weekly'
        ? reportPusher.generateWeeklyReport()
        : reportPusher.generateDailyReport();
      if (!config.webhook_url) {
        db.addReportPushLog({ config_id: config.id, report_type: config.type, status: 'failed', detail: 'Webhook 地址为空' });
        return;
      }
      let result;
      if (config.webhook_type === 'dingtalk') {
        result = await reportPusher.pushToDingtalk(config.webhook_url, content);
      } else {
        result = await reportPusher.pushToFeishu(config.webhook_url, content);
      }
      db.addReportPushLog({
        config_id: config.id, report_type: config.type,
        status: result.success ? 'success' : 'failed',
        detail: result.success ? `自动推送成功 (${config.webhook_type})` : `推送失败: ${result.error || '未知错误'}`
      });
    } catch (err) {
      db.addReportPushLog({ config_id: config.id, report_type: config.type, status: 'failed', detail: `异常: ${err.message}` });
    }
  }

  refreshReportJobs() {
    for (const [, { job }] of this.reportJobs) { job.stop(); }
    this.reportJobs.clear();
    this.startReportJobs();
  }

  refresh() { this._rebuildCronJobs(); this.refreshReportJobs(); }

  stop() {
    for (const [, { job }] of this.cronJobs) { job.stop(); }
    this.cronJobs.clear(); this.jobs.clear();
    for (const [, { job }] of this.reportJobs) { job.stop(); }
    this.reportJobs.clear();
    if (this.cleanupJob) { this.cleanupJob.stop(); this.cleanupJob = null; }
    console.log('[Scheduler] 所有定时任务已停止');
  }

  getStatus() {
    const status = [];
    for (const [id, site] of this.jobs) {
      status.push({ id, name: site.name, url: site.url, cron: site.scan_cron });
    }
    return status;
  }
}

module.exports = new Scheduler();
