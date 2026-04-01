require('dotenv').config();

module.exports = {
  server: {
    port: process.env.PORT || 3200,
    host: process.env.HOST || 'localhost'
  },
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL || 'claude-sonnet-4-6'
  },
  scan: {
    timeout: parseInt(process.env.SCAN_TIMEOUT) || 60000,
    retries: parseInt(process.env.SCAN_RETRIES) || 2,
    concurrency: Math.max(1, parseInt(process.env.SCAN_CONCURRENCY) || 1),
    // 节流模式：true=模拟真实用户环境（分数更稳定更准确），false=不节流（分数偏高但波动大）
    throttleEnabled: process.env.SCAN_THROTTLE !== 'false',
    // Lighthouse 配置
    lighthouse: {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'desktop',
        screenEmulation: { disabled: true },
        // 节流参数（throttleEnabled=true 时使用）
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1
        },
        // 模拟真实用户的节流参数
        throttlingSimulated: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4
        },
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo']
      }
    }
  },
  alert: {
    dingtalk: process.env.DINGTALK_WEBHOOK,
    feishu: process.env.FEISHU_WEBHOOK,
    email: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 465,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      to: process.env.ALERT_EMAIL_TO
    },
    // 性能阈值 - 低于此值触发告警
    thresholds: {
      performance: 60,
      accessibility: 70,
      'best-practices': 70,
      seo: 70,
      FCP: 3000,   // ms
      LCP: 4000,   // ms
      CLS: 0.25,
      TBT: 600,    // ms
      SI: 5000     // ms
    }
  },
  scheduler: {
    // 默认每6小时巡检一次
    defaultCron: '0 */6 * * *'
  }
};
