const puppeteer = require('puppeteer');
const { URL } = require('url');

// 需要排除的静态资源扩展名
const EXCLUDED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.webp', '.bmp',
  '.css', '.js', '.ts', '.map',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.gz', '.tar', '.7z',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.xml', '.json', '.txt', '.csv',
];

class PageCrawler {
  constructor() {
    this.browser = null;
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080'
        ]
      });
    }
    return this.browser;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * 判断链接是否有效（排除锚点、mailto、javascript、静态资源等）
   */
  isValidPageUrl(href, baseOrigin) {
    if (!href) return false;

    // 排除特殊协议
    if (href.startsWith('mailto:') || href.startsWith('javascript:') ||
        href.startsWith('tel:') || href.startsWith('data:') ||
        href.startsWith('blob:') || href.startsWith('ftp:')) {
      return false;
    }

    // 排除纯锚点
    if (href.startsWith('#')) return false;

    try {
      const url = new URL(href, baseOrigin);

      // 只保留同域名
      if (url.origin !== baseOrigin) return false;

      // 排除静态资源
      const pathname = url.pathname.toLowerCase();
      for (const ext of EXCLUDED_EXTENSIONS) {
        if (pathname.endsWith(ext)) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 规范化 URL（去掉锚点和尾部斜杠）
   */
  normalizeUrl(href, baseOrigin) {
    try {
      const url = new URL(href, baseOrigin);
      // 去掉 hash
      url.hash = '';
      // 去掉尾部斜杠（除了根路径）
      let normalized = url.href;
      if (normalized.endsWith('/') && url.pathname !== '/') {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return null;
    }
  }

  /**
   * 从页面标题中提取简短名称
   */
  extractPageName(title, path) {
    if (title && title.trim()) {
      // 取标题的第一部分（通常用 - | _ 分隔）
      const parts = title.split(/\s*[-|_]\s*/);
      return parts[0].trim().substring(0, 50);
    }
    // 如果没有标题，用路径作为名称
    if (path === '/') return '首页';
    return decodeURIComponent(path).replace(/^\//, '').replace(/\//g, ' > ').substring(0, 50) || '未命名页面';
  }

  /**
   * 爬取单个页面，提取所有同域链接
   */
  async crawlPage(pageUrl, baseOrigin) {
    let page = null;
    try {
      page = await this.browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      // 等待一小段时间让动态内容加载
      await page.waitForTimeout(1000);

      // 提取页面标题和所有链接
      const result = await page.evaluate(() => {
        const title = document.title || '';
        const links = [];
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.href;
          if (href) links.push(href);
        });
        return { title, links: [...new Set(links)] };
      });

      return result;
    } catch (err) {
      console.error(`爬取页面失败: ${pageUrl}`, err.message);
      return { title: '', links: [] };
    } finally {
      if (page) {
        try { await page.close(); } catch {}
      }
    }
  }

  /**
   * 递归爬取站点，发现所有页面
   * @param {string} entryUrl - 入口 URL
   * @param {number} maxDepth - 最大爬取深度（默认 2）
   * @param {number} maxPages - 最多发现的页面数（默认 50）
   * @returns {Array<{url, title, path}>}
   */
  async discover(entryUrl, maxDepth = 2, maxPages = 50) {
    await this.init();

    let parsedEntry;
    try {
      parsedEntry = new URL(entryUrl);
    } catch {
      throw new Error('无效的 URL 格式');
    }

    const baseOrigin = parsedEntry.origin;
    const visited = new Set();
    const discovered = [];

    // BFS 队列：[{ url, depth }]
    const queue = [{ url: this.normalizeUrl(entryUrl, baseOrigin), depth: 0 }];

    while (queue.length > 0 && discovered.length < maxPages) {
      const { url, depth } = queue.shift();

      if (!url || visited.has(url)) continue;
      visited.add(url);

      console.log(`[爬虫] 深度${depth} 正在爬取: ${url}`);

      const { title, links } = await this.crawlPage(url, baseOrigin);

      // 记录这个页面
      const parsedUrl = new URL(url);
      discovered.push({
        url: url,
        title: title || '',
        path: parsedUrl.pathname,
        name: this.extractPageName(title, parsedUrl.pathname)
      });

      // 如果还没到最大深度，把发现的链接加入队列
      if (depth < maxDepth) {
        for (const link of links) {
          if (discovered.length + queue.length >= maxPages * 2) break; // 避免队列过大

          if (this.isValidPageUrl(link, baseOrigin)) {
            const normalized = this.normalizeUrl(link, baseOrigin);
            if (normalized && !visited.has(normalized)) {
              queue.push({ url: normalized, depth: depth + 1 });
            }
          }
        }
      }
    }

    // 智能合并相同路由模式的页面
    return this.mergeRoutePatterns(discovered.slice(0, maxPages));
  }

  /**
   * 识别并合并相同路由模式的页面
   * 例如 /archives/123, /archives/456 → 合并为一组，标记路由模式
   */
  mergeRoutePatterns(pages) {
    // 将路径中的数字ID替换为占位符，识别路由模式
    function getRoutePattern(path) {
      return path
        // /archives/12345 → /archives/{id}
        .replace(/\/\d+/g, '/{id}')
        // /page-123.html → /page-{id}.html
        .replace(/-\d+\./g, '-{id}.')
        // ?id=123 类的查询参数不影响路由模式
        .replace(/[?#].*$/, '');
    }

    const patternGroups = {};

    pages.forEach(page => {
      const pattern = getRoutePattern(page.path);
      if (!patternGroups[pattern]) {
        patternGroups[pattern] = [];
      }
      patternGroups[pattern].push(page);
    });

    const result = [];

    for (const [pattern, group] of Object.entries(patternGroups)) {
      if (group.length <= 1) {
        // 唯一的页面，直接保留
        result.push(group[0]);
      } else {
        // 同路由模式多个页面，随机选一个作为代表，标记数量
        const randomIndex = Math.floor(Math.random() * group.length);
        const representative = { ...group[randomIndex] };
        representative.route_pattern = pattern;
        representative.similar_count = group.length;
        representative.name = representative.name + ` (同类${group.length}个)`;
        result.push(representative);
      }
    }

    return result;
  }
}

module.exports = new PageCrawler();
