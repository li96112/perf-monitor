const https = require('https');
const http = require('http');
const db = require('../utils/db');

class ReportPusher {
  /**
   * 生成每日报告（Markdown 格式）
   */
  generateDailyReport() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dateStr = this._formatDate(now);
    const yesterdayStr = this._formatDate(yesterday);

    const healthData = db.getHealthData();
    const ranking = db.getHealthRanking();
    const recentAlerts = this._getAlertsInRange(yesterdayStr, dateStr);
    const trendChanges = this._getTrendChanges(1);

    let md = '';

    // 标题
    md += `# 前端性能日报\n\n`;
    md += `**报告时间**: ${dateStr}\n`;
    md += `**统计范围**: ${yesterdayStr} ~ ${dateStr}\n\n`;
    md += `---\n\n`;

    // 全局健康度
    md += `## 全局健康度\n\n`;
    md += this._renderHealthGauge(healthData.globalHealth);
    md += `\n`;
    md += `| 维度 | 得分 |\n`;
    md += `|------|------|\n`;
    const ds = healthData.dimensions || {};
    const dv = v => v != null ? v : '--';
    md += `| 性能 | ${dv(ds.performance)} |\n`;
    md += `| 可访问性 | ${dv(ds.accessibility)} |\n`;
    md += `| 最佳实践 | ${dv(ds.bestPractices)} |\n`;
    md += `| SEO | ${dv(ds.seo)} |\n`;
    md += `| 稳定性 | ${dv(ds.stability)} |\n\n`;

    // 部门健康度排名
    md += `## 部门健康度排名\n\n`;
    if (healthData.deptHealth && healthData.deptHealth.length > 0) {
      md += `| 排名 | 部门 | 健康度 | 站点数 |\n`;
      md += `|------|------|--------|--------|\n`;
      healthData.deptHealth.forEach((dept, i) => {
        const icon = i === 0 ? ' ' : (dept.health_score != null && dept.health_score < 60 ? ' ' : '');
        md += `| ${i + 1} | ${dept.name} ${icon} | ${dv(dept.health_score)} | ${dept.site_count} |\n`;
      });
      md += `\n`;
    } else {
      md += `暂无部门数据\n\n`;
    }

    // 红黑榜 Top5
    md += this._renderRanking(ranking);

    // 新增告警汇总
    md += `## 新增告警汇总\n\n`;
    if (recentAlerts.length > 0) {
      md += `过去 24 小时共产生 **${recentAlerts.length}** 条告警\n\n`;
      const criticalCount = recentAlerts.filter(a => a.level === 'critical').length;
      const warningCount = recentAlerts.filter(a => a.level === 'warning').length;
      md += `| 级别 | 数量 |\n`;
      md += `|------|------|\n`;
      md += `| 严重 | ${criticalCount} |\n`;
      md += `| 警告 | ${warningCount} |\n\n`;

      // 最近5条告警详情
      const topAlerts = recentAlerts.slice(0, 5);
      md += `**最新告警:**\n\n`;
      topAlerts.forEach(a => {
        const levelIcon = a.level === 'critical' ? '[严重]' : '[警告]';
        md += `- ${levelIcon} **${a.site_name || '未知站点'}**: ${a.message}\n`;
      });
      md += `\n`;
    } else {
      md += `过去 24 小时无新增告警\n\n`;
    }

    // 性能变化趋势
    md += this._renderTrendChanges(trendChanges);

    // 优化建议汇总
    md += this._renderSuggestions(healthData);

