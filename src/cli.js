const scanner = require('./core/scanner');
const analyzer = require('./ai/analyzer');
const alertService = require('./scheduler/alert');
const db = require('./utils/db');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'scan': {
      const siteId = args[1];
      if (args.includes('--all') || !siteId) {
        console.log('开始巡检所有站点...');
        const sites = db.getEnabledSites();
        for (const site of sites) {
          const result = await scanner.scanSite(site);
          if (result.status === 'completed') {
            const analysis = await analyzer.analyzeScan(result, site);
            console.log(`\n${site.name}: 性能=${result.score_performance}, 风险=${analysis.risk_level}`);
            if (result.alert_triggered) await alertService.processAlert(result);
          }
        }
        await scanner.close();
      } else {
        const site = db.getSite(siteId);
        if (!site) { console.error('站点不存在'); process.exit(1); }
        const result = await scanner.scanSite(site);
        if (result.status === 'completed') {
          const analysis = await analyzer.analyzeScan(result, site);
          console.log(JSON.stringify(analysis, null, 2));
        }
        await scanner.close();
      }
      break;
    }

    case 'report': {
      const siteId = args[1];
      if (!siteId) {
        const stats = db.getDashboardStats();
        console.log(JSON.stringify(stats, null, 2));
      } else {
        const analysis = await analyzer.compareAnalysis(siteId);
        console.log(JSON.stringify(analysis, null, 2));
      }
      break;
    }

    case 'add': {
      const name = args[1];
      const url = args[2];
      if (!name || !url) { console.error('用法: node cli.js add <名称> <URL>'); process.exit(1); }
      const site = db.addSite({ name, url });
      console.log(`站点已添加: ${site.id}`);
      break;
    }

    case 'list': {
      const sites = db.getAllSites();
      sites.forEach(s => console.log(`${s.id} | ${s.name} | ${s.url} | ${s.enabled ? '启用' : '禁用'}`));
      break;
    }

    default:
      console.log(`
AI Performance Monitor CLI

用法:
  node cli.js scan [siteId]     巡检指定站点
  node cli.js scan --all        巡检所有站点
  node cli.js report [siteId]   查看报告
  node cli.js add <名称> <URL>  添加站点
  node cli.js list              列出所有站点
      `);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
