const https = require('https');
const http = require('http');
const config = require('../../config/default');
const db = require('../utils/db');

class AlertService {
  /**
   * 处理巡检结果告警
   */
  async processAlert(scanResult) {
    if (!scanResult.alert_triggered) return;

    const site = scanResult.site;
    const alerts = this.generateAlerts(scanResult);

    for (const alert of alerts) {
      alert.site_id = site.id;
      alert.scan_id = scanResult.scanId;

      // 保存告警记录
      const alertId = db.saveAlert(alert);

      // 发送通知
      const sent = await this.sendNotification(alert, site);
      if (sent) {
        db.saveAlert({ ...alert, sent: true });
      }
    }

    return alerts;
  }

  /**
   * 生成告警信息
   */
  generateAlerts(data) {
    const alerts = [];
    const t = config.alert.thresholds;

    if (data.score_performance != null && data.score_performance >= 0 && data.score_performance < t.performance) {
      const fmtMs = v => v != null ? Math.round(v) + 'ms' : 'N/A';
      alerts.push({
        type: 'performance_score',
        level: data.score_performance < 40 ? 'critical' : 'warning',
        message: `性能评分 ${data.score_performance} 低于阈值 ${t.performance}`,
        detail: `FCP: ${fmtMs(data.fcp)}, LCP: ${fmtMs(data.lcp)}, TBT: ${fmtMs(data.tbt)}`
      });
    }

    if (data.lcp != null && data.lcp > t.LCP) {
      alerts.push({
        type: 'lcp',
        level: data.lcp > t.LCP * 2 ? 'critical' : 'warning',
        message: `LCP ${Math.round(data.lcp)}ms 超过阈值 ${t.LCP}ms`,
        detail: '最大内容绘制时间过长，用户体验受影响'
      });
    }

    if (data.fcp != null && data.fcp > t.FCP) {
      alerts.push({
        type: 'fcp',
        level: 'warning',
        message: `FCP ${Math.round(data.fcp)}ms 超过阈值 ${t.FCP}ms`,
        detail: '首次内容绘制过慢'
      });
    }

    if (data.cls != null && data.cls > t.CLS) {
      alerts.push({
        type: 'cls',
        level: data.cls > 0.5 ? 'critical' : 'warning',
        message: `CLS ${data.cls.toFixed(4)} 超过阈值 ${t.CLS}`,
        detail: '页面布局偏移严重'
      });
    }

    if (data.tbt != null && data.tbt > t.TBT) {
      alerts.push({
        type: 'tbt',
        level: 'warning',
        message: `TBT ${Math.round(data.tbt)}ms 超过阈值 ${t.TBT}ms`,
        detail: '主线程阻塞时间过长'
      });
    }

    // 稳定性告警
    if (data.stability) {
      const { successCount, totalAttempts, stabilityRate } = data.stability;
      if (totalAttempts > 1 && stabilityRate < 100) {
        const level = successCount === 0 ? 'critical' : 'warning';
        alerts.push({
          type: 'stability',
          level,
          message: `页面采集成功率 ${stabilityRate}%（${successCount}/${totalAttempts} 次成功）`,
          detail: successCount === 0
            ? '连续 ' + totalAttempts + ' 次采集全部失败，用户大概率无法正常访问该页面，需立即排查'
            : '页面存在间歇性访问失败，部分用户可能无法正常加载页面。建议排查：1.服务器稳定性 2.CDN可用性 3.页面渲染超时 4.JS报错导致白屏'
        });
      }
    }

    // 性能采集失败
    if (data.score_performance == null) {
      alerts.push({
        type: 'collect_failed',
        level: 'warning',
        message: '性能指标采集失败',
        detail: '页面性能数据无法正常采集，可能原因：SPA渲染超时、页面存在反爬机制、JS执行错误导致页面白屏'
      });
    }

    return alerts;
  }

  /**
   * 发送通知
   */
  async sendNotification(alert, site) {
    let sent = false;

    // 钉钉
    if (config.alert.dingtalk) {
      sent = await this.sendDingtalk(alert, site) || sent;
    }

    // 飞书
    if (config.alert.feishu) {
      sent = await this.sendFeishu(alert, site) || sent;
    }

    return sent;
  }

  /**
   * 钉钉机器人通知
   */
  async sendDingtalk(alert, site) {
    const emoji = alert.level === 'critical' ? '🚨' : '⚠️';
    const markdown = {
      msgtype: 'markdown',
      markdown: {
        title: `${emoji} 性能告警 - ${site.name}`,
        text: `### ${emoji} 性能告警\n\n` +
          `**站点**: ${site.name}\n\n` +
          `**地址**: ${site.url}\n\n` +
          `**级别**: ${alert.level === 'critical' ? '严重' : '警告'}\n\n` +
          `**问题**: ${alert.message}\n\n` +
          `**详情**: ${alert.detail}\n\n` +
          `**时间**: ${new Date().toLocaleString('zh-CN')}`
      }
    };

    return this.postWebhook(config.alert.dingtalk, markdown);
  }

  /**
   * 飞书机器人通知
   */
  async sendFeishu(alert, site) {
    const emoji = alert.level === 'critical' ? '🚨' : '⚠️';
    const payload = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: `${emoji} 性能告警 - ${site.name}` },
          template: alert.level === 'critical' ? 'red' : 'orange'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**站点**: ${site.name}\n**地址**: ${site.url}\n**级别**: ${alert.level === 'critical' ? '严重' : '警告'}\n**问题**: ${alert.message}\n**详情**: ${alert.detail}\n**时间**: ${new Date().toLocaleString('zh-CN')}`
            }
          }
        ]
      }
    };

    return this.postWebhook(config.alert.feishu, payload);
  }

  /**
   * 通用 Webhook 发送
   */
  async postWebhook(url, payload) {
    return new Promise((resolve) => {
      try {
        const urlObj = new URL(url);
        const data = JSON.stringify(payload);
        const client = urlObj.protocol === 'https:' ? https : http;

        const req = client.request({
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            console.log(`[Alert] Webhook 发送成功: ${res.statusCode}`);
            resolve(true);
          });
        });

        req.on('error', (err) => {
          console.error('[Alert] Webhook 发送失败:', err.message);
          resolve(false);
        });

        req.setTimeout(10000, () => { req.destroy(); resolve(false); });
        req.write(data);
        req.end();
      } catch (err) {
        console.error('[Alert] Webhook 错误:', err.message);
        resolve(false);
      }
    });
  }
}

module.exports = new AlertService();