    return md;
  }

  /**
   * 生成每周报告（Markdown 格式）
   */
  generateWeeklyReport() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dateStr = this._formatDate(now);
    const weekAgoStr = this._formatDate(weekAgo);

    const healthData = db.getHealthData();
    const ranking = db.getHealthRanking();
    const recentAlerts = this._getAlertsInRange(weekAgoStr, dateStr);
    const trendChanges = this._getTrendChanges(7);

    let md = '';

    // 标题
    md += `# 前端性能周报\n\n`;
    md += `**报告时间**: ${dateStr}\n`;
    md += `**统计范围**: ${weekAgoStr} ~ ${dateStr}\n\n`;
    md += `---\n\n`;

    // 全局健康度
    md += `## 全局健康度\n\n`;
    md += this._renderHealthGauge(healthData.globalHealth);
    md += `\n`;
    const ws = healthData.dimensions || {};
    const wv = v => v != null ? v : '--';
    md += `| 维度 | 得分 |\n`;
    md += `|------|------|\n`;
    md += `| 性能 | ${wv(ws.performance)} |\n`;
    md += `| 可访问性 | ${wv(ws.accessibility)} |\n`;
    md += `| 最佳实践 | ${wv(ws.bestPractices)} |\n`;
    md += `| SEO | ${wv(ws.seo)} |\n`;
    md += `| 稳定性 | ${wv(ws.stability)} |\n\n`;

    // 部门健康度排名
    md += `## 部门健康度排名\n\n`;
    if (healthData.deptHealth && healthData.deptHealth.length > 0) {
      md += `| 排名 | 部门 | 健康度 | 站点数 | 状态 |\n`;
      md += `|------|------|--------|--------|------|\n`;
      healthData.deptHealth.forEach((dept, i) => {
        const status = dept.health_score == null ? '无数据' : dept.health_score >= 80 ? '优秀' : dept.health_score >= 60 ? '一般' : '较差';
        md += `| ${i + 1} | ${dept.name} | ${wv(dept.health_score)} | ${dept.site_count} | ${status} |\n`;
      });
      md += `\n`;
    } else {
      md += `暂无部门数据\n\n`;
    }

    // 红黑榜 Top5
    md += this._renderRanking(ranking);

    // 平台健康度明细
    md += `## 平台健康度明细\n\n`;
    if (healthData.platformHealth && healthData.platformHealth.length > 0) {
      md += `| 部门 | 平台 | 页面数 | 平均性能 | 平均健康度 | 达标率 |\n`;
      md += `|------|------|--------|----------|------------|--------|\n`;
      healthData.platformHealth.forEach(p => {
        md += `| ${p.department} | ${p.platform} | ${p.page_count} | ${p.avg_performance} | ${p.avg_health} | ${p.pass_rate}% |\n`;
      });
      md += `\n`;
    }

    // 告警汇总
    md += `## 本周告警汇总\n\n`;
    if (recentAlerts.length > 0) {
      md += `本周共产生 **${recentAlerts.length}** 条告警\n\n`;
      const criticalCount = recentAlerts.filter(a => a.level === 'critical').length;
      const warningCount = recentAlerts.filter(a => a.level === 'warning').length;
      md += `| 级别 | 数量 |\n`;
      md += `|------|------|\n`;
      md += `| 严重 | ${criticalCount} |\n`;
      md += `| 警告 | ${warningCount} |\n\n`;

      // 按站点统计告警
      const siteAlertMap = {};
      recentAlerts.forEach(a => {
        const name = a.site_name || '未知';
        if (!siteAlertMap[name]) siteAlertMap[name] = 0;
        siteAlertMap[name]++;
      });
      const sortedSiteAlerts = Object.entries(siteAlertMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (sortedSiteAlerts.length > 0) {
        md += `**告警最多的站点:**\n\n`;
        md += `| 站点 | 告警次数 |\n`;
        md += `|------|----------|\n`;
        sortedSiteAlerts.forEach(([name, count]) => {
          md += `| ${name} | ${count} |\n`;
        });
        md += `\n`;
      }
    } else {
      md += `本周无新增告警\n\n`;
    }

    // 性能变化趋势
    md += this._renderTrendChanges(trendChanges);

    // 优化建议
    md += this._renderSuggestions(healthData);

    return md;
  }

  /**
   * 推送到飞书/Lark
   */
  async pushToFeishu(webhook, content) {
    const payload = {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: content.includes('周报') ? '前端性能周报' : '前端性能日报'
          },
          template: 'blue'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: this._truncateForFeishu(content)
            }
          },
          {
            tag: 'hr'
          },
          {
            tag: 'note',
            elements: [
              {
                tag: 'plain_text',
                content: 'AI 前端性能巡检平台 - 自动推送'
              }
            ]
          }
        ]
      }
    };

    return this._postWebhook(webhook, payload);
  }

  /**
   * 推送到钉钉
   */
  async pushToDingtalk(webhook, content) {
    const title = content.includes('周报') ? '前端性能周报' : '前端性能日报';
    const payload = {
      msgtype: 'markdown',
      markdown: {
        title,
        text: this._truncateForDingtalk(content)
      }
    };

    return this._postWebhook(webhook, payload);
  }

  // ============ 内部辅助方法 ============

  _formatDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  _renderHealthGauge(score) {
    if (score == null) return `**健康度**: -- (暂无数据)\n`;
    let level, bar;
    if (score >= 80) {
      level = '优秀';
      bar = '████████░░';
    } else if (score >= 60) {
      level = '一般';
      bar = '██████░░░░';
    } else if (score >= 40) {
      level = '较差';
      bar = '████░░░░░░';
    } else {
      level = '危险';
      bar = '██░░░░░░░░';
    }
    return `**综合评分: ${score} 分** （${level}）\n\n\`${bar}\` ${score}/100\n`;
  }

  _renderRanking(ranking) {
    let md = '';

    md += `## 黑榜 Top5 - 需要关注\n\n`;
    if (ranking.worst && ranking.worst.length > 0) {
      md += `| 排名 | 项目 | 页面数 | 性能分 | 健康度 |\n`;
      md += `|------|------|--------|--------|--------|\n`;
      ranking.worst.slice(0, 5).forEach((s, i) => {
        md += `| ${i + 1} | ${s.department} / ${s.platform} | ${s.page_count}页 | ${s.performance ?? '--'} | ${s.health_score ?? '--'} |\n`;
      });
      md += `\n`;
    } else {
      md += `暂无数据\n\n`;
    }

    md += `## 红榜 Top5 - 表现优秀\n\n`;
    if (ranking.best && ranking.best.length > 0) {
      md += `| 排名 | 项目 | 页面数 | 性能分 | 健康度 |\n`;
      md += `|------|------|--------|--------|--------|\n`;
      ranking.best.slice(0, 5).forEach((s, i) => {
        md += `| ${i + 1} | ${s.department} / ${s.platform} | ${s.page_count}页 | ${s.performance ?? '--'} | ${s.health_score ?? '--'} |\n`;
      });
      md += `\n`;
    } else {
      md += `暂无数据\n\n`;
    }

    return md;
  }

  _getAlertsInRange(startDate, endDate) {
    try {
      const alerts = db.getRecentAlerts(500);
      return alerts.filter(a => {
        const t = a.created_at || '';
        return t >= startDate && t <= endDate;
      });
    } catch (e) {
      return [];
    }
  }

  _getTrendChanges(days) {
    try {
      const sites = db.getEnabledSites();
      const improved = [];
      const degraded = [];

      for (const site of sites) {
        const trend = db.getSiteTrend(site.id, days * 4 + 2);
        if (!trend || trend.length < 2) continue;

        const latest = trend[0];
        const oldest = trend[trend.length - 1];

        if (latest.score_performance == null || oldest.score_performance == null) continue;

        const diff = latest.score_performance - oldest.score_performance;
        const label = site.platform_name ? `${site.platform_name} - ${site.name}` : site.name;

        if (diff >= 5) {
          improved.push({ name: label, department: site.group_name, diff, current: latest.score_performance });
        } else if (diff <= -5) {
          degraded.push({ name: label, department: site.group_name, diff, current: latest.score_performance });
        }
      }

      improved.sort((a, b) => b.diff - a.diff);
      degraded.sort((a, b) => a.diff - b.diff);

      return { improved: improved.slice(0, 5), degraded: degraded.slice(0, 5) };
    } catch (e) {
      return { improved: [], degraded: [] };
    }
  }

  _renderTrendChanges(changes) {
    let md = `## 性能变化趋势\n\n`;

    if (changes.improved.length > 0) {
      md += `**性能提升的站点:**\n\n`;
      md += `| 站点 | 部门 | 当前分数 | 变化 |\n`;
      md += `|------|------|----------|------|\n`;
      changes.improved.forEach(s => {
        md += `| ${s.name} | ${s.department} | ${s.current} | +${s.diff} |\n`;
      });
      md += `\n`;
    }

    if (changes.degraded.length > 0) {
      md += `**性能下降的站点:**\n\n`;
      md += `| 站点 | 部门 | 当前分数 | 变化 |\n`;
      md += `|------|------|----------|------|\n`;
      changes.degraded.forEach(s => {
        md += `| ${s.name} | ${s.department} | ${s.current} | ${s.diff} |\n`;
      });
      md += `\n`;
    }

    if (changes.improved.length === 0 && changes.degraded.length === 0) {
      md += `各站点性能表现平稳，无明显变化\n\n`;
    }

    return md;
  }

  _renderSuggestions(healthData) {
    let md = `## 优化建议\n\n`;

    const suggestions = [];

    // 基于全局健康度
    const dims = healthData.dimensions || {};
    if (healthData.globalHealth != null && healthData.globalHealth < 60) {
      suggestions.push('全局健康度偏低，建议对低分站点进行集中优化');
    }

    // 基于各维度
    if (dims.performance != null && dims.performance < 60) {
      suggestions.push('整体性能评分较低，建议关注资源加载优化、代码拆分和懒加载');
    }
    if (dims.accessibility != null && dims.accessibility < 70) {
      suggestions.push('可访问性得分不足，建议检查页面语义化标签和 ARIA 属性');
    }
    if (dims.bestPractices != null && dims.bestPractices < 70) {
      suggestions.push('最佳实践得分偏低，建议检查 HTTPS、安全头和现代化 API 使用');
    }
    if (dims.seo != null && dims.seo < 70) {
      suggestions.push('SEO 得分需要改善，建议检查 meta 标签、结构化数据和页面标题');
    }
    if (dims.stability != null && dims.stability < 90) {
      suggestions.push('系统稳定性有待提升，建议排查采集失败的站点并确保服务可用性');
    }

    // 基于黑榜
    const worstSites = healthData.sites
      ? healthData.sites.filter(s => s.health_score !== null && s.health_score < 40)
      : [];
    if (worstSites.length > 0) {
      suggestions.push(`有 ${worstSites.length} 个站点健康度低于 40 分，建议优先处理`);
    }

    if (suggestions.length === 0) {
      suggestions.push('当前各项指标表现良好，建议持续关注性能趋势');
    }

    suggestions.forEach((s, i) => {
      md += `${i + 1}. ${s}\n`;
    });
    md += `\n`;

    md += `---\n`;
    md += `*此报告由 AI 前端性能巡检平台自动生成*\n`;

    return md;
  }

  _truncateForFeishu(content) {
    // 飞书卡片内容限制约 30000 字符
    if (content.length > 28000) {
      return content.substring(0, 28000) + '\n\n...(内容过长，已截断)';
    }
    return content;
  }

  _truncateForDingtalk(content) {
    // 钉钉 markdown 消息限制约 20000 字符
    if (content.length > 18000) {
      return content.substring(0, 18000) + '\n\n...(内容过长，已截断)';
    }
    return content;
  }

  async _postWebhook(url, payload) {
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
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            console.log(`[ReportPusher] Webhook 发送成功: ${res.statusCode}`);
            resolve({ success: true, statusCode: res.statusCode, body });
          });
        });

        req.on('error', (err) => {
          console.error('[ReportPusher] Webhook 发送失败:', err.message);
          resolve({ success: false, error: err.message });
        });

        req.setTimeout(15000, () => {
          req.destroy();
          resolve({ success: false, error: '请求超时' });
        });

        req.write(data);
        req.end();
      } catch (err) {
        console.error('[ReportPusher] Webhook 错误:', err.message);
        resolve({ success: false, error: err.message });
      }
    });
  }
}

module.exports = new ReportPusher();
