// ============================================
// AI Performance Monitor - Frontend App
// ============================================

const API = '/api';
let currentSiteId = null;
let currentDept = null;
let currentPlatform = null;
let allSites = [];
let trendChartInstance = null;
let detailTrendChartInstance = null;
let platTrendChartInstance = null;
let aiEnabled = false;

const ROUTE_STORAGE_KEY = 'perf-monitor:last-route';

// ============ 统一评分颜色（全局唯一标准：90/50）============
function scoreColor(v) {
  if (v == null || v < 0) return 'var(--text-muted)';
  return v >= 90 ? 'var(--accent-green)' : v >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';
}
function scoreClass(v) {
  if (v == null || v < 0) return '';
  return v >= 90 ? 'good' : v >= 50 ? 'ok' : 'bad';
}

// cron 表达式 → 人话
function cronToText(expr) {
  if (!expr) return '每6小时';
  const map = {
    '*/30 * * * *': '每30分钟',
    '0 */1 * * *': '每1小时',
    '0 */2 * * *': '每2小时',
    '0 */3 * * *': '每3小时',
    '0 */4 * * *': '每4小时',
    '0 */6 * * *': '每6小时',
    '0 */8 * * *': '每8小时',
    '0 */12 * * *': '每12小时',
    '0 0 * * *': '每天1次',
    '0 0 * * 1': '每周1次',
    '0 9 * * *': '每天上午9点',
    '0 9 * * 1': '每周一上午9点',
  };
  if (map[expr]) return map[expr];
  // 尝试解析常见模式
  const parts = expr.split(' ');
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    if (min === '0' && hour.startsWith('*/')) return `每${hour.slice(2)}小时`;
    if (min.startsWith('*/')) return `每${min.slice(2)}分钟`;
    if (dom === '*' && mon === '*' && dow === '*') return `每天 ${hour}:${min.padStart(2,'0')}`;
    if (dom === '*' && mon === '*' && dow !== '*') {
      const days = ['日','一','二','三','四','五','六'];
      return `每周${days[dow] || dow} ${hour}:${min.padStart(2,'0')}`;
    }
  }
  return expr;
}


// ============ 心跳：保持服务运行，关闭网页后服务自动退出 ============
setInterval(() => {
  fetch(`${API}/heartbeat`, { method: 'POST' }).catch(() => {});
}, 60000); // 每60秒发一次心跳
// 页面加载时立即发一次
fetch(`${API}/heartbeat`, { method: 'POST' }).catch(() => {});

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initParticles();
  initClock();
  initNav();
  loadAiStatus();
  startScanProgressMonitor();

  document.getElementById('siteFormLogin').addEventListener('change', (e) => {
    document.getElementById('loginFields').style.display = e.target.checked ? 'block' : 'none';
  });

  await restoreLastRoute();
});

// ============ 主题切换 ============
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('theme', next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) {
    // 白天模式显示月亮图标，夜间模式显示太阳图标
    btn.innerHTML = theme === 'dark' ? '&#9788;' : '&#9790;';
    btn.title = theme === 'dark' ? '切换到白天模式' : '切换到夜间模式';
  }
}

// ============ 粒子背景 ============
function initParticles() {
  const canvas = document.getElementById('particles-bg');
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 2 + 0.5;
      this.speedX = (Math.random() - 0.5) * 0.5;
      this.speedY = (Math.random() - 0.5) * 0.5;
      this.opacity = Math.random() * 0.5 + 0.1;
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
        this.reset();
      }
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const color = isLight ? '37, 99, 235' : '34, 211, 238';
      ctx.fillStyle = `rgba(${color}, ${this.opacity})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < 80; i++) particles.push(new Particle());

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(); p.draw(); });

    // 连线
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          const isLt = document.documentElement.getAttribute('data-theme') === 'light';
          const lineColor = isLt ? '37, 99, 235' : '34, 211, 238';
          ctx.strokeStyle = `rgba(${lineColor}, ${0.05 * (1 - dist / 150)})`;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  }
  animate();
}

// ============ 时钟 ============
function initClock() {
  function update() {
    const now = new Date();
    document.getElementById('headerTime').textContent =
      now.toLocaleDateString('zh-CN') + ' ' + now.toLocaleTimeString('zh-CN');
  }
  update();
  setInterval(update, 1000);
}

// ============ 导航 ============
function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page));
  });
}

function saveRoute(route) {
  try {
    sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(route));
  } catch (e) {}
}

function getSavedRoute() {
  try {
    const raw = sessionStorage.getItem(ROUTE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function restoreLastRoute() {
  const route = getSavedRoute();
  if (!route || !route.type) {
    showPage('dashboard', { skipSave: true });
    return;
  }

  if (route.type === 'detail' || route.type === 'platform' || route.type === 'department') {
    await loadDashboard();
  }

  if (route.type === 'detail' && route.siteId) {
    currentDept = route.deptName || null;
    currentPlatform = route.platformName || null;
    await showSiteDetail(route.siteId, { skipSave: true });
    return;
  }

  if (route.type === 'platform' && route.deptName && route.platformName) {
    showPlatform(route.deptName, route.platformName, { skipSave: true });
    return;
  }

  if (route.type === 'department' && route.deptName) {
    showDepartment(route.deptName, { skipSave: true });
    return;
  }

  showPage(route.page || 'dashboard', { skipSave: true });
}

function showPage(page, options = {}) {
  const { skipSave = false } = options;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  if (!skipSave) {
    saveRoute({ type: 'page', page });
  }

  // 加载页面数据
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'health': loadHealthPage(); break;
    case 'ranking': loadRankingPage(); break;
    case 'sites': loadSitesManagement(); break;
    case 'reports': loadReports(); break;
    case 'alerts': loadAlerts(); break;
    case 'settings': loadSettings(); break;
  }
}

// ============ API 请求 ============
async function api(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    toast('请求失败: ' + err.message, 'error');
    return { success: false, error: err.message };
  }
}

// ============ Toast 通知 ============
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ============ Modal ============
function showModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

async function showAddSiteModal() {
  // 填充部门下拉（从部门表 + 站点中合并）
  const deptRes = await api('/departments');
  const dbDepts = deptRes.success ? deptRes.data.map(d => d.name) : [];
  const siteDepts = [...new Set(allSites.map(s => s.group_name))].filter(Boolean);
  const groups = [...new Set([...dbDepts, ...siteDepts])];
  const groupSelect = document.getElementById('siteFormGroup');
  groupSelect.innerHTML = '<option value="">-- 请选择部门 --</option>' +
    groups.map(g => `<option value="${g}">${g}</option>`).join('');

  // 平台下拉初始为空，等选部门后联动
  const platformSelect = document.getElementById('siteFormPlatform');
  platformSelect.innerHTML = '<option value="">-- 请先选择部门 --</option>';

  // 隐藏新增输入框
  document.getElementById('siteFormGroupNew').style.display = 'none';
  document.getElementById('siteFormPlatformNew').style.display = 'none';

  showModal('addSiteModal');
}

function showNewGroupInput() {
  const input = document.getElementById('siteFormGroupNew');
  const select = document.getElementById('siteFormGroup');
  if (input.style.display === 'none') {
    input.style.display = 'block';
    select.value = '';
    input.focus();
  } else {
    input.style.display = 'none';
    input.value = '';
  }
}

function showNewPlatformInput() {
  const input = document.getElementById('siteFormPlatformNew');
  const select = document.getElementById('siteFormPlatform');
  if (input.style.display === 'none') {
    input.style.display = 'block';
    select.value = '';
    input.focus();
  } else {
    input.style.display = 'none';
    input.value = '';
  }
}

function onGroupChange() {
  const select = document.getElementById('siteFormGroup');
  if (select.value) {
    document.getElementById('siteFormGroupNew').style.display = 'none';
    document.getElementById('siteFormGroupNew').value = '';
  }
  // 联动：根据选中部门过滤平台
  const selectedGroup = select.value || document.getElementById('siteFormGroupNew').value.trim();
  const platformSelect = document.getElementById('siteFormPlatform');
  if (selectedGroup) {
    const platforms = [...new Set(allSites.filter(s => s.group_name === selectedGroup).map(s => s.platform_name))].filter(Boolean);
    platformSelect.innerHTML = '<option value="">-- 请选择平台 --</option>' +
      platforms.map(p => `<option value="${p}">${p}</option>`).join('');
  } else {
    platformSelect.innerHTML = '<option value="">-- 请先选择部门 --</option>';
  }
  document.getElementById('siteFormPlatformNew').style.display = 'none';
  document.getElementById('siteFormPlatformNew').value = '';
}

function onPlatformChange() {
  const select = document.getElementById('siteFormPlatform');
  if (select.value) {
    document.getElementById('siteFormPlatformNew').style.display = 'none';
    document.getElementById('siteFormPlatformNew').value = '';
  }
}

function showAddGroupModal() {
  showModal('addGroupModal');
}

// ============ Dashboard ============
async function loadDashboard() {
  const [dashRes, deptRes] = await Promise.all([
    api('/dashboard'),
    api('/departments')
  ]);
  if (!dashRes.success) return;

  const { totalSites, totalScans, totalAlerts, avgScores, siteScores } = dashRes.data;
  allSites = siteScores || [];
  const departments = deptRes.success ? deptRes.data : [];

  // 统计数字
  animateNumber('statSites', totalSites);
  animateNumber('statScans', totalScans);
  animateNumber('statAlerts', totalAlerts);
  animateNumber('statAvgPerf', avgScores?.performance != null ? Math.round(avgScores.performance) : 0);

  // 部门概览（合并空部门 + 有站点的部门）
  renderDepartmentList(siteScores, departments);
}

function renderDepartmentList(sites, departments = []) {
  const container = document.getElementById('departmentList');

  // 按部门分组
  const groups = {};

  // 先把数据库里的部门加进来（即使没有站点也显示）
  departments.forEach(d => {
    if (!groups[d.name]) groups[d.name] = [];
  });

  // 再把站点归入对应部门
  (sites || []).forEach(s => {
    const g = s.group_name || '默认分组';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  if (Object.keys(groups).length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">+</div>
        <div class="empty-text">暂无部门</div>
        <div class="empty-hint">点击"+ 添加站点"或导航栏"站点管理 → + 添加部门"开始</div>
      </div>`;
    return;
  }

  let html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(20rem, 1fr)); gap:1.25rem;">';
  const colors = ['var(--accent-cyan)', 'var(--accent-purple)', 'var(--accent-blue)', 'var(--accent-pink)', 'var(--accent-green)'];

  let i = 0;
  for (const [group, groupSites] of Object.entries(groups)) {
    const color = colors[i % colors.length];
    const platforms = [...new Set(groupSites.map(s => s.platform_name).filter(Boolean))];
    const avgPerf = groupSites.filter(s => s.score_performance != null);
    const avg = avgPerf.length ? Math.round(avgPerf.reduce((a, s) => a + s.score_performance, 0) / avgPerf.length) : '--';
    const scoreClass = typeof avg === 'number' ? (avg >= 90 ? 'good' : avg >= 50 ? 'ok' : 'bad') : '';
    const alertCount = groupSites.filter(s => s.score_performance != null && s.score_performance < 60).length;

    html += `
      <div class="stat-card animate-in" style="cursor:pointer; border-left:3px solid ${color};" onclick="showDepartment('${group}')">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem;">
          <div>
            <div style="font-size:1.125rem; font-weight:700; margin-bottom:0.25rem;">${group}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${platforms.length} 个平台 · ${groupSites.length} 个页面</div>
          </div>
          <div class="score-badge ${scoreClass}" style="width:3rem; height:3rem; font-size:1rem;">${avg}</div>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          ${platforms.slice(0, 4).map(p => `<span style="font-size:0.6875rem; padding:0.125rem 0.5rem; background:${color}15; color:${color}; border:1px solid ${color}30; border-radius:1rem;">${p}</span>`).join('')}
          ${platforms.length > 4 ? `<span style="font-size:0.6875rem; color:var(--text-muted);">+${platforms.length - 4}</span>` : ''}
        </div>
        ${alertCount > 0 ? `<div style="margin-top:0.75rem; padding:0.625rem 0.75rem; background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.15); border-radius:0.5rem; cursor:pointer; display:flex; align-items:center; justify-content:space-between;" onclick="event.stopPropagation(); showAlertSitesModal('${group.replace(/'/g, "\\'")}')">
          <span style="font-size:0.8125rem; color:var(--accent-red); font-weight:600;">${alertCount} 个页面需要关注</span>
          <span style="font-size:0.75rem; color:var(--accent-red); opacity:0.7;">点击查看 &#10148;</span>
        </div>` : ''}
        <div style="margin-top:0.75rem;">
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); scanByDepartment('${group}')">巡检整个部门</button>
        </div>
      </div>`;
    i++;
  }
  html += '</div>';
  container.innerHTML = html;
}

// ============ 部门详情 ============
function showDepartment(deptName, options = {}) {
  const { skipSave = false, keepScroll = false } = options;
  currentDept = deptName;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-department').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (!keepScroll) window.scrollTo(0, 0);

  if (!skipSave) {
    saveRoute({ type: 'department', deptName });
  }

  document.getElementById('deptName').textContent = deptName;

  // 筛选该部门的站点
  const deptSites = allSites.filter(s => (s.group_name || '默认分组') === deptName);
  const platforms = [...new Set(deptSites.map(s => s.platform_name).filter(Boolean))];

  document.getElementById('deptInfo').textContent = `${platforms.length} 个平台 · ${deptSites.length} 个页面`;

  // 统计卡片
  const perfSites = deptSites.filter(s => s.score_performance != null && s.score_performance >= 0);
  const avg = perfSites.length ? Math.round(perfSites.reduce((a, s) => a + s.score_performance, 0) / perfSites.length) : '--';
  const a11ySites = deptSites.filter(s => s.score_accessibility != null && s.score_accessibility >= 0);
  const avgA11y = a11ySites.length ? Math.round(a11ySites.reduce((a, s) => a + s.score_accessibility, 0) / a11ySites.length) : '--';
  const alertCount = perfSites.filter(s => s.score_performance < 60).length;

  document.getElementById('deptStats').innerHTML = `
    <div class="stat-card cyan animate-in">
      <div class="stat-icon">P</div>
      <div class="stat-value" style="color:var(--accent-cyan);">${platforms.length}</div>
      <div class="stat-label">平台数量</div>
    </div>
    <div class="stat-card blue animate-in">
      <div class="stat-icon">N</div>
      <div class="stat-value" style="color:var(--accent-blue);">${deptSites.length}</div>
      <div class="stat-label">页面数量</div>
    </div>
    <div class="stat-card green animate-in">
      <div class="stat-icon">S</div>
      <div class="stat-value" style="color:var(--accent-green);">${avg}</div>
      <div class="stat-label">平均性能分</div>
    </div>
    <div class="stat-card purple animate-in">
      <div class="stat-icon">!</div>
      <div class="stat-value" style="color:${alertCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}; cursor:${alertCount > 0 ? 'pointer' : 'default'};" ${alertCount > 0 ? `onclick="showAlertSitesModal('${currentDept.replace(/'/g, "\\'")}')"` : ''}>${alertCount}</div>
      <div class="stat-label">需关注页面</div>
    </div>`;

  // 平台列表
  renderPlatformCards(deptName, deptSites, platforms);
}

function renderPlatformCards(deptName, deptSites, platforms) {
  const container = document.getElementById('deptPlatformList');
  const colors = ['var(--accent-cyan)', 'var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-pink)', 'var(--accent-green)'];

  if (platforms.length === 0) {
    // 没有平台名的站点直接列出来
    container.innerHTML = `
      <ul class="site-list" style="border:1px solid var(--border-color); border-radius:var(--radius);">
        ${deptSites.map(site => renderSiteItem(site)).join('')}
      </ul>`;
    return;
  }

  let html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(20rem, 1fr)); gap:1.25rem;">';
  platforms.forEach((plat, i) => {
    const color = colors[i % colors.length];
    const platSites = deptSites.filter(s => s.platform_name === plat);
    const avgPerf = platSites.filter(s => s.score_performance != null);
    const avg = avgPerf.length ? Math.round(avgPerf.reduce((a, s) => a + s.score_performance, 0) / avgPerf.length) : '--';
    const scoreClass = typeof avg === 'number' ? (avg >= 90 ? 'good' : avg >= 50 ? 'ok' : 'bad') : '';

    html += `
      <div class="stat-card animate-in" style="cursor:pointer; border-left:3px solid ${color};" onclick="showPlatform('${deptName}', '${plat}')">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <div style="font-size:1rem; font-weight:700;">${plat}</div>
          <div style="text-align:center;">
            <div class="score-badge ${scoreClass}" style="width:2.75rem; height:2.75rem;">${avg}</div>
            <div style="font-size:0.625rem; color:var(--text-muted); margin-top:0.2rem;">性能均分</div>
          </div>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.5rem;">${platSites.length} 个页面</div>
        <div style="display:flex; gap:0.375rem; flex-wrap:wrap;">
          ${platSites.slice(0, 5).map(s => {
            const sc = s.score_performance;
            const cls = sc == null ? '' : sc >= 90 ? 'good' : sc >= 50 ? 'ok' : 'bad';
            return `<span class="score-badge ${cls}" style="width:2rem; height:2rem; font-size:0.625rem;">${sc ?? '--'}</span>`;
          }).join('')}
          ${platSites.length > 5 ? `<span style="font-size:0.6875rem; color:var(--text-muted); align-self:center;">+${platSites.length - 5}</span>` : ''}
        </div>
        <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); scanByPlatform('${deptName}', '${plat}')">巡检项目</button>
        </div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ============ 平台详情 ============
function showPlatform(deptName, platName, options = {}) {
  const { skipSave = false, keepScroll = false } = options;
  currentDept = deptName;
  currentPlatform = platName;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-platform').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (!keepScroll) window.scrollTo(0, 0);

  if (!skipSave) {
    saveRoute({ type: 'platform', deptName, platformName: platName });
  }

  document.getElementById('platName').textContent = platName;
  document.getElementById('platInfo').textContent = `${deptName} · ${platName}`;

  // 返回按钮
  document.getElementById('platformBackBtn').onclick = () => showDepartment(deptName);

  const platSites = allSites.filter(s => (s.group_name || '默认分组') === deptName && s.platform_name === platName);

  // 统计 - 每个维度独立过滤 null
  const safeAvg = (arr, key) => {
    const valid = arr.filter(s => s[key] != null && s[key] >= 0);
    return valid.length > 0 ? Math.round(valid.reduce((a, s) => a + s[key], 0) / valid.length) : null;
  };
  const avgP = safeAvg(platSites, 'score_performance');
  const avgA = safeAvg(platSites, 'score_accessibility');
  const avgB = safeAvg(platSites, 'score_best_practices');
  const avgS = safeAvg(platSites, 'score_seo');
  const avgSec = safeAvg(platSites, 'score_security');

  document.getElementById('platStats').innerHTML = `
    <div class="stat-card cyan animate-in">
      <div class="stat-icon">N</div>
      <div class="stat-value" style="color:var(--accent-cyan);">${platSites.length}</div>
      <div class="stat-label">页面数量</div>
    </div>
    <div class="stat-card green animate-in">
      <div class="stat-icon">P</div>
      <div class="stat-value" style="color:var(--accent-green);">${avgP ?? '--'}</div>
      <div class="stat-label">平均性能分</div>
    </div>
    <div class="stat-card blue animate-in">
      <div class="stat-icon">A</div>
      <div class="stat-value" style="color:var(--accent-blue);">${avgA ?? '--'}</div>
      <div class="stat-label">平均无障碍分</div>
    </div>
    <div class="stat-card purple animate-in">
      <div class="stat-icon">S</div>
      <div class="stat-value" style="color:var(--accent-purple);">${avgS ?? '--'}</div>
      <div class="stat-label">平均SEO分</div>
    </div>
    <div class="stat-card pink animate-in">
      <div class="stat-icon">&#128274;</div>
      <div class="stat-value" style="color:var(--accent-pink);">${avgSec ?? '--'}</div>
      <div class="stat-label">平均安全分</div>
    </div>`;

  // 评分环
  renderGauges('platGauges', {
    '性能': avgP,
    '无障碍': avgA,
    '最佳实践': avgB,
    'SEO': avgS,
    '安全': avgSec
  });

  // 页面列表（带操作按钮）
  const listContainer = document.getElementById('platPageList');
  listContainer.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
      <label style="display:flex; align-items:center; gap:0.375rem; font-size:0.8125rem; color:var(--text-secondary);">
        <input type="checkbox" id="platSelectAll" onchange="togglePlatformSelectAll(this.checked)">
        全选
      </label>
      <button class="btn btn-sm btn-danger" onclick="deleteSelectedPlatformSites()">批量删除</button>
    </div>
    <ul class="site-list" style="border:1px solid var(--border-color); border-radius:var(--radius);">
      ${platSites.map(site => {
        const colors = ['var(--accent-cyan)', 'var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-pink)', 'var(--accent-green)'];
        const color = colors[Math.abs(hashCode(site.id)) % colors.length];
        const initial = (site.name || 'S')[0].toUpperCase();
        const platformLabel = site.platform_name ? `<span style="font-size:0.6875rem; color:var(--accent-cyan); background:rgba(34,211,238,0.1); padding:0.0625rem 0.375rem; border-radius:0.25rem; margin-left:0.5rem;">${site.platform_name}</span>` : '';
        return `
          <li class="site-item" style="cursor:default;">
            <label style="display:flex; align-items:center; margin-right:0.625rem;" onclick="event.stopPropagation();">
              <input type="checkbox" class="platform-site-check" data-id="${site.id}" data-name="${escapeHtml(site.name || '')}" onclick="event.stopPropagation();">
            </label>
            <div class="site-info" style="cursor:pointer;" onclick="showSiteDetail('${site.id}')">
              <div class="site-avatar" style="background:${color}20; color:${color};">${initial}</div>
              <div style="min-width:0;">
                <div class="site-name">${site.name}${platformLabel}</div>
                <div class="site-url">${site.url}</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <div class="site-scores">
                ${renderScoreBadge(site.score_performance, '性能')}
                ${renderScoreBadge(site.score_accessibility, '无障碍')}
                ${renderScoreBadge(site.score_best_practices, '最佳实践')}
                ${renderScoreBadge(site.score_seo, 'SEO')}
                ${renderScoreBadge(site.score_security, '安全')}
              </div>
              <button class="btn btn-sm btn-primary" onclick="scanSite('${site.id}')">巡检</button>
              <button class="btn btn-sm" onclick="showEditSiteModal('${site.id}')">编辑</button>
              <button class="btn btn-sm btn-danger" onclick="deleteSiteFromPlatform('${site.id}', '${site.name}')">删除</button>
            </div>
          </li>`;
      }).join('')}
    </ul>`;

  // 趋势图（取第一个有数据的站点）
  if (platSites.length > 0) {
    loadPlatformTrend(platSites);
  }
}

async function loadPlatformTrend(platSites) {
  // 收集所有站点的趋势数据
  for (const site of platSites) {
    const res = await api(`/sites/${site.id}/trend?limit=15`);
    if (res.success && res.data.length > 0) {
      renderTrendChart('platTrendChart', res.data.reverse(), false);
      return;
    }
  }
}

async function scanByDepartment(groupName) {
  const res = await api('/scan-department', { method: 'POST', body: { group_name: groupName } });
  if (res.success) {
    toast(res.message || `已启动 ${res.count || ''} 个页面的巡检`, 'info');
    setTimeout(checkScanProgress, 300);
  } else {
    toast(res.error || '巡检启动失败', 'error');
  }
}

async function scanByPlatform(groupName, platformName) {
  const res = await api('/scan-platform', { method: 'POST', body: { group_name: groupName, platform_name: platformName } });
  if (res.success) {
    toast(res.message || `已启动 ${res.count || ''} 个页面的巡检`, 'info');
    setTimeout(checkScanProgress, 300);
  } else {
    toast(res.error || '巡检启动失败', 'error');
  }
}

async function scanPlatformSites() {
  const res = await api('/scan-platform', {
    method: 'POST',
    body: { group_name: currentDept, platform_name: currentPlatform }
  });
  if (!res.success) {
    toast(res.error || '巡检启动失败', 'error');
    return;
  }
  toast(res.message || `已启动 ${res.count || ''} 个页面的巡检`, 'info');
  setTimeout(checkScanProgress, 300);
}

function renderSiteItem(site) {
  const colors = ['var(--accent-cyan)', 'var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-pink)', 'var(--accent-green)'];
  const color = colors[Math.abs(hashCode(site.id)) % colors.length];
  const initial = (site.name || 'S')[0].toUpperCase();

  const platformLabel = site.platform_name ? `<span style="font-size:0.6875rem; color:var(--accent-cyan); background:rgba(34,211,238,0.1); padding:0.0625rem 0.375rem; border-radius:0.25rem; margin-left:0.5rem;">${site.platform_name}</span>` : '';

  return `
    <li class="site-item" onclick="showSiteDetail('${site.id}')">
      <div class="site-info">
        <div class="site-avatar" style="background:${color}20; color:${color};">${initial}</div>
        <div style="min-width:0;">
          <div class="site-name">${site.name}${platformLabel}</div>
          <div class="site-url">${site.url}</div>
        </div>
      </div>
      <div class="site-scores">
        ${renderScoreBadge(site.score_performance, 'P')}
        ${renderScoreBadge(site.score_accessibility, 'A')}
        ${renderScoreBadge(site.score_best_practices, 'B')}
        ${renderScoreBadge(site.score_seo, 'S')}
        ${renderScoreBadge(site.score_security, 'Sec')}
      </div>
    </li>`;
}

function renderScoreBadge(score, label) {
  if (score === null || score === undefined || score === -1) {
    return `<div class="score-badge" style="color:var(--text-muted); border-color:var(--accent-yellow); background:rgba(245,158,11,0.08); font-size:0.5rem;" title="${label}: 采集失败">N/A</div>`;
  }
  const cls = score >= 90 ? 'good' : score >= 50 ? 'ok' : 'bad';
  return `<div class="score-badge ${cls}" title="${label}">${score}</div>`;
}

function syncSiteScoreToLocalCache(siteId, scan) {
  if (!siteId || !scan || !Array.isArray(allSites)) return;

  const idx = allSites.findIndex(s => s.id === siteId);
  if (idx < 0) return;

  allSites[idx] = {
    ...allSites[idx],
    score_performance: scan.score_performance,
    score_accessibility: scan.score_accessibility,
    score_best_practices: scan.score_best_practices,
    score_seo: scan.score_seo,
    score_security: scan.score_security,
  };
}

// ============ 评分环 ============
function renderGauges(containerId, scores) {
  const container = document.getElementById(containerId);
  const circumference = 2 * Math.PI * 42;
  // 标准分
  const standards = { '性能': 90, 'Performance': 90, '无障碍': 90, 'Accessibility': 90, '最佳实践': 90, 'Best Practices': 90, 'SEO': 90, '安全': 80, 'Security': 80 };

  let html = '';
  for (const [label, rawScore] of Object.entries(scores)) {
    const hasData = rawScore != null && rawScore >= 0;
    const score = hasData ? rawScore : 0;
    const offset = hasData ? circumference - (score / 100) * circumference : circumference;
    const cls = !hasData ? '' : score >= 90 ? 'good' : score >= 50 ? 'ok' : 'bad';
    const color = !hasData ? 'var(--text-muted)' : score >= 90 ? 'var(--accent-green)' : score >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';
    const standard = standards[label] || 90;
    const diff = hasData ? score - standard : null;
    const diffText = diff != null ? (diff >= 0 ? `+${diff}` : `${diff}`) : '--';
    const diffColor = diff != null ? (diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)';

    // 标准线位置
    const standardAngle = (standard / 100) * 360 - 90;
    const stdRad = standardAngle * Math.PI / 180;
    const stdX = 50 + 42 * Math.cos(stdRad);
    const stdY = 50 + 42 * Math.sin(stdRad);
    const stdX2 = 50 + 36 * Math.cos(stdRad);
    const stdY2 = 50 + 36 * Math.sin(stdRad);

    html += `
      <div class="gauge-item">
        <div class="gauge-ring">
          <svg viewBox="0 0 100 100">
            <circle class="bg" cx="50" cy="50" r="42"/>
            <circle class="progress ${cls}" cx="50" cy="50" r="42"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"/>
            ${hasData ? `<line x1="${stdX}" y1="${stdY}" x2="${stdX2}" y2="${stdY2}" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round"/>` : ''}
          </svg>
          <div class="gauge-value" style="color:${color};">${hasData ? score : '--'}</div>
        </div>
        <div class="gauge-label">${label}</div>
        <div style="font-size:0.6875rem; color:${diffColor}; margin-top:0.125rem;">
          ${hasData ? `标准 ${standard} · <span style="font-weight:600;">${diffText}</span>` : '暂无数据'}
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

// ============ 健康度页面 ============
let healthChartInstances = {};
let _healthPlatformData = [];
let _healthSortField = 'avg_health';
let _healthSortAsc = false;

async function loadHealthPage() {
  const [healthRes, rankingRes] = await Promise.all([
    api('/health'),
    api('/health/ranking')
  ]);

  if (!healthRes.success) return;

  const data = healthRes.data;
  const ranking = rankingRes.success ? rankingRes.data : { worst: [], best: [] };

  // 1. 全局健康度环形图（ECharts）
  renderHealthGaugeChart(data.globalHealth);

  // 2. 维度卡片
  renderHealthDimensionCards(data.dimensions);

  // 3. 部门健康度排名柱状图
  renderDeptHealthChart(data.deptHealth);

  // 4. 红黑榜
  renderHealthRanking(ranking);

  // 5. 平台明细表格
  _healthPlatformData = data.platformHealth || [];
  renderHealthPlatformTable(_healthPlatformData);
}

function renderHealthGaugeChart(score) {
  const container = document.getElementById('healthGaugeChart');
  if (!container) return;

  if (healthChartInstances['gauge']) {
    healthChartInstances['gauge'].dispose();
  }

  const safeScore = score != null ? score : 0;
  const chart = echarts.init(container, null, { renderer: 'canvas' });
  healthChartInstances['gauge'] = chart;

  const color = safeScore >= 80 ? '#10b981' : safeScore >= 60 ? '#f59e0b' : '#ef4444';

  const option = {
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge',
      startAngle: 225,
      endAngle: -45,
      min: 0,
      max: 100,
      radius: '100%',
      progress: {
        show: true,
        width: 18,
        roundCap: true,
        itemStyle: { color }
      },
      pointer: { show: false },
      axisLine: {
        lineStyle: {
          width: 18,
          color: [[1, 'rgba(100,116,139,0.15)']]
        },
        roundCap: true
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: {
        show: true,
        offsetCenter: [0, '65%'],
        fontSize: 14,
        color: '#94a3b8',
        fontWeight: 500
      },
      detail: {
        valueAnimation: true,
        fontSize: 48,
        fontWeight: 800,
        offsetCenter: [0, '10%'],
        formatter: '{value}',
        color
      },
      data: [{ value: safeScore, name: '健康度评分' }]
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', () => chart.resize());
}

function renderHealthDimensionCards(dims) {
  const container = document.getElementById('healthDimensionCards');
  if (!container) return;

  const cards = [
    { label: '性能', key: 'performance', weight: '35%', icon: 'P', color: 'cyan' },
    { label: '可用性', key: 'accessibility', weight: '10%', icon: 'A', color: 'blue' },
    { label: '规范性', key: 'bestPractices', weight: '10%', icon: 'B', color: 'purple' },
    { label: 'SEO', key: 'seo', weight: '10%', icon: 'S', color: 'green' },
    { label: '安全', key: 'security', weight: '15%', icon: '&#128274;', color: 'red' },
    { label: '稳定性', key: 'stability', weight: '20%', icon: '&#9889;', color: 'pink' }
  ];

  // 补一个空卡片让布局好看（5个卡片 2列布局，最后补一个总览）
  container.innerHTML = cards.map(c => {
    const val = dims[c.key] ?? null;
    const hasVal = val != null;
    const dimColor = !hasVal ? 'var(--text-muted)' : (val >= 90 ? 'var(--accent-green)' : val >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)');
    return `
      <div class="stat-card ${c.color} animate-in">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.25rem;">${c.label} · 权重 ${c.weight}</div>
            <div style="font-size:2rem; font-weight:800; color:${dimColor}; font-family:'JetBrains Mono',monospace;">${hasVal ? val : '--'}</div>
          </div>
          <div class="stat-icon">${c.icon}</div>
        </div>
        <div style="margin-top:0.75rem; height:4px; background:rgba(100,116,139,0.15); border-radius:2px; overflow:hidden;">
          <div style="height:100%; width:${hasVal ? val : 0}%; background:${dimColor}; border-radius:2px; transition:width 0.8s ease;"></div>
        </div>
      </div>`;
  }).join('');
}

function renderDeptHealthChart(deptHealth) {
  const container = document.getElementById('healthDeptChart');
  if (!container) return;

  if (healthChartInstances['dept']) {
    healthChartInstances['dept'].dispose();
  }

  const chart = echarts.init(container, null, { renderer: 'canvas' });
  healthChartInstances['dept'] = chart;

  const validDepts = deptHealth.filter(d => d.health_score != null);
  const names = validDepts.map(d => d.name);
  const scores = validDepts.map(d => d.health_score);
  const colors = scores.map(s => s >= 80 ? '#10b981' : s >= 60 ? '#f59e0b' : '#ef4444');

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(56, 189, 248, 0.2)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: function(params) {
        const p = params[0];
        const dept = validDepts[p.dataIndex];
        return `<b>${p.name}</b><br/>健康度：${p.value} 分<br/>站点数：${dept.site_count}<br/>有效数据：${dept.valid_count}`;
      }
    },
    grid: { left: 100, right: 40, top: 20, bottom: 30 },
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { lineStyle: { color: 'rgba(56,189,248,0.15)' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(56,189,248,0.06)' } }
    },
    yAxis: {
      type: 'category',
      data: names,
      inverse: true,
      axisLine: { lineStyle: { color: 'rgba(56,189,248,0.15)' } },
      axisLabel: { color: '#e2e8f0', fontSize: 12, fontWeight: 600 }
    },
    series: [{
      type: 'bar',
      data: scores.map((s, i) => ({
        value: s,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: colors[i] + '40' },
            { offset: 1, color: colors[i] }
          ]),
          borderRadius: [0, 4, 4, 0]
        }
      })),
      barWidth: 24,
      label: {
        show: true,
        position: 'right',
        color: '#e2e8f0',
        fontSize: 13,
        fontWeight: 700,
        fontFamily: 'JetBrains Mono, monospace',
        formatter: '{c} 分'
      }
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', () => chart.resize());
}

// 缓存项目页面数据供弹框使用
let _projectPagesCache = {};

function renderHealthRanking(ranking) {
  // 缓存页面数据
  [...(ranking.worst || []), ...(ranking.best || [])].forEach(item => {
    const key = `${item.department}|||${item.platform}`;
    if (item.pages) _projectPagesCache[key] = item;
  });

  // 黑榜
  const blackBody = document.getElementById('healthBlackBody');
  if (blackBody) {
    if (ranking.worst.length === 0) {
      blackBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:2rem;">暂无数据</td></tr>';
    } else {
      blackBody.innerHTML = ranking.worst.map(item => {
        const perfColor = scoreColor(item.performance);
        const healthColor = scoreColor(item.health_score);
        const rankBg = item.rank <= 3 ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.08)';
        const rankColor = item.rank <= 3 ? 'var(--accent-red)' : 'var(--text-secondary)';
        const key = `${item.department}|||${item.platform}`;
        return `
          <tr style="border-left:3px solid var(--accent-red); cursor:pointer;" onclick="showProjectPages('${key.replace(/'/g, "\\'")}')">
            <td style="text-align:center;"><span style="display:inline-block; width:1.75rem; height:1.75rem; line-height:1.75rem; text-align:center; border-radius:50%; background:${rankBg}; color:${rankColor}; font-weight:700; font-size:0.8125rem;">${item.rank}</span></td>
            <td><div style="font-weight:600; font-size:0.8125rem;">${item.department} / ${item.platform}</div></td>
            <td style="font-size:0.75rem; color:var(--text-muted);">${item.page_count}</td>
            <td><span style="font-weight:700; color:${perfColor}; font-family:'JetBrains Mono',monospace;">${item.performance != null ? item.performance : '--'}</span></td>
            <td><span style="font-weight:700; color:${healthColor}; font-family:'JetBrains Mono',monospace;">${item.health_score}</span></td>
          </tr>`;
      }).join('');
    }
  }

  // 红榜
  const redBody = document.getElementById('healthRedBody');
  if (redBody) {
    if (ranking.best.length === 0) {
      redBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:2rem;">暂无数据</td></tr>';
    } else {
      redBody.innerHTML = ranking.best.map(item => {
        const perfColor = scoreColor(item.performance);
        const healthColor = scoreColor(item.health_score);
        const rankBg = item.rank <= 3 ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.08)';
        const rankColor = item.rank <= 3 ? 'var(--accent-green)' : 'var(--text-secondary)';
        const key = `${item.department}|||${item.platform}`;
        return `
          <tr style="border-left:3px solid var(--accent-green); cursor:pointer;" onclick="showProjectPages('${key.replace(/'/g, "\\'")}')">
            <td style="text-align:center;"><span style="display:inline-block; width:1.75rem; height:1.75rem; line-height:1.75rem; text-align:center; border-radius:50%; background:${rankBg}; color:${rankColor}; font-weight:700; font-size:0.8125rem;">${item.rank}</span></td>
            <td><div style="font-weight:600; font-size:0.8125rem;">${item.department} / ${item.platform}</div></td>
            <td style="font-size:0.75rem; color:var(--text-muted);">${item.page_count}</td>
            <td><span style="font-weight:700; color:${perfColor}; font-family:'JetBrains Mono',monospace;">${item.performance != null ? item.performance : '--'}</span></td>
            <td><span style="font-weight:700; color:${healthColor}; font-family:'JetBrains Mono',monospace;">${item.health_score}</span></td>
          </tr>`;
      }).join('');
    }
  }
}

// 显示项目下的页面详情弹框
function showProjectPages(key) {
  // 先从缓存找，缓存没有就从排行榜数据找
  let project = _projectPagesCache[key];
  if (!project || !project.pages) {
    // 从排行榜缓存找
    if (_rankingProjectsCache) {
      const [dept, platform] = key.split('|||');
      project = _rankingProjectsCache.find(p => p.department === dept && p.platform === platform);
    }
  }
  if (!project || !project.pages) {
    toast('未找到项目数据', 'error');
    return;
  }

  const [dept, platform] = key.split('|||');
  document.getElementById('projectPagesTitle').textContent = `${dept} / ${platform}（${project.pages.length} 个页面）`;

  const scoreVal = (v) => v != null ? v : '--';

  // 按健康度排序
  const sorted = [...project.pages].sort((a, b) => (a.health_score ?? -1) - (b.health_score ?? -1));

  document.getElementById('projectPagesBody').innerHTML = sorted.map(p => `
    <tr>
      <td>
        <div style="font-weight:600; font-size:0.8125rem;">${p.name}</div>
        <div style="font-size:0.6875rem; color:var(--text-muted); max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.url || ''}</div>
      </td>
      <td><span style="font-weight:700; color:${scoreColor(p.score_performance)}; font-family:'JetBrains Mono',monospace;">${scoreVal(p.score_performance)}</span></td>
      <td><span style="font-weight:700; color:${scoreColor(p.score_accessibility)}; font-family:'JetBrains Mono',monospace;">${scoreVal(p.score_accessibility)}</span></td>
      <td><span style="font-weight:700; color:${scoreColor(p.score_best_practices)}; font-family:'JetBrains Mono',monospace;">${scoreVal(p.score_best_practices)}</span></td>
      <td><span style="font-weight:700; color:${scoreColor(p.score_seo)}; font-family:'JetBrains Mono',monospace;">${scoreVal(p.score_seo)}</span></td>
      <td><span style="font-weight:700; color:${scoreColor(p.score_security)}; font-family:'JetBrains Mono',monospace;">${scoreVal(p.score_security)}</span></td>
      <td><span style="font-weight:700; color:${scoreColor(p.health_score)}; font-family:'JetBrains Mono',monospace;">${scoreVal(p.health_score)}</span></td>
      <td>${p.site_id ? `<button class="btn btn-sm" onclick="closeModal('projectPagesModal'); showSiteDetail('${p.site_id}')">详情</button>` : ''}</td>
    </tr>
  `).join('');

  showModal('projectPagesModal');
}

function renderHealthPlatformTable(platformData) {
  const tbody = document.getElementById('healthPlatformBody');
  if (!tbody) return;

  if (platformData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:2rem;">暂无平台数据</td></tr>';
    return;
  }

  tbody.innerHTML = platformData.map(p => {
    const perfColor = scoreColor(p.avg_performance);
    const healthColor = scoreColor(p.avg_health);
    const passColor = scoreColor(p.pass_rate);
    const statusLabel = p.status === 'healthy' ? '健康' : p.status === 'warning' ? '需关注' : '异常';
    const statusColor = p.status === 'healthy' ? 'var(--accent-green)' : p.status === 'warning' ? 'var(--accent-yellow)' : 'var(--accent-red)';
    const statusBg = p.status === 'healthy' ? 'rgba(16,185,129,0.1)' : p.status === 'warning' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)';

    return `
      <tr>
        <td style="font-weight:600;">${p.department}</td>
        <td style="color:var(--accent-cyan); font-weight:600;">${p.platform}</td>
        <td style="text-align:center;">${p.page_count}</td>
        <td style="text-align:center;"><span style="font-weight:700; color:${perfColor}; font-family:'JetBrains Mono',monospace;">${p.avg_performance ?? '--'}</span></td>
        <td style="text-align:center;"><span style="font-weight:700; color:${healthColor}; font-family:'JetBrains Mono',monospace;">${p.avg_health ?? '--'}</span></td>
        <td style="text-align:center;"><span style="font-weight:700; color:${passColor}; font-family:'JetBrains Mono',monospace;">${p.pass_rate}%</span></td>
        <td style="text-align:center;"><span style="display:inline-block; padding:0.25rem 0.625rem; border-radius:1rem; font-size:0.75rem; font-weight:600; color:${statusColor}; background:${statusBg};">${statusLabel}</span></td>
      </tr>`;
  }).join('');
}

function sortHealthTable(field) {
  if (_healthSortField === field) {
    _healthSortAsc = !_healthSortAsc;
  } else {
    _healthSortField = field;
    _healthSortAsc = false;
  }

  const sorted = [..._healthPlatformData].sort((a, b) => {
    const va = a[field] ?? -1;
    const vb = b[field] ?? -1;
    return _healthSortAsc ? va - vb : vb - va;
  });

  renderHealthPlatformTable(sorted);
}

// ============ 趋势图 ============
async function loadOverviewTrend(siteId) {
  const res = await api(`/sites/${siteId}/trend?limit=30`);
  if (!res.success || !res.data.length) return;

  const data = res.data.reverse();
  renderTrendChart('trendChart', data, false);
}

function renderTrendChart(containerId, data, showMetrics = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // 清理旧实例，防止内存泄漏
  if (containerId === 'trendChart' && trendChartInstance) { trendChartInstance.dispose(); trendChartInstance = null; }
  if (containerId === 'detailTrendChart' && detailTrendChartInstance) { detailTrendChartInstance.dispose(); detailTrendChartInstance = null; }
  if (containerId === 'platTrendChart' && platTrendChartInstance) { platTrendChartInstance.dispose(); platTrendChartInstance = null; }

  const chart = echarts.init(container, null, { renderer: 'canvas' });
  const times = data.map(d => {
    const date = new Date(d.created_at);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
  });

  const series = [
    {
      name: '性能',
      type: 'line',
      data: data.map(d => d.score_performance),
      smooth: true,
      lineStyle: { width: 2, color: '#22d3ee' },
      itemStyle: { color: '#22d3ee' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(34,211,238,0.3)' },
          { offset: 1, color: 'rgba(34,211,238,0)' }
        ])
      }
    },
    {
      name: '无障碍',
      type: 'line',
      data: data.map(d => d.score_accessibility),
      smooth: true,
      lineStyle: { width: 2, color: '#3b82f6' },
      itemStyle: { color: '#3b82f6' }
    },
    {
      name: '最佳实践',
      type: 'line',
      data: data.map(d => d.score_best_practices),
      smooth: true,
      lineStyle: { width: 2, color: '#a855f7' },
      itemStyle: { color: '#a855f7' }
    },
    {
      name: 'SEO',
      type: 'line',
      data: data.map(d => d.score_seo),
      smooth: true,
      lineStyle: { width: 2, color: '#10b981' },
      itemStyle: { color: '#10b981' }
    },
    {
      name: '安全',
      type: 'line',
      data: data.map(d => d.score_security),
      smooth: true,
      lineStyle: { width: 2, color: '#ef4444' },
      itemStyle: { color: '#ef4444' }
    }
  ];

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(56, 189, 248, 0.2)',
      textStyle: { color: '#e2e8f0', fontSize: 12 }
    },
    legend: {
      data: series.map(s => s.name),
      textStyle: { color: '#94a3b8', fontSize: 11 },
      top: 0,
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 3
    },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: 'rgba(56,189,248,0.15)' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(56,189,248,0.06)' } }
    },
    series
  };

  chart.setOption(option);
  window.addEventListener('resize', () => chart.resize());

  if (containerId === 'trendChart') trendChartInstance = chart;
  if (containerId === 'detailTrendChart') detailTrendChartInstance = chart;
}

// ============ Site Detail ============
async function showSiteDetail(siteId, options = {}) {
  const { skipSave = false } = options;
  currentSiteId = siteId;

  // 切换到详情页
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-detail').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  window.scrollTo(0, 0);

  // 返回按钮 - 回到平台页
  document.getElementById('detailBackBtn').onclick = () => {
    if (currentPlatform && currentDept) {
      showPlatform(currentDept, currentPlatform);
    } else if (currentDept) {
      showDepartment(currentDept);
    } else {
      showPage('dashboard');
    }
  };

  // 加载站点信息
  const siteRes = await api(`/sites/${siteId}`);
  if (!siteRes.success) return;

  const site = siteRes.data;
  currentDept = site.group_name || currentDept;
  currentPlatform = site.platform_name || currentPlatform;

  if (!skipSave) {
    saveRoute({
      type: 'detail',
      siteId,
      deptName: currentDept,
      platformName: currentPlatform,
    });
  }

  const platformTag = site.platform_name ? ` · ${site.platform_name}` : '';
  document.getElementById('detailName').textContent = site.name;
  document.getElementById('detailUrl').textContent = `${site.group_name || ''}${platformTag} · ${site.url}`;

  // 加载最新巡检
  const latestRes = await api(`/sites/${siteId}/latest`);
  if (latestRes.success && latestRes.data) {
    const scan = latestRes.data;
    syncSiteScoreToLocalCache(siteId, scan);
    renderDetailMetrics(scan);
    renderGauges('detailGauges', {
      '性能': scan.score_performance,
      '无障碍': scan.score_accessibility,
      '最佳实践': scan.score_best_practices,
      'SEO': scan.score_seo,
      '安全': scan.score_security
    });

    // AI 报告
    if (scan.ai_analysis) {
      try {
        const analysis = JSON.parse(scan.ai_analysis);
        renderAiReport(analysis);
      } catch (e) {}
    }

    // 安全报告
    renderSecurityReport(scan);
  }

  // 加载趋势
  const trendRes = await api(`/sites/${siteId}/trend?limit=30`);
  if (trendRes.success && trendRes.data.length) {
    renderTrendChart('detailTrendChart', trendRes.data.reverse(), true);
  }

  // 加载历史
  const histRes = await api(`/sites/${siteId}/scans?limit=20`);
  if (histRes.success) {
    renderScanHistory(histRes.data);
  }
}

function renderDetailMetrics(scan) {
  const fmtVal = (v, isCls) => v == null ? null : isCls ? parseFloat(v).toFixed(4) : Math.round(v);
  const metrics = [
    { label: 'FCP', cnName: '首次内容绘制', desc: '页面首个内容元素出现的时间', value: fmtVal(scan.fcp), unit: 'ms', warn: 3000, good: 1800 },
    { label: 'LCP', cnName: '最大内容绘制', desc: '页面最大元素渲染完成的时间', value: fmtVal(scan.lcp), unit: 'ms', warn: 4000, good: 2500 },
    { label: 'CLS', cnName: '累计布局偏移', desc: '页面元素意外移动的程度，越小越好', value: fmtVal(scan.cls, true), unit: '', warn: 0.25, good: 0.1 },
    { label: 'TBT', cnName: '总阻塞时间', desc: '主线程被长任务阻塞的总时间', value: fmtVal(scan.tbt), unit: 'ms', warn: 600, good: 200 },
    { label: 'SI', cnName: '速度指数', desc: '页面可见内容填充速度', value: fmtVal(scan.si), unit: 'ms', warn: 5000, good: 3400 },
    { label: 'TTI', cnName: '可交互时间', desc: '页面完全可交互所需时间', value: fmtVal(scan.tti), unit: 'ms', warn: 7000, good: 3800 }
  ];

  // 解析稳定性数据
  let stabilityHtml = '';
  try {
    const rawData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data;
    if (rawData?.stability) {
      const { successCount, totalAttempts, stabilityRate } = rawData.stability;
      if (totalAttempts > 1) {
        const stabColor = stabilityRate === 100 ? 'var(--accent-green)' : stabilityRate > 0 ? 'var(--accent-yellow)' : 'var(--accent-red)';
        const stabIcon = stabilityRate === 100 ? '' : stabilityRate > 0 ? ' ⚠' : ' ✕';
        stabilityHtml = `
          <div class="metric-card" style="border-color:${stabColor}40;">
            <div class="metric-value" style="color:${stabColor};">${stabilityRate}%${stabIcon}</div>
            <div class="metric-label">采集成功率</div>
            <div style="font-size:0.625rem; color:var(--text-muted); margin-top:0.25rem;">${successCount}/${totalAttempts} 次成功</div>
          </div>`;
      }
    }
  } catch (e) {}

  document.getElementById('detailMetrics').innerHTML = metrics.map(m => {
    if (m.value == null) {
      return `
        <div class="metric-card" title="${m.desc}" style="opacity:0.6;">
          <div class="metric-value" style="color:var(--text-muted);">N/A</div>
          <div class="metric-label">${m.label}</div>
          <div style="font-size:0.8125rem; color:var(--text-secondary); margin-top:0.375rem;">${m.cnName}</div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">暂无数据</div>
        </div>`;
    }
    const numVal = parseFloat(m.value);
    const isGood = numVal <= m.good;
    const isWarn = numVal > m.warn;
    const color = isWarn ? 'var(--accent-red)' : isGood ? 'var(--accent-green)' : 'var(--accent-yellow)';
    const statusText = isWarn ? '超标' : isGood ? '良好' : '一般';
    return `
      <div class="metric-card" title="${m.desc}">
        <div class="metric-value" style="color:${color};">${m.value}<span class="metric-unit">${m.unit}</span></div>
        <div class="metric-label">${m.label}</div>
        <div style="font-size:0.8125rem; color:var(--text-secondary); margin-top:0.375rem;">${m.cnName}</div>
        <div style="font-size:0.75rem; color:${color}; margin-top:0.25rem; font-weight:500;">
          ${statusText} · 标准≤${m.good}${m.unit}
        </div>
      </div>`;
  }).join('') + stabilityHtml;
}

function renderSecurityReport(scan) {
  const panel = document.getElementById('securityReportPanel');
  const body = document.getElementById('securityReportBody');
  const badge = document.getElementById('securityScoreBadge');
  if (!panel || !body) return;

  let rawData;
  try { rawData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data; } catch (e) { rawData = {}; }
  const issues = rawData?.puppeteer_diagnostics?.security;
  const score = scan.score_security;

  if (score == null && (!issues || issues.length === 0)) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';

  // 分数标记
  const scoreColor = score >= 80 ? 'var(--accent-green)' : score >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  const scoreLabel = score >= 80 ? '安全' : score >= 50 ? '需关注' : '高风险';
  badge.style.background = scoreColor + '20';
  badge.style.color = scoreColor;
  badge.textContent = score != null ? `${score} 分 · ${scoreLabel}` : '--';

  if (!issues || issues.length === 0) {
    body.innerHTML = '<div style="color:var(--accent-green); text-align:center; padding:1rem;">未发现安全问题</div>';
    return;
  }

  // 按严重程度分组
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const severityLabel = { critical: '严重', high: '高危', medium: '中危', low: '低危' };
  const severityColor = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280' };
  const severityBg = { critical: 'rgba(239,68,68,0.1)', high: 'rgba(249,115,22,0.1)', medium: 'rgba(234,179,8,0.1)', low: 'rgba(107,114,128,0.1)' };

  const sorted = [...issues].sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  // 统计
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  sorted.forEach(i => counts[i.severity] = (counts[i.severity] || 0) + 1);

  let html = `<div style="display:flex; gap:0.75rem; margin-bottom:1rem; flex-wrap:wrap;">`;
  for (const [sev, label] of Object.entries(severityLabel)) {
    if (counts[sev] > 0) {
      html += `<div style="display:flex; align-items:center; gap:0.25rem; padding:0.25rem 0.625rem; border-radius:0.25rem; background:${severityBg[sev]}; font-size:0.75rem;">
        <span style="width:8px; height:8px; border-radius:50%; background:${severityColor[sev]}; display:inline-block;"></span>
        <span style="color:${severityColor[sev]}; font-weight:600;">${label} ${counts[sev]}</span>
      </div>`;
    }
  }
  html += '</div>';

  html += '<div style="display:flex; flex-direction:column; gap:0.5rem;">';
  sorted.forEach(item => {
    const sev = item.severity || 'medium';
    html += `<div style="display:flex; align-items:flex-start; gap:0.625rem; padding:0.5rem 0.75rem; border-radius:0.375rem; background:${severityBg[sev]}; border-left:3px solid ${severityColor[sev]};">
      <span style="font-size:0.6875rem; font-weight:700; color:${severityColor[sev]}; min-width:2rem; text-align:center; padding:0.125rem 0; border-radius:0.125rem; background:${severityColor[sev]}15;">${severityLabel[sev]}</span>
      <span style="font-size:0.8125rem; color:var(--text-primary); line-height:1.5;">${item.issue}</span>
    </div>`;
  });
  html += '</div>';

  body.innerHTML = html;
}

function renderAiReport(analysis) {
  const container = document.getElementById('detailAiReport');
  if (!analysis) return;

  let issuesHtml = '';
  if (analysis.core_issues && analysis.core_issues.length) {
    issuesHtml = `
      <div style="margin-top:1rem;">
        <div style="font-weight:600; font-size:0.875rem; margin-bottom:0.5rem;">核心问题</div>
        ${analysis.core_issues.map(i => `
          <div class="alert-item ${i.impact === 'high' ? 'critical' : 'warning'}">
            <div class="alert-dot"></div>
            <div class="alert-content">
              <div class="alert-title">${i.issue}</div>
              <div class="alert-desc">${i.detail || ''}</div>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  let suggestionsHtml = '';
  if (analysis.suggestions && analysis.suggestions.length) {
    suggestionsHtml = `
      <div style="margin-top:1rem;">
        <div style="font-weight:600; font-size:0.875rem; margin-bottom:0.5rem;">优化建议</div>
        <ul class="suggestion-list">
          ${analysis.suggestions.map(s => `
            <li class="suggestion-item">
              <div class="suggestion-header">
                <div class="suggestion-title">${s.title}</div>
                <span class="priority-tag ${(s.priority || 'P2').toLowerCase()}">${s.priority || 'P2'}</span>
              </div>
              <div class="suggestion-desc">${s.description}</div>
              ${s.expected_improvement ? `<div class="suggestion-effect">${s.expected_improvement}</div>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>`;
  }

  container.innerHTML = `
    <div class="ai-report">
      <div class="ai-report-header">
        <span class="ai-badge">AI 分析</span>
        <span class="risk-badge ${analysis.risk_level || 'low'}">${analysis.risk_level || 'N/A'}</span>
      </div>
      <div class="ai-summary">${analysis.summary || '暂无分析数据'}</div>
      ${issuesHtml}
      ${suggestionsHtml}
      ${analysis.trend_analysis ? `
        <div style="margin-top:1rem; font-size:0.8125rem; color:var(--text-secondary);">
          <strong>趋势:</strong> ${analysis.trend_analysis}
        </div>` : ''}
    </div>`;
}

function renderScanHistory(scans) {
  const tbody = document.getElementById('detailHistory');
  if (!scans || !scans.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">暂无巡检记录</td></tr>';
    return;
  }

  tbody.innerHTML = scans.map(s => {
    const status = s.status === 'completed'
      ? '<span style="color:var(--accent-green);">已完成</span>'
      : s.status === 'partial'
      ? '<span style="color:var(--accent-yellow);" title="性能指标采集失败，其他指标正常">部分采集</span>'
      : s.status === 'failed'
      ? '<span style="color:var(--accent-red);">失败</span>'
      : '<span style="color:var(--accent-yellow);">运行中</span>';

    return `
      <tr>
        <td style="font-family:'JetBrains Mono',monospace; font-size:0.75rem;">${new Date(s.created_at).toLocaleString('zh-CN')}</td>
        <td><span style="display:inline-block; min-width:2.25rem; text-align:center; padding:0.25rem 0.5rem; border-radius:0.25rem; font-weight:700; font-size:0.8125rem; font-family:'JetBrains Mono',monospace; ${getScoreStyle(s.score_performance)}">${formatScore(s.score_performance)}</span></td>
        <td>${s.fcp != null ? Math.round(s.fcp) + 'ms' : '--'}</td>
        <td>${s.lcp != null ? Math.round(s.lcp) + 'ms' : '--'}</td>
        <td>${s.cls != null ? s.cls.toFixed(4) : '--'}</td>
        <td>${s.tbt != null ? Math.round(s.tbt) + 'ms' : '--'}</td>
        <td>${status}</td>
      </tr>`;
  }).join('');
}

// ============ Sites Management ============
async function loadSitesManagement() {
  const [res, deptRes] = await Promise.all([api('/sites'), api('/departments')]);
  if (!res.success) return;

  allSites = res.data;
  const departments = deptRes.success ? deptRes.data : [];
  const container = document.getElementById('sitesManagement');

  const groups = {};
  // 先加入数据库里的部门（空部门也显示）
  departments.forEach(d => { if (!groups[d.name]) groups[d.name] = { sites: [], deptId: d.id }; });
  // 再归入站点
  allSites.forEach(s => {
    const g = s.group_name || '默认分组';
    if (!groups[g]) groups[g] = { sites: [], deptId: null };
    groups[g].sites.push(s);
  });

  const groupEntries = Object.entries(groups);

  if (groupEntries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">+</div>
        <div class="empty-text">暂未配置站点</div>
        <div class="empty-hint">添加部门和站点开始监控</div>
      </div>`;
    return;
  }

  // 部门 Tab
  let tabsHtml = `<div style="display:flex; gap:0.25rem; margin-bottom:1.25rem; overflow-x:auto;">`;
  groupEntries.forEach(([group, groupData], i) => {
    tabsHtml += `<button class="nav-item ${i === 0 ? 'active' : ''}" onclick="switchSiteMgmtTab(${i}, this)" style="flex-shrink:0;">${group} <span style="font-size:0.6875rem; opacity:0.7;">(${groupData.sites.length})</span></button>`;
  });
  tabsHtml += `</div>`;

  // 每个部门的内容面板
  let panelsHtml = '';
  groupEntries.forEach(([group, groupData], i) => {
    const sites = groupData.sites;
    const deptId = groupData.deptId;

    // 按平台分组
    const platGroups = {};
    sites.forEach(s => {
      const p = s.platform_name || '未分类';
      if (!platGroups[p]) platGroups[p] = [];
      platGroups[p].push(s);
    });
    const platEntries = Object.entries(platGroups);

    panelsHtml += `<div class="sites-mgmt-tab-panel" id="sitesMgmtTab_${i}" style="${i === 0 ? '' : 'display:none;'}">`;

    // 部门操作栏
    panelsHtml += `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <span style="font-size:0.875rem; color:var(--text-muted);">${platEntries.length} 个项目 · ${sites.length} 个页面</span>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <button class="btn btn-sm btn-primary" onclick="scanByDepartment('${group}')">巡检整个部门</button>
          ${deptId ? `<button class="btn btn-sm btn-danger" onclick="deleteDepartment('${deptId}', '${group}')">删除部门</button>` : ''}
        </div>
      </div>`;

    // 平台子 Tab
    if (platEntries.length > 1) {
      panelsHtml += `<div style="display:flex; gap:0.25rem; margin-bottom:1rem; overflow-x:auto;">`;
      panelsHtml += `<button class="nav-item active" onclick="switchSiteMgmtPlatTab('sitesMgmtTab_${i}', '__all__', this)" style="flex-shrink:0; font-size:0.8125rem; padding:0.375rem 0.75rem;">全部</button>`;
      platEntries.forEach(([plat, platSites]) => {
        panelsHtml += `<button class="nav-item" onclick="switchSiteMgmtPlatTab('sitesMgmtTab_${i}', '${plat}', this)" style="flex-shrink:0; font-size:0.8125rem; padding:0.375rem 0.75rem;">${plat} <span style="font-size:0.625rem; opacity:0.7;">(${platSites.length})</span></button>`;
      });
      panelsHtml += `</div>`;
    }

    // 每个平台的内容
    platEntries.forEach(([plat, platSites]) => {
      panelsHtml += `
        <div class="sites-mgmt-plat-panel" data-parent="sitesMgmtTab_${i}" data-plat="${plat}">
          <div class="panel" style="margin-bottom:1rem;">
            <div class="panel-header">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <div class="panel-title" style="color:var(--accent-cyan);">${plat}</div>
                <span style="font-size:0.6875rem; color:var(--text-muted);">${platSites.length} 个页面</span>
                <span style="font-size:0.6875rem; color:var(--accent-cyan); background:rgba(6,182,212,0.1); padding:0.125rem 0.5rem; border-radius:0.25rem;">${cronToText(platSites[0]?.scan_cron)}</span>
              </div>
              <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-sm" onclick="showDomainReplaceModal('${group.replace(/'/g,"\\'")}', '${plat.replace(/'/g,"\\'")}')">域名替换</button>
                <button class="btn btn-sm" onclick="showEditProjectCronModal('${group.replace(/'/g,"\\'")}', '${plat.replace(/'/g,"\\'")}')">频率设置</button>
                <button class="btn btn-sm btn-primary" onclick="scanByPlatform('${group.replace(/'/g,"\\'")}', '${plat.replace(/'/g,"\\'")}')">巡检项目</button>
                <button class="btn btn-sm btn-danger" onclick="deletePlatform('${group.replace(/'/g,"\\'")}', '${plat.replace(/'/g,"\\'")}')">删除项目</button>
              </div>
            </div>
            <div class="panel-body" style="padding:0;">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>页面</th>
                    <th>URL</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${platSites.map(s => `
                    <tr>
                      <td style="font-weight:600;">${s.name}</td>
                      <td style="font-size:0.75rem; color:var(--text-muted); max-width:20rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.url}</td>
                      <td>${s.enabled ? '<span style="color:var(--accent-green);">已启用</span>' : '<span style="color:var(--text-muted);">已禁用</span>'}</td>
                      <td>
                        <button class="btn btn-sm btn-primary" onclick="scanSite('${s.id}')">巡检</button>
                        <button class="btn btn-sm" onclick="showEditSiteModal('${s.id}')">编辑</button>
                        <button class="btn btn-sm" onclick="showSiteDetail('${s.id}')">详情</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteSite('${s.id}', '${s.name}')">删除</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>`;
    });

    panelsHtml += `</div>`;
  });

  container.innerHTML = tabsHtml + panelsHtml;
}

// ============ Reports ============
async function loadReports() {
  const sitesRes = await api('/sites');
  if (!sitesRes.success) return;

  const container = document.getElementById('reportsContainer');

  // 按部门→平台收集报告
  const grouped = {};
  for (const site of sitesRes.data) {
    const reportsRes = await api(`/sites/${site.id}/reports?limit=3`);
    if (!reportsRes.success || !reportsRes.data.length) continue;

    const dept = site.group_name || '默认分组';
    const plat = site.platform_name || '未分类';
    if (!grouped[dept]) grouped[dept] = {};
    if (!grouped[dept][plat]) grouped[dept][plat] = [];

    for (const report of reportsRes.data) {
      try {
        const analysis = JSON.parse(report.content);
        grouped[dept][plat].push({ site, report, analysis });
      } catch (e) {}
    }
  }

  const deptNames = Object.keys(grouped);
  if (deptNames.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">AI</div>
        <div class="empty-text">暂无分析报告</div>
        <div class="empty-hint">运行巡检后将自动生成 AI 分析报告</div>
      </div>`;
    return;
  }

  // 部门 Tab
  let tabsHtml = `<div style="display:flex; gap:0.25rem; margin-bottom:1.25rem; overflow-x:auto;">`;
  deptNames.forEach((dept, i) => {
    const count = Object.values(grouped[dept]).reduce((a, b) => a + b.length, 0);
    tabsHtml += `<button class="nav-item ${i === 0 ? 'active' : ''}" onclick="switchReportTab('${dept}', this)" style="flex-shrink:0;">${dept} <span style="font-size:0.6875rem; opacity:0.7;">(${count})</span></button>`;
  });
  tabsHtml += `</div>`;

  // 每个部门的内容
  let panelsHtml = '';
  deptNames.forEach((dept, i) => {
    const platforms = grouped[dept];
    const platNames = Object.keys(platforms);

    panelsHtml += `<div class="report-tab-panel" id="reportTab_${i}" style="${i === 0 ? '' : 'display:none;'}">`;

    // 平台子 Tab
    panelsHtml += `<div style="display:flex; gap:0.25rem; margin-bottom:1rem; overflow-x:auto;">`;
    platNames.forEach((plat, j) => {
      panelsHtml += `<button class="nav-item ${j === 0 ? 'active' : ''}" onclick="switchReportPlatTab('reportTab_${i}', '${plat}', this)" style="flex-shrink:0; font-size:0.8125rem; padding:0.375rem 0.75rem;">${plat} <span style="font-size:0.625rem; opacity:0.7;">(${platforms[plat].length})</span></button>`;
    });
    panelsHtml += `</div>`;

    // 每个平台的报告
    platNames.forEach((plat, j) => {
      panelsHtml += `<div class="report-plat-panel" data-parent="reportTab_${i}" data-plat="${plat}" style="${j === 0 ? '' : 'display:none;'}">`;
      panelsHtml += platforms[plat].map(({ site, report, analysis }) => {
        const riskMap = { critical: '严重', high: '高风险', medium: '中等', low: '低风险' };
        const riskLabel = riskMap[report.risk_level] || report.risk_level;

        let issuesHtml = '';
        if (analysis.core_issues && analysis.core_issues.length) {
          issuesHtml = analysis.core_issues.slice(0, 3).map(issue => `
            <div style="display:flex; align-items:flex-start; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid var(--border-color);">
              <span style="flex-shrink:0; width:0.5rem; height:0.5rem; border-radius:50%; margin-top:0.375rem; background:${issue.impact === 'high' ? 'var(--accent-red)' : 'var(--accent-yellow)'}; box-shadow:0 0 6px ${issue.impact === 'high' ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.5)'};"></span>
              <div>
                <div style="font-weight:600; font-size:0.8125rem;">${issue.issue}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${issue.detail || ''}</div>
              </div>
            </div>
          `).join('');
        }

        let suggestionsHtml = '';
        if (analysis.suggestions && analysis.suggestions.length) {
          suggestionsHtml = `<div style="display:flex; gap:0.375rem; flex-wrap:wrap; margin-top:0.75rem;">` +
            analysis.suggestions.slice(0, 4).map(s => {
              const pColor = s.priority === 'P0' ? 'var(--accent-red)' : s.priority === 'P1' ? 'var(--accent-yellow)' : 'var(--accent-cyan)';
              return `<span style="display:inline-flex; align-items:center; gap:0.25rem; padding:0.25rem 0.625rem; background:rgba(34,211,238,0.08); border:1px solid rgba(34,211,238,0.15); border-radius:1rem; font-size:0.75rem; color:var(--accent-cyan);"><span style="font-size:0.625rem; font-weight:700; color:${pColor};">${s.priority || 'P2'}</span> ${s.title}</span>`;
            }).join('') + `</div>`;
        }

        return `
          <div class="panel" style="margin-bottom:1rem;">
            <div class="panel-header">
              <div class="panel-title">${site.name}</div>
              <div style="display:flex; gap:0.5rem; align-items:center;">
                <span class="risk-badge ${report.risk_level}">${riskLabel}</span>
                <span style="font-size:0.75rem; color:var(--text-muted);">${new Date(report.created_at).toLocaleString('zh-CN')}</span>
              </div>
            </div>
            <div class="panel-body">
              <div style="font-size:0.9375rem; line-height:1.7; margin-bottom:0.75rem;">${analysis.summary || ''}</div>
              ${issuesHtml}
              ${suggestionsHtml}
            </div>
          </div>`;
      }).join('');
      panelsHtml += `</div>`;
    });

    panelsHtml += `</div>`;
  });

  container.innerHTML = tabsHtml + panelsHtml;
}

// 站点管理 Tab 切换
function switchSiteMgmtTab(idx, btn) {
  btn.parentElement.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.sites-mgmt-tab-panel').forEach(p => p.style.display = 'none');
  const target = document.getElementById('sitesMgmtTab_' + idx);
  if (target) target.style.display = '';
}

function switchSiteMgmtPlatTab(parentId, plat, btn) {
  btn.parentElement.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll(`.sites-mgmt-plat-panel[data-parent="${parentId}"]`).forEach(p => {
    p.style.display = plat === '__all__' ? '' : (p.dataset.plat === plat ? '' : 'none');
  });
}

// AI报告 Tab 切换
function switchReportTab(dept, btn) {
  btn.parentElement.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.report-tab-panel').forEach(p => p.style.display = 'none');
  const btns = Array.from(btn.parentElement.children);
  const idx = btns.indexOf(btn);
  const target = document.getElementById('reportTab_' + idx);
  if (target) target.style.display = '';
}

function switchReportPlatTab(parentId, plat, btn) {
  btn.parentElement.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll(`.report-plat-panel[data-parent="${parentId}"]`).forEach(p => {
    p.style.display = p.dataset.plat === plat ? '' : 'none';
  });
}

// ============ Alerts ============
async function loadAlerts() {
  const res = await api('/alerts?limit=50');
  if (!res.success) return;

  const container = document.getElementById('alertsContainer');

  if (!res.data || !res.data.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">!</div>
        <div class="empty-text">暂无告警</div>
        <div class="empty-hint">当指标低于设定阈值时将触发告警</div>
      </div>`;
    return;
  }

  // 按部门 → 平台分组
  const grouped = {};
  res.data.forEach(a => {
    const dept = a.group_name || '默认分组';
    const plat = a.platform_name || '未分类';
    if (!grouped[dept]) grouped[dept] = {};
    if (!grouped[dept][plat]) grouped[dept][plat] = [];
    grouped[dept][plat].push(a);
  });

  const deptNames = Object.keys(grouped);

  // 部门 Tab
  let tabsHtml = `<div style="display:flex; gap:0.25rem; margin-bottom:1.25rem; overflow-x:auto;">`;
  deptNames.forEach((dept, i) => {
    const count = Object.values(grouped[dept]).reduce((a, b) => a + b.length, 0);
    tabsHtml += `<button class="nav-item ${i === 0 ? 'active' : ''}" onclick="switchAlertTab('${dept}', this)" style="flex-shrink:0;">${dept} <span style="font-size:0.6875rem; opacity:0.7;">(${count})</span></button>`;
  });
  tabsHtml += `</div>`;

  // 每个部门的内容面板
  let panelsHtml = '';
  deptNames.forEach((dept, i) => {
    const platforms = grouped[dept];
    panelsHtml += `<div class="alert-tab-panel" id="alertTab_${i}" style="${i === 0 ? '' : 'display:none;'}">`;

    // 平台子 Tab
    const platNames = Object.keys(platforms);
    panelsHtml += `<div style="display:flex; gap:0.25rem; margin-bottom:1rem; overflow-x:auto;">`;
    platNames.forEach((plat, j) => {
      panelsHtml += `<button class="nav-item ${j === 0 ? 'active' : ''}" onclick="switchAlertPlatTab('alertTab_${i}', '${plat}', this)" style="flex-shrink:0; font-size:0.8125rem; padding:0.375rem 0.75rem;">${plat} <span style="font-size:0.625rem; opacity:0.7;">(${platforms[plat].length})</span></button>`;
    });
    panelsHtml += `</div>`;

    // 每个平台的告警列表
    platNames.forEach((plat, j) => {
      panelsHtml += `<div class="alert-plat-panel" data-parent="alertTab_${i}" data-plat="${plat}" style="${j === 0 ? '' : 'display:none;'}">`;
      panelsHtml += platforms[plat].map(a => `
        <div class="alert-item ${a.level}">
          <div class="alert-dot"></div>
          <div class="alert-content">
            <div class="alert-title">${a.site_name || '未知'} - ${a.message}</div>
            ${a.site_url ? `<div class="alert-desc" style="margin-top:0.25rem;"><a href="${a.site_url}" target="_blank" rel="noopener" style="color:var(--text-secondary); font-size:0.75rem; word-break:break-all;">${a.site_url}</a></div>` : ''}
            <div class="alert-desc">${a.detail || ''}</div>
            <div class="alert-time">${new Date(a.created_at).toLocaleString('zh-CN')}</div>
          </div>
        </div>
      `).join('');
      panelsHtml += `</div>`;
    });

    panelsHtml += `</div>`;
  });

  container.innerHTML = tabsHtml + panelsHtml;
}

// ============ 告警 Tab 切换 ============
function switchAlertTab(dept, btn) {
  // 切换部门 Tab 样式
  btn.parentElement.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');

  // 显示对应面板
  const panels = document.querySelectorAll('.alert-tab-panel');
  panels.forEach((p, i) => {
    const deptNames = Object.keys(arguments); // 用 index 匹配
    p.style.display = 'none';
  });

  // 通过按钮 index 找到对应面板
  const btns = Array.from(btn.parentElement.children);
  const idx = btns.indexOf(btn);
  const targetPanel = document.getElementById('alertTab_' + idx);
  if (targetPanel) targetPanel.style.display = '';
}

function switchAlertPlatTab(parentId, plat, btn) {
  // 切换平台 Tab 样式
  btn.parentElement.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');

  // 显示对应平台面板
  document.querySelectorAll(`.alert-plat-panel[data-parent="${parentId}"]`).forEach(p => {
    p.style.display = p.dataset.plat === plat ? '' : 'none';
  });
}

// ============ Settings ============
async function loadSettings() {
  // 加载定时任务状态（按项目分组）
  const res = await api('/scheduler/status');
  if (res.success) {
    const groups = res.data || [];
    const el = document.getElementById('schedulerStatus');
    if (groups.length === 0) {
      el.innerHTML = '<div style="color:var(--text-muted);">暂无定时任务</div>';
    } else {
      // 按部门分组
      const deptMap = {};
      for (const g of groups) {
        if (!deptMap[g.department]) deptMap[g.department] = [];
        deptMap[g.department].push(g);
      }
      const depts = Object.keys(deptMap);

      // 部门 Tab
      let html = '<div style="display:flex; gap:0.5rem; margin-bottom:1rem; flex-wrap:wrap;">';
      depts.forEach((dept, i) => {
        const totalPages = deptMap[dept].reduce((a, g) => a + g.sites.length, 0);
        html += `<button class="btn btn-sm${i === 0 ? ' btn-primary' : ''}" onclick="switchSchedulerDept('${dept.replace(/'/g,"\\'")}', this)">${dept} <span style="opacity:0.7; font-size:0.6875rem;">(${totalPages})</span></button>`;
      });
      html += '</div>';

      // 每个部门的内容面板
      depts.forEach((dept, i) => {
        const platforms = deptMap[dept];
        html += `<div class="scheduler-dept-panel" data-dept="${dept}" style="${i === 0 ? '' : 'display:none;'}">`;

        // 平台 Tab（第二级）
        if (platforms.length > 1) {
          html += '<div style="display:flex; gap:0.375rem; margin-bottom:0.75rem; flex-wrap:wrap;">';
          platforms.forEach((g, j) => {
            html += `<button class="btn btn-sm${j === 0 ? ' btn-primary' : ''}" style="font-size:0.75rem; padding:0.2rem 0.625rem;" onclick="switchSchedulerPlat('${dept.replace(/'/g,"\\'")}', '${g.platform.replace(/'/g,"\\'")}', this)">${g.platform} <span style="opacity:0.7;">(${g.sites.length})</span></button>`;
          });
          html += '</div>';
        }

        // 每个平台的页面列表
        platforms.forEach((g, j) => {
          html += `<div class="scheduler-plat-panel" data-dept="${dept}" data-plat="${g.platform}" style="${j === 0 ? '' : 'display:none;'}">`;
          html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
            <span style="font-size:0.8125rem; color:var(--text-secondary);">${g.platform} · ${g.sites.length} 个页面</span>
            <span style="color:var(--accent-cyan); font-size:0.8125rem;">${cronToText(g.cron)}</span>
          </div>`;
          html += '<div style="display:flex; flex-wrap:wrap; gap:0.375rem;">';
          g.sites.forEach(s => {
            html += `<span style="font-size:0.75rem; padding:0.2rem 0.5rem; background:var(--bg-secondary); border:1px solid var(--border); border-radius:0.25rem; color:var(--text-secondary); cursor:pointer;" onclick="showSiteDetail('${s.id}')" title="${s.url}">${s.name}</span>`;
          });
          html += '</div></div>';
        });

        html += '</div>';
      });

      el.innerHTML = html;
    }
  }

  // 加载扫描配置（节流开关）
  loadScanConfig();
  // 加载 AI 配置和用量
  loadAiConfig();
  loadTokenUsage();
  // 加载报告推送配置
  loadReportConfig();
  loadReportLogs();
}

// ============ 扫描配置 ============
async function loadScanConfig() {
  const el = document.getElementById('scanConfigArea');
  if (!el) return;
  const res = await api('/scan/config');
  const throttle = res.success ? res.data.throttleEnabled : true;
  el.innerHTML = `
    <div class="panel" style="margin-bottom:1.5rem;">
      <div class="panel-header"><div class="panel-title">巡检配置</div></div>
      <div class="panel-body">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-weight:600; font-size:0.875rem;">真实用户环境模拟</div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">
              开启后模拟 4G 网络 + CPU 4倍降速，评分更稳定更接近 Google PageSpeed Insights。<br>
              关闭则使用本机真实网速和 CPU（desktop 模式），分数偏高但波动大。
            </div>
          </div>
          <label style="position:relative; display:inline-block; width:3rem; height:1.625rem; cursor:pointer;">
            <input type="checkbox" ${throttle ? 'checked' : ''} onchange="toggleThrottle(this.checked)" style="opacity:0; width:0; height:0;">
            <span style="position:absolute; inset:0; background:${throttle ? 'var(--accent-cyan)' : 'rgba(100,116,139,0.3)'}; border-radius:1rem; transition:0.3s;">
              <span style="position:absolute; top:0.1875rem; left:${throttle ? '1.5rem' : '0.1875rem'}; width:1.25rem; height:1.25rem; background:#fff; border-radius:50%; transition:0.3s; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span>
            </span>
          </label>
        </div>
      </div>
    </div>`;
}

async function toggleThrottle(enabled) {
  const res = await api('/scan/config', { method: 'PUT', body: { throttleEnabled: enabled } });
  if (res.success) {
    toast(enabled ? '已开启真实用户环境模拟，评分将更准确' : '已关闭环境模拟，使用本机真实性能', 'success');
    loadScanConfig();
  }
}

// ============ AI 模型配置（多配置） ============
let aiProviders = {};

async function loadAiConfig() {
  // 加载供应商
  const provRes = await api('/ai/providers');
  if (provRes.success) aiProviders = provRes.data;

  // 加载配置列表
  const cfgRes = await api('/ai/configs');
  if (cfgRes.success) renderAiConfigList(cfgRes.data || []);
}

function renderAiConfigList(configs) {
  const el = document.getElementById('aiConfigList');
  if (configs.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:1.5rem;">暂无配置，点击右上角"添加模型"</div>';
    return;
  }

  el.innerHTML = configs.map(c => {
    const providerName = aiProviders[c.provider]?.name || c.provider;
    const statusColor = c.enabled ? 'var(--accent-green)' : 'var(--text-muted)';
    const statusText = c.enabled ? '使用中' : '已禁用';
    const borderColor = c.enabled ? 'var(--accent-green)' : 'var(--border)';
    return `
      <div style="border:1px solid ${borderColor}; border-radius:0.5rem; padding:0.75rem 1rem; margin-bottom:0.5rem; display:flex; align-items:center; gap:1rem; ${c.enabled ? 'background:rgba(16,185,129,0.05);' : ''}">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:0.875rem; color:var(--text-primary);">${c.name}</div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.125rem;">
            ${providerName} · ${c.model} · Key: ${c.api_key_masked || '未设置'}
          </div>
        </div>
        <span style="font-size:0.75rem; font-weight:600; color:${statusColor}; white-space:nowrap;">${statusText}</span>
        <div style="display:flex; gap:0.375rem; flex-shrink:0;">
          ${c.enabled
            ? `<button class="btn btn-sm" onclick="toggleAiConfig(null)">禁用</button>`
            : `<button class="btn btn-sm btn-success" onclick="toggleAiConfig('${c.id}')">启用</button>`
          }
          <button class="btn btn-sm" onclick="editAiConfig('${c.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="deleteAiConfig('${c.id}')">删除</button>
        </div>
      </div>`;
  }).join('');
}

function showAddAiConfigForm() {
  document.getElementById('aiFormTitle').textContent = '添加模型';
  document.getElementById('aiEditId').value = '';
  document.getElementById('aiName').value = '';
  document.getElementById('aiApiKey').value = '';
  document.getElementById('aiBaseUrl').value = '';
  document.getElementById('aiTestResult').innerHTML = '';

  // 填充供应商下拉
  const provSelect = document.getElementById('aiProvider');
  provSelect.innerHTML = Object.entries(aiProviders).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  onAiProviderChange();

  document.getElementById('aiConfigForm').style.display = '';
}

function hideAiConfigForm() {
  document.getElementById('aiConfigForm').style.display = 'none';
}

async function editAiConfig(id) {
  const res = await api('/ai/configs');
  if (!res.success) return;
  const cfg = res.data.find(c => c.id === id);
  if (!cfg) return;

  document.getElementById('aiFormTitle').textContent = '编辑模型';
  document.getElementById('aiEditId').value = id;
  document.getElementById('aiName').value = cfg.name;
  document.getElementById('aiApiKey').value = '';
  document.getElementById('aiBaseUrl').value = cfg.base_url || '';
  document.getElementById('aiTestResult').innerHTML = '';

  const provSelect = document.getElementById('aiProvider');
  provSelect.innerHTML = Object.entries(aiProviders).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  provSelect.value = cfg.provider;
  onAiProviderChange(cfg.model);

  document.getElementById('aiConfigForm').style.display = '';
}

function onAiProviderChange(selectedModel) {
  const provider = document.getElementById('aiProvider').value;
  const modelSelect = document.getElementById('aiModel');
  const customModelGroup = document.getElementById('aiCustomModelGroup');
  const info = aiProviders[provider];
  const models = info ? info.models || [] : [];

  if (provider === 'custom') {
    modelSelect.innerHTML = '<option value="">（请在下方输入）</option>';
    customModelGroup.style.display = '';
  } else {
    modelSelect.innerHTML = models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    customModelGroup.style.display = 'none';
  }

  if (selectedModel) {
    if (models.find(m => m.id === selectedModel)) {
      modelSelect.value = selectedModel;
    } else if (selectedModel) {
      const opt = document.createElement('option');
      opt.value = selectedModel; opt.textContent = selectedModel;
      modelSelect.appendChild(opt);
      modelSelect.value = selectedModel;
      if (provider === 'custom') document.getElementById('aiCustomModel').value = selectedModel;
    }
  }

  // 自动填名称
  if (!document.getElementById('aiEditId').value && !document.getElementById('aiName').value) {
    const provName = info?.name || provider;
    const modelName = modelSelect.options[modelSelect.selectedIndex]?.text || '';
    document.getElementById('aiName').value = `${provName} - ${modelName}`;
  }
}

async function saveAiConfig() {
  const editId = document.getElementById('aiEditId').value;
  const provider = document.getElementById('aiProvider').value;
  let model = document.getElementById('aiModel').value;
  if (provider === 'custom') model = document.getElementById('aiCustomModel').value || model;
  const name = document.getElementById('aiName').value.trim() || `${provider}/${model}`;
  const apiKey = document.getElementById('aiApiKey').value;
  const baseUrl = document.getElementById('aiBaseUrl').value.trim();

  const body = { name, provider, model, base_url: baseUrl };
  if (apiKey) body.api_key = apiKey;

  let res;
  if (editId) {
    res = await api(`/ai/configs/${editId}`, { method: 'PUT', body });
  } else {
    res = await api('/ai/configs', { method: 'POST', body });
  }

  if (res.success) {
    toast(editId ? '配置已更新' : '配置已添加', 'success');
    hideAiConfigForm();
    loadAiConfig();
  } else {
    toast('保存失败: ' + (res.error || ''), 'error');
  }
}

async function deleteAiConfig(id) {
  if (!confirm('确认删除此模型配置？')) return;
  const res = await api(`/ai/configs/${id}`, { method: 'DELETE' });
  if (res.success) { toast('已删除', 'success'); loadAiConfig(); }
}

async function toggleAiConfig(id) {
  const url = id ? `/ai/configs/${id}/enable` : '/ai/configs/disable-all';
  const res = await api(url, { method: 'POST' });
  if (res.success) { toast(id ? '已启用' : '已全部禁用', 'success'); loadAiConfig(); loadAiStatus(); }
}

async function disableAllAi() {
  const res = await api('/ai/configs/disable-all', { method: 'POST' });
  if (res.success) { toast('已全部禁用 AI 分析', 'success'); loadAiConfig(); loadAiStatus(); }
}

async function testAiConnection() {
  const resultEl = document.getElementById('aiTestResult');
  resultEl.innerHTML = '<span style="color:var(--accent-cyan);">测试中...</span>';

  const provider = document.getElementById('aiProvider').value;
  let model = document.getElementById('aiModel').value;
  if (provider === 'custom') model = document.getElementById('aiCustomModel').value || model;
  const apiKey = document.getElementById('aiApiKey').value;
  const baseUrl = document.getElementById('aiBaseUrl').value.trim();

  const editId = document.getElementById('aiEditId').value;

  if (!apiKey) {
    // 新建必须填 Key
    if (!editId) {
      resultEl.innerHTML = '<span style="color:var(--accent-red);">请输入 API Key</span>';
      return;
    }
    // 编辑模式：提示用已有 Key 测试
    resultEl.innerHTML = '<span style="color:var(--accent-cyan);">使用已保存的 Key 测试中...</span>';
  }

  const body = { provider, model, base_url: baseUrl };
  if (apiKey) body.api_key = apiKey;
  // 编辑模式传 id，让后端从数据库取已有 key
  if (editId) body._config_id = editId;

  const res = await api('/ai/test', { method: 'POST', body });
  if (res.success && res.data.success) {
    resultEl.innerHTML = `<span style="color:var(--accent-green);">连接成功</span>`;
  } else {
    resultEl.innerHTML = `<span style="color:var(--accent-red);">失败: ${res.data?.error || res.error || '未知'}</span>`;
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('aiApiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ============ 全局巡检进度监控 ============
let _scanProgressTimer = null;
let _scanFloatExpanded = true;

function toggleScanProgressFloat() {
  _scanFloatExpanded = !_scanFloatExpanded;
  const detail = document.getElementById('scanProgressDetail');
  const float = document.getElementById('scanProgressFloat');
  if (_scanFloatExpanded) {
    detail.style.display = '';
    float.style.width = '340px';
  } else {
    detail.style.display = 'none';
    float.style.width = 'auto';
  }
}

async function stopScan() {
  if (!confirm('确定停止当前巡检？')) return;
  const res = await api('/scan/stop', { method: 'POST' });
  if (res.success) {
    toast('巡检已停止', 'success');
    document.getElementById('scanProgressFloat').style.display = 'none';
    _lastProgressResultCount = 0;
    _lastListAutoRefreshAt = 0;
    if (_scanProgressTimer) { clearInterval(_scanProgressTimer); _scanProgressTimer = null; }
    // 5秒后重新开始监控（等待后端状态更新）
    setTimeout(() => startScanProgressMonitor(), 5000);
  } else {
    toast('停止失败: ' + (res.error || ''), 'error');
  }
}

function startScanProgressMonitor() {
  // 每 3 秒检查一次巡检进度
  _scanProgressTimer = setInterval(checkScanProgress, 3000);
}

let _lastProgressResultCount = 0;
let _lastListAutoRefreshAt = 0;
let _listAutoRefreshing = false;

async function refreshActivePageByProgress() {
  const now = Date.now();
  // 限流，避免并发巡检时频繁重绘影响流畅度
  if (now - _lastListAutoRefreshAt < 2500 || _listAutoRefreshing) return;

  const activePageId = document.querySelector('.page.active')?.id;
  if (!activePageId) return;

  _lastListAutoRefreshAt = now;
  _listAutoRefreshing = true;

  try {
    if (activePageId === 'page-platform' && currentDept && currentPlatform) {
      await refreshAllSites();
      showPlatform(currentDept, currentPlatform, { skipSave: true, keepScroll: true });
      return;
    }

    if (activePageId === 'page-department' && currentDept) {
      await refreshAllSites();
      showDepartment(currentDept, { skipSave: true, keepScroll: true });
      return;
    }

    if (activePageId === 'page-detail' && currentSiteId) {
      showSiteDetail(currentSiteId, { skipSave: true });
      return;
    }

    if (activePageId === 'page-dashboard') {
      await loadDashboard();
      return;
    }

    if (activePageId === 'page-sites') {
      await loadSitesManagement();
      return;
    }
  } finally {
    _listAutoRefreshing = false;
  }
}

async function checkScanProgress() {
  try {
    const res = await api('/scan/progress');
    if (!res.success) return;

    const progress = res.data;
    const floatEl = document.getElementById('scanProgressFloat');

    if (!progress || (!progress.scanning && progress.completed === progress.total && progress.total > 0)) {
      // 刚完成
      if (floatEl.style.display !== 'none' && progress) {
        renderScanProgress(progress);
        // 巡检完成，刷新当前页面数据
        _lastListAutoRefreshAt = 0;
        refreshActivePageByProgress();
        setTimeout(() => {
          floatEl.style.display = 'none';
          _lastProgressResultCount = 0;
          _lastListAutoRefreshAt = 0;
        }, 5000);
      } else if (!progress) {
        floatEl.style.display = 'none';
        _lastProgressResultCount = 0;
        _lastListAutoRefreshAt = 0;
      }
      return;
    }

    if (!progress.scanning) {
      floatEl.style.display = 'none';
      _lastProgressResultCount = 0;
      _lastListAutoRefreshAt = 0;
      return;
    }

    // 有巡检在跑
    floatEl.style.display = '';
    floatEl.style.width = _scanFloatExpanded ? '340px' : 'auto';
    renderScanProgress(progress);

    const resultCount = Array.isArray(progress.results) ? progress.results.length : 0;
    if (resultCount < _lastProgressResultCount) {
      _lastProgressResultCount = 0;
    }

    if (resultCount > _lastProgressResultCount) {
      const newResults = progress.results.slice(_lastProgressResultCount, resultCount);

      // 列表页跟随巡检进度刷新（带限流）
      refreshActivePageByProgress();

      // 当前详情页命中站点时，立即刷新详情
      if (currentSiteId) {
        const hasCurrentSiteResult = newResults.some(r => r.siteId === currentSiteId);
        if (hasCurrentSiteResult) {
          showSiteDetail(currentSiteId, { skipSave: true });
        }
      }
    }

    _lastProgressResultCount = resultCount;
  } catch (e) {}
}

function renderScanProgress(p) {
  const pct = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;
  const elapsed = p.elapsed ? Math.round(p.elapsed / 1000) : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  const isDone = p.completed === p.total && !p.scanning;
  const dot = document.getElementById('scanProgressDot');
  if (isDone) {
    dot.style.background = 'var(--accent-green)';
    dot.style.animation = 'none';
  } else {
    dot.style.background = 'var(--accent-cyan)';
    dot.style.animation = 'statusBlink 1.5s infinite';
  }

  const queueText = p.queueSize > 0 ? ` · 队列 ${p.queueSize}` : '';
  document.getElementById('scanProgressTitle').textContent = isDone ? '巡检完成' : '巡检中';
  document.getElementById('scanProgressCount').textContent = `${p.completed}/${p.total} · ${mins}m${secs}s${queueText}`;
  document.getElementById('scanProgressBar').style.width = pct + '%';

  // 当前正在扫描的站点
  const currentEl = document.getElementById('scanProgressCurrent');
  if (p.current && p.scanning) {
    currentEl.innerHTML = `<span style="color:var(--accent-cyan);">&#9654;</span> ${p.current.name}`;
  } else if (isDone) {
    const ok = p.results.filter(r => r.status === 'completed').length;
    const fail = p.results.filter(r => r.status === 'failed').length;
    currentEl.innerHTML = `<span style="color:var(--accent-green);">&#10003;</span> 完成 ${ok} 个，失败 ${fail} 个`;
  } else {
    currentEl.innerHTML = '';
  }

  // 已完成列表
  const listEl = document.getElementById('scanProgressList');
  if (p.results && p.results.length > 0) {
    // 最新的在上面
    listEl.innerHTML = [...p.results].reverse().map(r => {
      const icon = r.status === 'completed' ? `<span style="color:var(--accent-green);">&#10003;</span>`
        : r.status === 'partial' ? `<span style="color:var(--accent-yellow);">&#9888;</span>`
        : `<span style="color:var(--accent-red);">&#10007;</span>`;
      const score = r.score != null ? `<span style="font-family:'JetBrains Mono',monospace; font-weight:600; color:${scoreColor(r.score)};">${r.score}</span>` : '<span style="color:var(--text-muted);">--</span>';
      return `<div style="padding:0.25rem 0.875rem; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:0.375rem; min-width:0; overflow:hidden;">
          ${icon}
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);">${r.name}</span>
        </div>
        ${score}
      </div>`;
    }).join('');
    listEl.scrollTop = 0;
  }
}

// ============ 定时任务 Tab 切换 ============
function switchSchedulerDept(dept, btn) {
  btn.parentElement.querySelectorAll('.btn').forEach(b => { b.classList.remove('btn-primary'); });
  btn.classList.add('btn-primary');
  document.querySelectorAll('.scheduler-dept-panel').forEach(p => {
    p.style.display = p.dataset.dept === dept ? '' : 'none';
  });
}

function switchSchedulerPlat(dept, plat, btn) {
  btn.parentElement.querySelectorAll('.btn').forEach(b => { b.classList.remove('btn-primary'); });
  btn.classList.add('btn-primary');
  document.querySelectorAll(`.scheduler-plat-panel[data-dept="${dept}"]`).forEach(p => {
    p.style.display = p.dataset.plat === plat ? '' : 'none';
  });
}

// ============ Token 用量 ============
async function loadTokenUsage() {
  const res = await api('/ai/token-usage/summary');
  if (res.success) {
    const d = res.data;
    const fmt = n => n > 10000 ? (n / 1000).toFixed(1) + 'K' : n.toLocaleString();
    document.getElementById('tokenToday').textContent = fmt((d.today?.input_tokens || 0) + (d.today?.output_tokens || 0));
    document.getElementById('tokenWeek').textContent = fmt((d.week?.input_tokens || 0) + (d.week?.output_tokens || 0));
    document.getElementById('tokenMonth').textContent = fmt((d.month?.input_tokens || 0) + (d.month?.output_tokens || 0));
    document.getElementById('costToday').textContent = '$' + (d.cost?.today || 0).toFixed(4);
    document.getElementById('costWeek').textContent = '$' + (d.cost?.week || 0).toFixed(4);
    document.getElementById('costMonth').textContent = '$' + (d.cost?.month || 0).toFixed(4);
  }
  loadTokenUsageDetail();
}

async function loadTokenUsageDetail() {
  const period = document.getElementById('tokenPeriod').value;
  const res = await api(`/ai/token-usage/detail?period=${period}&limit=30`);
  const tbody = document.getElementById('tokenDetailBody');
  if (!res.success || !res.data || res.data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem;">暂无用量数据</td></tr>';
    return;
  }
  tbody.innerHTML = res.data.map(r => {
    const total = r.input_tokens + r.output_tokens;
    const costStr = r.cost !== null ? '$' + r.cost.toFixed(4) : '-';
    return `<tr>
      <td style="font-family:'JetBrains Mono',monospace; font-size:0.8125rem;">${r.label}</td>
      <td style="font-size:0.8125rem;">${r.model}</td>
      <td style="text-align:center;">${r.calls}</td>
      <td style="font-family:'JetBrains Mono',monospace; color:var(--accent-cyan);">${r.input_tokens.toLocaleString()}</td>
      <td style="font-family:'JetBrains Mono',monospace; color:var(--accent-blue);">${r.output_tokens.toLocaleString()}</td>
      <td style="font-family:'JetBrains Mono',monospace; font-weight:600;">${total.toLocaleString()}</td>
      <td style="font-family:'JetBrains Mono',monospace; color:var(--accent-green);">${costStr}</td>
    </tr>`;
  }).join('');
}

// ============ 报告推送 ============
async function loadReportConfig() {
  const res = await api('/report/config');
  if (!res.success) return;

  const configs = res.data || [];
  const dailyCfg = configs.find(c => c.type === 'daily');
  const weeklyCfg = configs.find(c => c.type === 'weekly');

  if (dailyCfg) {
    document.getElementById('reportDailyEnabled').checked = !!dailyCfg.enabled;
    const dailyCronSelect = document.getElementById('reportDailyCron');
    dailyCronSelect.value = dailyCfg.cron || '0 9 * * *';
    if (dailyCronSelect.value !== dailyCfg.cron && dailyCfg.cron) {
      const opt = document.createElement('option');
      opt.value = dailyCfg.cron;
      opt.textContent = dailyCfg.cron + ' (自定义)';
      opt.selected = true;
      dailyCronSelect.appendChild(opt);
    }
    if (dailyCfg.webhook_type) {
      document.getElementById('reportWebhookType').value = dailyCfg.webhook_type;
    }
    if (dailyCfg.webhook_url) {
      document.getElementById('reportWebhookUrl').value = dailyCfg.webhook_url;
    }
  }

  if (weeklyCfg) {
    document.getElementById('reportWeeklyEnabled').checked = !!weeklyCfg.enabled;
    const weeklyCronSelect = document.getElementById('reportWeeklyCron');
    weeklyCronSelect.value = weeklyCfg.cron || '0 9 * * 1';
    if (weeklyCronSelect.value !== weeklyCfg.cron && weeklyCfg.cron) {
      const opt = document.createElement('option');
      opt.value = weeklyCfg.cron;
      opt.textContent = weeklyCfg.cron + ' (自定义)';
      opt.selected = true;
      weeklyCronSelect.appendChild(opt);
    }
    // 如果 webhook 配置还没填，用周报的
    if (weeklyCfg.webhook_type && !document.getElementById('reportWebhookUrl').value) {
      document.getElementById('reportWebhookType').value = weeklyCfg.webhook_type;
    }
    if (weeklyCfg.webhook_url && !document.getElementById('reportWebhookUrl').value) {
      document.getElementById('reportWebhookUrl').value = weeklyCfg.webhook_url;
    }
  }
}

async function saveReportConfig() {
  const webhookType = document.getElementById('reportWebhookType').value;
  const webhookUrl = document.getElementById('reportWebhookUrl').value.trim();

  const configs = [
    {
      type: 'daily',
      enabled: document.getElementById('reportDailyEnabled').checked,
      cron: document.getElementById('reportDailyCron').value,
      webhook_type: webhookType,
      webhook_url: webhookUrl
    },
    {
      type: 'weekly',
      enabled: document.getElementById('reportWeeklyEnabled').checked,
      cron: document.getElementById('reportWeeklyCron').value,
      webhook_type: webhookType,
      webhook_url: webhookUrl
    }
  ];

  const res = await api('/report/config', { method: 'PUT', body: { configs } });
  if (res.success) {
    toast('报告推送配置已保存', 'success');
  } else {
    toast('保存失败: ' + (res.error || '未知错误'), 'error');
  }
}

async function previewReport(type) {
  toast('正在生成报告预览...', 'info');
  const res = await api('/report/preview', { method: 'POST', body: { type } });
  if (!res.success) {
    toast('生成预览失败: ' + (res.error || ''), 'error');
    return;
  }

  const content = res.data.content;
  document.getElementById('reportPreviewTitle').textContent = type === 'weekly' ? '周报预览' : '日报预览';
  document.getElementById('reportPreviewContent').innerHTML = renderMarkdown(content);
  showModal('reportPreviewModal');
}

async function manualPushReport(type) {
  const webhookType = document.getElementById('reportWebhookType').value;
  const webhookUrl = document.getElementById('reportWebhookUrl').value.trim();

  if (!webhookUrl) {
    toast('请先填写 Webhook 地址', 'error');
    return;
  }

  const typeName = type === 'weekly' ? '周报' : '日报';
  if (!confirm(`确定立即推送${typeName}到${webhookType === 'feishu' ? '飞书' : '钉钉'}吗？`)) return;

  toast(`正在推送${typeName}...`, 'info');
  const res = await api('/report/push', {
    method: 'POST',
    body: { type, webhook_type: webhookType, webhook_url: webhookUrl }
  });

  if (res.success && res.data && res.data.success) {
    toast(`${typeName}推送成功`, 'success');
  } else {
    toast(`${typeName}推送失败: ${res.error || res.data?.error || '未知错误'}`, 'error');
  }

  loadReportLogs();
}

async function loadReportLogs() {
  const res = await api('/report/logs?limit=20');
  const tbody = document.getElementById('reportLogBody');
  if (!tbody) return;

  if (!res.success || !res.data || res.data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:2rem;">暂无推送记录</td></tr>';
    return;
  }

  tbody.innerHTML = res.data.map(log => {
    const statusColor = log.status === 'success' ? 'var(--accent-green)' : 'var(--accent-red)';
    const statusText = log.status === 'success' ? '成功' : '失败';
    const typeText = log.report_type === 'weekly' ? '周报' : '日报';
    return `<tr>
      <td style="white-space:nowrap;">${log.created_at || '--'}</td>
      <td>${typeText}</td>
      <td><span style="color:${statusColor}; font-weight:600;">${statusText}</span></td>
      <td style="color:var(--text-secondary); font-size:0.8125rem;">${log.detail || '--'}</td>
    </tr>`;
  }).join('');
}

/**
 * 简易 Markdown 渲染（用于报告预览）
 */
function renderMarkdown(md) {
  let html = md;

  // 转义 HTML
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 标题
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 分隔线
  html = html.replace(/^---$/gm, '<hr>');

  // 粗体和斜体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 表格处理
  html = html.replace(/^(\|.+\|)\n(\|[\s\-:|]+\|)\n((?:\|.+\|\n?)*)/gm, function(match, header, separator, bodyBlock) {
    const headerCells = header.split('|').filter(c => c.trim() !== '').map(c => `<th>${c.trim()}</th>`).join('');
    const rows = bodyBlock.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim() !== '').map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // 段落（将连续的非标签行包裹成 <p>）
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');

  // 清理多余换行
  html = html.replace(/\n{2,}/g, '\n');

  return html;
}

// ============ Actions ============
async function addSite() {
  const platform_name = document.getElementById('siteFormPlatformNew').value.trim() || document.getElementById('siteFormPlatform').value.trim();
  const name = document.getElementById('siteFormName').value.trim();
  const url = document.getElementById('siteFormUrl').value.trim();
  const group_name = document.getElementById('siteFormGroupNew').value.trim() || document.getElementById('siteFormGroup').value.trim();
  const login_required = document.getElementById('siteFormLogin').checked;

  if (!group_name) return toast('请选择或新增部门', 'error');
  if (!platform_name) return toast('请选择或新增平台名称', 'error');
  if (!name || !url) return toast('页面名称和URL为必填项', 'error');

  const body = { name, platform_name, url, group_name, login_required };
  if (login_required) {
    body.login_url = document.getElementById('siteFormLoginUrl').value;
    body.login_user = document.getElementById('siteFormLoginUser').value;
    body.login_pass = document.getElementById('siteFormLoginPass').value;
  }

  const res = await api('/sites', { method: 'POST', body });
  if (res.success) {
    toast('站点添加成功', 'success');
    closeModal('addSiteModal');
    // 清空表单
    ['siteFormPlatformNew', 'siteFormName', 'siteFormUrl', 'siteFormGroupNew', 'siteFormLoginUrl', 'siteFormLoginUser', 'siteFormLoginPass'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('siteFormLogin').checked = false;
    document.getElementById('loginFields').style.display = 'none';
    loadDashboard();
  } else {
    toast('失败: ' + (res.error || '未知错误'), 'error');
  }
}

async function addGroup() {
  const name = document.getElementById('groupFormName').value.trim();
  if (!name) return toast('部门名称为必填项', 'error');

  const res = await api('/departments', { method: 'POST', body: { name } });
  if (res.success) {
    toast(`部门 "${name}" 已创建`, 'success');
    closeModal('addGroupModal');
    document.getElementById('groupFormName').value = '';
    loadDashboard();
  } else {
    toast('创建失败: ' + (res.error || ''), 'error');
  }
}

async function scanSite(siteId) {
  const res = await api(`/scan/${siteId}`, { method: 'POST' });
  if (!res.success) {
    toast(res.error || '巡检启动失败', 'error');
    return;
  }
  toast(res.message || (res.queued ? '已加入巡检队列' : '巡检已启动'), 'info');
  setTimeout(checkScanProgress, 300);
}

async function scanAllSites() {
  const res = await api('/scan-all', { method: 'POST' });
  if (!res.success) {
    toast(res.error || '启动失败', 'error');
    return;
  }
  toast(res.message || `已启动 ${res.count || ''} 个页面的巡检`, 'info');
  setTimeout(checkScanProgress, 300);
}

function togglePlatformSelectAll(checked) {
  document.querySelectorAll('#platPageList .platform-site-check').forEach(el => {
    el.checked = checked;
  });
}

async function deleteSelectedPlatformSites() {
  const selected = Array.from(document.querySelectorAll('#platPageList .platform-site-check:checked'));
  if (selected.length === 0) {
    toast('请先选择要删除的页面', 'warning');
    return;
  }

  if (!confirm(`确定批量删除 ${selected.length} 个页面吗？`)) return;

  let ok = 0;
  let fail = 0;

  for (const el of selected) {
    const id = el.dataset.id;
    const res = await api(`/sites/${id}`, { method: 'DELETE' });
    if (res.success) ok++;
    else fail++;
  }

  if (ok > 0) toast(`已删除 ${ok} 个页面${fail > 0 ? `，失败 ${fail} 个` : ''}`, fail > 0 ? 'warning' : 'success');
  else toast('批量删除失败', 'error');

  await refreshAllSites();
  if (currentPlatform && currentDept) {
    showPlatform(currentDept, currentPlatform, { skipSave: true, keepScroll: true });
  }
}

async function deleteSiteFromPlatform(id, name) {
  if (!confirm(`确定删除页面 "${name}" 吗？`)) return;
  const res = await api(`/sites/${id}`, { method: 'DELETE' });
  if (res.success) {
    toast('页面已删除', 'success');
    // 刷新 allSites 数据再重新渲染当前平台页
    const sitesRes = await api('/dashboard');
    if (sitesRes.success) allSites = sitesRes.data.siteScores || [];
    if (currentPlatform && currentDept) {
      showPlatform(currentDept, currentPlatform);
    }
  }
}

async function deleteCurrentSite() {
  if (!currentSiteId) return;
  const res = await api(`/sites/${currentSiteId}`);
  if (!res.success) return;
  const site = res.data;
  if (!confirm(`确定删除页面 "${site.platform_name} - ${site.name}" 吗？`)) return;
  const delRes = await api(`/sites/${currentSiteId}`, { method: 'DELETE' });
  if (delRes.success) {
    toast('页面已删除', 'success');
    // 返回上一级
    if (currentPlatform && currentDept) {
      showPlatform(currentDept, currentPlatform);
    } else if (currentDept) {
      showDepartment(currentDept);
    } else {
      showPage('dashboard');
    }
  }
}

async function scanCurrentSite() {
  if (!currentSiteId) return;
  await scanSite(currentSiteId);
}

async function loadAiStatus() {
  const res = await api('/ai/status');
  if (res.success) {
    aiEnabled = res.data.enabled;
    // 更新 AI 分析按钮状态
    const btn = document.getElementById('btnAiAnalyze');
    if (btn) {
      if (aiEnabled) {
        btn.disabled = false;
        btn.title = `AI 分析 (${res.data.provider}/${res.data.model})`;
        btn.style.opacity = '';
      } else {
        btn.disabled = true;
        btn.title = '未启用 AI 模型，请在设置中配置';
        btn.style.opacity = '0.5';
      }
    }
  }
}

async function analyzeCurrentSite() {
  if (!currentSiteId) return;
  if (!aiEnabled) {
    toast('AI 分析未启用，请在设置页面添加并启用一个 AI 模型', 'error');
    return;
  }

  const btn = document.getElementById('btnAiAnalyze');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; btn.textContent = 'AI 分析中...'; }

  try {
    const res = await api(`/sites/${currentSiteId}/analyze`, { method: 'POST' });
    if (res.success) {
      toast('AI 分析完成', 'success');
      renderAiReport(res.data);
    } else {
      toast('分析失败: ' + (res.error || ''), 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = origText; }
  }
}

async function showEditSiteModal(siteId) {
  const res = await api(`/sites/${siteId}`);
  if (!res.success) return;
  const site = res.data;

  document.getElementById('editSiteId').value = siteId;
  document.getElementById('editSitePlatform').value = site.platform_name || '';
  document.getElementById('editSiteName').value = site.name || '';
  document.getElementById('editSiteUrl').value = site.url || '';
  document.getElementById('editSiteEnabled').checked = !!site.enabled;

  // 填充部门下拉
  const deptRes = await api('/departments');
  const dbDepts = deptRes.success ? deptRes.data.map(d => d.name) : [];
  const siteDepts = [...new Set(allSites.map(s => s.group_name))].filter(Boolean);
  const groups = [...new Set([...dbDepts, ...siteDepts])];
  const groupSelect = document.getElementById('editSiteGroup');
  groupSelect.innerHTML = groups.map(g => `<option value="${g}" ${g === site.group_name ? 'selected' : ''}>${g}</option>`).join('');

  showModal('editSiteModal');
}

async function saveEditSite() {
  const id = document.getElementById('editSiteId').value;
  const body = {
    name: document.getElementById('editSiteName').value.trim(),
    platform_name: document.getElementById('editSitePlatform').value.trim(),
    url: document.getElementById('editSiteUrl').value.trim(),
    group_name: document.getElementById('editSiteGroup').value,
    enabled: document.getElementById('editSiteEnabled').checked
  };

  if (!body.name || !body.url) return toast('页面名称和URL为必填项', 'error');

  const res = await api(`/sites/${id}`, { method: 'PUT', body });
  if (res.success) {
    toast('站点修改成功', 'success');
    closeModal('editSiteModal');
    loadSitesManagement();
  } else {
    toast('修改失败: ' + (res.error || ''), 'error');
  }
}

function showAlertSitesModal(groupName) {
  const sites = allSites.filter(s => (s.group_name || '默认分组') === groupName && s.score_performance != null && s.score_performance < 60);
  if (!sites.length) return toast('暂无需关注的页面', 'info');

  const tbody = sites.sort((a, b) => (a.score_performance ?? 99) - (b.score_performance ?? 99)).map(s => `
    <tr>
      <td style="font-weight:600; max-width:12rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.name}</td>
      <td><span style="font-weight:700; color:${scoreColor(s.score_performance)}; font-family:'JetBrains Mono',monospace;">${s.score_performance ?? '--'}</span></td>
      <td style="font-size:0.75rem; color:var(--text-muted); max-width:14rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.url}</td>
      <td><button class="btn btn-sm" onclick="closeModal('alertSitesModal'); showSiteDetail('${s.id}')">详情</button></td>
    </tr>
  `).join('');

  document.getElementById('alertSitesTitle').textContent = `${groupName} - 需关注页面（${sites.length}个）`;
  document.getElementById('alertSitesBody').innerHTML = tbody;
  showModal('alertSitesModal');
}

function showDomainReplaceModal(groupName, platformName) {
  document.getElementById('domainReplaceDept').value = groupName;
  document.getElementById('domainReplacePlat').value = platformName;
  document.getElementById('domainReplaceNew').value = '';
  // 自动检测当前域名
  const sites = allSites.filter(s => (s.group_name || '默认分组') === groupName && s.platform_name === platformName);
  const domains = new Set();
  sites.forEach(s => { try { domains.add(new URL(s.url).hostname); } catch(e) {} });
  const domainList = [...domains];
  const oldDomain = domainList[0] || '';
  document.getElementById('domainReplaceOld').value = oldDomain;
  document.getElementById('domainReplaceInfo').textContent = `将替换 ${sites.length} 个页面的域名${domainList.length > 1 ? `（检测到 ${domainList.length} 个不同域名：${domainList.join(', ')}）` : ''}`;
  showModal('domainReplaceModal');
}

async function saveDomainReplace() {
  const group_name = document.getElementById('domainReplaceDept').value;
  const platform_name = document.getElementById('domainReplacePlat').value;
  const old_domain = document.getElementById('domainReplaceOld').value.trim();
  const new_domain = document.getElementById('domainReplaceNew').value.trim();
  if (!new_domain) return toast('请输入新域名', 'error');
  if (new_domain === old_domain) return toast('新旧域名相同', 'error');
  if (!confirm(`确认将 ${old_domain} 替换为 ${new_domain}？`)) return;
  const res = await api('/platforms/domain', {
    method: 'PUT',
    body: { group_name, platform_name, old_domain, new_domain }
  });
  if (res.success) {
    toast(`已替换 ${res.data.updated}/${res.data.total} 个页面的域名`, 'success');
    closeModal('domainReplaceModal');
    // 刷新本地数据
    allSites.forEach(s => {
      if ((s.group_name || '默认分组') === group_name && s.platform_name === platform_name) {
        try {
          const u = new URL(s.url);
          if (!old_domain || u.hostname === old_domain) { u.hostname = new_domain; s.url = u.toString(); }
        } catch(e) {}
      }
    });
    loadSitesManagement();
  } else {
    toast('替换失败: ' + (res.error || ''), 'error');
  }
}

function showEditProjectCronModal(groupName, platformName) {
  document.getElementById('projectCronDept').value = groupName;
  document.getElementById('projectCronPlat').value = platformName;
  // 找到该项目当前的 cron
  const site = allSites.find(s => (s.group_name || '默认分组') === groupName && s.platform_name === platformName);
  const currentCron = site?.scan_cron || '0 */6 * * *';
  const select = document.getElementById('projectCronSelect');
  select.value = currentCron;
  if (select.value !== currentCron) {
    const opt = document.createElement('option');
    opt.value = currentCron;
    opt.textContent = cronToText(currentCron);
    opt.selected = true;
    select.appendChild(opt);
  }
  showModal('projectCronModal');
}

async function saveProjectCron() {
  const group_name = document.getElementById('projectCronDept').value;
  const platform_name = document.getElementById('projectCronPlat').value;
  const scan_cron = document.getElementById('projectCronSelect').value;
  const res = await api('/platforms/cron', {
    method: 'PUT',
    body: { group_name, platform_name, scan_cron }
  });
  if (res.success) {
    toast(`项目巡检频率已更新为 ${cronToText(scan_cron)}`, 'success');
    closeModal('projectCronModal');
    // 更新本地缓存
    allSites.forEach(s => {
      if ((s.group_name || '默认分组') === group_name && s.platform_name === platform_name) {
        s.scan_cron = scan_cron;
      }
    });
    loadSitesManagement();
  } else {
    toast('更新失败: ' + (res.error || ''), 'error');
  }
}

async function deletePlatform(groupName, platformName) {
  if (!confirm(`确定删除平台 "${platformName}" 吗？该平台下的所有页面都将被删除！`)) return;
  const res = await api(`/platforms?group_name=${encodeURIComponent(groupName)}&platform_name=${encodeURIComponent(platformName)}`, { method: 'DELETE' });
  if (res.success) {
    toast(`平台 "${platformName}" 已删除（${res.data?.deleted || 0} 个页面）`, 'success');
    loadSitesManagement();
  } else {
    toast('删除失败: ' + (res.error || ''), 'error');
  }
}

async function deleteDepartment(id, name) {
  if (!confirm(`确定删除部门 "${name}" 吗？该部门下的站点将移至默认分组。`)) return;
  const res = await api(`/departments/${id}`, { method: 'DELETE' });
  if (res.success) {
    toast('部门已删除', 'success');
    loadSitesManagement();
    loadDashboard();
  }
}

async function deleteSite(id, name) {
  if (!confirm(`确定删除站点 "${name}" 吗？`)) return;
  const res = await api(`/sites/${id}`, { method: 'DELETE' });
  if (res.success) {
    toast('站点已删除', 'success');
    await refreshAllSites();
    loadSitesManagement();
  }
}

// 刷新全局站点数据
async function refreshAllSites() {
  const dashRes = await api('/dashboard');
  if (dashRes.success) {
    allSites = dashRes.data.siteScores || [];
  }
}

async function refreshScheduler() {
  const res = await api('/scheduler/refresh', { method: 'POST' });
  if (res.success) {
    toast('定时任务已刷新', 'success');
    loadSettings();
  }
}

// ============ 批量导入 ============
function showImportModal() {
  // 重置状态
  document.getElementById('csvTextArea').value = '';
  document.getElementById('csvFileName').textContent = '';
  document.getElementById('csvFileInput').value = '';
  document.getElementById('csvPreviewArea').style.display = 'none';
  document.getElementById('csvImportBtn').disabled = true;
  document.getElementById('csvImportResult').style.display = 'none';
  showModal('importSitesModal');

  // 初始化拖拽
  const dropZone = document.getElementById('csvDropZone');
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent-cyan)'; dropZone.style.background = 'rgba(34,211,238,0.05)'; };
  dropZone.ondragleave = () => { dropZone.style.borderColor = 'var(--border)'; dropZone.style.background = ''; };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      readCsvFile(file);
    } else {
      toast('请上传 .csv 格式的文件', 'error');
    }
  };
}

function handleCsvFile(event) {
  const file = event.target.files[0];
  if (file) readCsvFile(file);
}

function readCsvFile(file) {
  document.getElementById('csvFileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('csvTextArea').value = e.target.result;
    previewCsvImport();
  };
  reader.readAsText(file, 'UTF-8');
}

function downloadCsvTemplate() {
  const template = '部门,平台名称,页面名称,URL\n无极,黑料网,首页,https://heiliao.com/\n无极,每日大赛,首页,https://www.mrds66.com/\n';
  const blob = new Blob(['\uFEFF' + template], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '站点导入模板.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseCsvContent(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(',').map(s => s.trim());

    // 跳过表头行
    if (i === 0 && (parts[0] === '部门' || parts[0].toLowerCase() === 'department')) continue;

    const [group_name, platform_name, name, url, ...cronParts] = parts;
    const scan_cron = cronParts.join(',').trim() || '0 */6 * * *';

    let status = 'ok';
    let reason = '';
    if (!group_name || !platform_name || !name || !url) {
      status = 'error';
      reason = '必填字段不能为空';
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      status = 'error';
      reason = 'URL 格式不正确';
    }

    rows.push({ line: i + 1, group_name, platform_name, name, url, scan_cron, status, reason });
  }
  return rows;
}

let _csvParsedRows = [];

function previewCsvImport() {
  const text = document.getElementById('csvTextArea').value.trim();
  if (!text) {
    toast('请先上传文件或粘贴 CSV 内容', 'error');
    return;
  }

  _csvParsedRows = parseCsvContent(text);
  if (_csvParsedRows.length === 0) {
    toast('未解析到有效数据', 'error');
    return;
  }

  document.getElementById('csvPreviewCount').textContent = _csvParsedRows.length;
  const tbody = document.getElementById('csvPreviewBody');
  tbody.innerHTML = _csvParsedRows.map(r => {
    const isErr = r.status === 'error';
    const rowStyle = isErr ? 'background:rgba(239,68,68,0.08);' : '';
    return `<tr style="${rowStyle}">
      <td>${r.line}</td>
      <td>${r.group_name || '--'}</td>
      <td>${r.platform_name || '--'}</td>
      <td>${r.name || '--'}</td>
      <td style="font-size:0.75rem; max-width:15rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.url || '--'}</td>
      <td style="font-family:'JetBrains Mono',monospace; font-size:0.75rem;">${r.scan_cron}</td>
      <td>${isErr ? '<span style="color:var(--accent-red);">' + r.reason + '</span>' : '<span style="color:var(--accent-green);">就绪</span>'}</td>
    </tr>`;
  }).join('');

  document.getElementById('csvPreviewArea').style.display = 'block';

  const validCount = _csvParsedRows.filter(r => r.status === 'ok').length;
  document.getElementById('csvImportBtn').disabled = validCount === 0;
  document.getElementById('csvImportBtn').textContent = `导入站点（${validCount} 个有效）`;
}

async function executeCsvImport() {
  const csvText = document.getElementById('csvTextArea').value.trim();
  if (!csvText) return toast('无内容可导入', 'error');

  document.getElementById('csvImportBtn').disabled = true;
  document.getElementById('csvImportBtn').textContent = '导入中...';

  const res = await api('/sites/import', { method: 'POST', body: { csv: csvText } });

  const resultDiv = document.getElementById('csvImportResult');
  resultDiv.style.display = 'block';

  if (res.success) {
    const d = res.data;
    let html = `<div style="padding:0.75rem 1rem; border-radius:0.5rem; border:1px solid var(--border); background:var(--card-bg);">`;
    html += `<div style="font-weight:600; margin-bottom:0.5rem;">导入完成</div>`;
    html += `<div style="color:var(--accent-green); font-size:0.875rem;">成功：${d.success} 个</div>`;
    if (d.failed > 0) {
      html += `<div style="color:var(--accent-red); font-size:0.875rem; margin-top:0.25rem;">失败：${d.failed} 个</div>`;
      html += `<div style="margin-top:0.5rem; font-size:0.8125rem;">`;
      d.errors.forEach(e => {
        html += `<div style="color:var(--accent-red); margin-bottom:0.25rem;">第 ${e.line} 行：${e.reason}</div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
    resultDiv.innerHTML = html;

    if (d.success > 0) {
      toast(`成功导入 ${d.success} 个站点`, 'success');
      // 刷新站点列表
      loadSitesManagement();
      loadDashboard();
    }
  } else {
    resultDiv.innerHTML = `<div style="color:var(--accent-red);">导入失败：${res.error || '未知错误'}</div>`;
    toast('导入失败', 'error');
  }

  document.getElementById('csvImportBtn').disabled = false;
  document.getElementById('csvImportBtn').textContent = '导入站点';
}

// ============ 工具函数 ============
function getScoreStyle(score) {
  if (score === null || score === undefined || score === -1) return 'background:rgba(100,116,139,0.1); color:var(--text-muted);';
  if (score >= 90) return 'background:rgba(16,185,129,0.15); color:var(--accent-green);';
  if (score >= 50) return 'background:rgba(245,158,11,0.15); color:var(--accent-yellow);';
  return 'background:rgba(239,68,68,0.15); color:var(--accent-red);';
}

function formatScore(score) {
  if (score === null || score === undefined || score === -1) return '<span title="性能指标采集失败：页面可能渲染超时或存在反爬机制" style="cursor:help;">采集失败 ⚠</span>';
  return score;
}

function getScoreClass(score) {
  if (score === null || score === undefined) return '';
  return score >= 90 ? 'good' : score >= 50 ? 'ok' : 'bad';
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const diff = target - start;
  if (diff === 0) { el.textContent = target; return; }

  const duration = 800;
  const startTime = performance.now();

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * ease);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ============ 站点自动发现 ============
let discoveredPages = [];

async function showDiscoverModal() {
  // 填充部门下拉
  const deptRes = await api('/departments');
  const dbDepts = deptRes.success ? deptRes.data.map(d => d.name) : [];
  const siteDepts = [...new Set(allSites.map(s => s.group_name))].filter(Boolean);
  const groups = [...new Set([...dbDepts, ...siteDepts])];

  const groupSelect = document.getElementById('discoverGroup');
  groupSelect.innerHTML = '<option value="">-- 请选择部门 --</option>' +
    groups.map(g => `<option value="${g}">${g}</option>`).join('');

  // 重置状态
  document.getElementById('discoverUrl').value = '';
  document.getElementById('discoverGroupNew').value = '';
  document.getElementById('discoverPlatform').value = '';
  document.getElementById('discoverLoading').style.display = 'none';
  document.getElementById('discoverResults').style.display = 'none';
  document.getElementById('discoverStartBtn').disabled = false;
  discoveredPages = [];

  showModal('discoverModal');
}

let _discoverRunning = false;
async function startDiscover() {
  if (_discoverRunning) return;

  const url = document.getElementById('discoverUrl').value.trim();
  if (!url) {
    toast('请输入入口 URL', 'error');
    return;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    toast('URL 需以 http:// 或 https:// 开头', 'error');
    return;
  }

  _discoverRunning = true;
  const startBtn = document.getElementById('discoverStartBtn');
  const loadingEl = document.getElementById('discoverLoading');
  const resultsEl = document.getElementById('discoverResults');

  // 禁用整个表单
  startBtn.disabled = true;
  startBtn.textContent = '扫描中，请稍候...';
  startBtn.style.opacity = '0.5';
  startBtn.style.pointerEvents = 'none';
  loadingEl.style.display = 'block';
  resultsEl.style.display = 'none';
  document.getElementById('discoverUrl').disabled = true;
  document.getElementById('discoverGroup').disabled = true;
  document.getElementById('discoverPlatform').disabled = true;
  // 禁用关闭按钮和点击遮罩关闭
  const closeBtn = document.querySelector('#discoverModal .modal-close');
  if (closeBtn) { closeBtn.style.display = 'none'; }
  const overlay = document.getElementById('discoverModal');
  overlay.onclick = function(e) { e.stopPropagation(); };

  const res = await api('/sites/discover', {
    method: 'POST',
    body: { url, depth: 2, maxPages: 50 }
  });

  // 恢复表单
  _discoverRunning = false;
  loadingEl.style.display = 'none';
  startBtn.disabled = false;
  startBtn.textContent = '开始扫描';
  startBtn.style.opacity = '';
  startBtn.style.pointerEvents = '';
  document.getElementById('discoverUrl').disabled = false;
  document.getElementById('discoverGroup').disabled = false;
  document.getElementById('discoverPlatform').disabled = false;
  if (closeBtn) { closeBtn.style.display = ''; }
  overlay.onclick = null;

  if (!res.success) {
    toast('扫描失败: ' + (res.error || '未知错误'), 'error');
    return;
  }

  discoveredPages = res.data || [];
  document.getElementById('discoverCount').textContent = discoveredPages.length;

  if (discoveredPages.length === 0) {
    toast('未发现任何页面', 'warning');
    return;
  }

  // 渲染结果表格
  const tbody = document.getElementById('discoverTableBody');
  tbody.innerHTML = discoveredPages.map((page, idx) => {
    const similarTag = page.similar_count > 1
      ? `<span style="font-size:0.625rem; padding:0.0625rem 0.375rem; background:rgba(168,85,247,0.15); color:var(--accent-purple); border-radius:0.25rem; margin-left:0.375rem;" title="路由模式: ${escapeHtml(page.route_pattern || '')}，共发现 ${page.similar_count} 个同类页面，已随机选取1个作为代表">同类${page.similar_count}个·抽样1个</span>`
      : '';
    return `
      <tr>
        <td><input type="checkbox" class="discover-check" data-index="${idx}" checked></td>
        <td style="font-weight:600; max-width:16rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(page.title)}">${escapeHtml(page.name)}${similarTag}</td>
        <td style="font-size:0.75rem; color:var(--text-muted); font-family:'JetBrains Mono',monospace;">${escapeHtml(page.path)}</td>
        <td style="font-size:0.75rem; color:var(--text-muted); max-width:18rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(page.url)}">${escapeHtml(page.url)}</td>
      </tr>`;
  }).join('');

  document.getElementById('discoverSelectAll').checked = true;
  resultsEl.style.display = 'block';
  toast(`发现 ${discoveredPages.length} 个页面`, 'success');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toggleDiscoverSelectAll() {
  const checkbox = document.getElementById('discoverSelectAll');
  checkbox.checked = !checkbox.checked;
  toggleDiscoverCheckboxes(checkbox.checked);
}

function toggleDiscoverCheckboxes(checked) {
  document.querySelectorAll('.discover-check').forEach(cb => cb.checked = checked);
  document.getElementById('discoverSelectAll').checked = checked;
}

async function addDiscoveredSites() {
  const groupSelect = document.getElementById('discoverGroup');
  const groupNew = document.getElementById('discoverGroupNew').value.trim();
  const group_name = groupNew || groupSelect.value;
  const platform_name = document.getElementById('discoverPlatform').value.trim();

  if (!group_name) {
    toast('请选择或输入部门名称', 'error');
    return;
  }
  if (!platform_name) {
    toast('请输入平台名称', 'error');
    return;
  }

  // 收集选中的页面
  const checkedIndexes = [];
  document.querySelectorAll('.discover-check:checked').forEach(cb => {
    checkedIndexes.push(parseInt(cb.dataset.index));
  });

  if (checkedIndexes.length === 0) {
    toast('请至少选择一个页面', 'error');
    return;
  }

  const selectedSites = checkedIndexes.map(idx => discoveredPages[idx]);

  const addBtn = document.getElementById('discoverAddBtn');
  addBtn.disabled = true;
  addBtn.textContent = '添加中...';

  const res = await api('/sites/batch-add', {
    method: 'POST',
    body: { sites: selectedSites, group_name, platform_name }
  });

  addBtn.disabled = false;
  addBtn.textContent = '添加选中页面';

  if (!res.success) {
    toast('添加失败: ' + (res.error || '未知错误'), 'error');
    return;
  }

  const data = res.data;
  toast(`成功添加 ${data.success} 个站点${data.failed > 0 ? '，' + data.failed + ' 个失败' : ''}`, data.failed > 0 ? 'warning' : 'success');

  closeModal('discoverModal');

  // 刷新站点列表
  if (document.getElementById('page-sites').classList.contains('active')) {
    loadSitesManagement();
  } else {
    loadDashboard();
  }
}

// ============ 排行榜 ============
let rankingPageInited = false;

async function loadRankingPage() {
  // 初始化部门下拉
  if (!rankingPageInited) {
    const deptRes = await api('/departments');
    const select = document.getElementById('rankingDeptFilter');
    if (deptRes.success) {
      // 保留"全部"选项，追加部门
      deptRes.data.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = d.name;
        select.appendChild(opt);
      });
    }
    rankingPageInited = true;
  }
  loadRanking();
}

async function loadRanking() {
  const sort = document.getElementById('rankingSortField').value;
  const order = document.getElementById('rankingOrder').value;
  const department = document.getElementById('rankingDeptFilter').value;

  const res = await api(`/ranking?sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}&department=${encodeURIComponent(department)}`);
  if (!res.success) {
    document.getElementById('rankingList').innerHTML = '<div class="empty-state"><div class="empty-icon">!</div><div class="empty-text">加载失败</div></div>';
    return;
  }

  const { projects, summary } = res.data;
  _rankingProjectsCache = projects;
  renderRankingList(projects);
  renderRankingSummary(summary);
}

let _rankingProjectsCache = null;

function getRankingScoreColor(score) {
  if (score == null) return 'var(--text-muted)';
  if (score >= 80) return 'var(--accent-green)';
  if (score >= 60) return 'var(--accent-yellow)';
  return 'var(--accent-red)';
}

function getRankingChangeHtml(current, prev) {
  if (current == null || prev == null) return '<span class="ranking-change neutral">&#8212;</span>';
  const diff = current - prev;
  if (diff > 0) return `<span class="ranking-change up">&#9650; +${diff}</span>`;
  if (diff < 0) return `<span class="ranking-change down">&#9660; ${diff}</span>`;
  return '<span class="ranking-change neutral">&#8212;</span>';
}

function getRankBadge(rank) {
  if (rank === 1) return '<span class="rank-badge rank-gold">1</span>';
  if (rank === 2) return '<span class="rank-badge rank-silver">2</span>';
  if (rank === 3) return '<span class="rank-badge rank-bronze">3</span>';
  return `<span class="rank-badge rank-normal">${rank}</span>`;
}

function getRankCardClass(rank) {
  if (rank === 1) return 'ranking-card ranking-card-gold';
  if (rank === 2) return 'ranking-card ranking-card-silver';
  if (rank === 3) return 'ranking-card ranking-card-bronze';
  return 'ranking-card';
}

function renderRankingList(projects) {
  const container = document.getElementById('rankingList');
  if (!projects || projects.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127942;</div><div class="empty-text">暂无排行数据</div><div class="empty-hint">请先添加站点并执行巡检</div></div>';
    return;
  }

  let html = '';
  projects.forEach((proj, idx) => {
    const rank = idx + 1;
    const healthScore = proj.health_score != null ? proj.health_score : '--';
    const healthColor = getRankingScoreColor(proj.health_score);
    const changeHtml = getRankingChangeHtml(proj.health_score, proj.prev_health_score);

    const perfScore = proj.score_performance != null ? proj.score_performance : '--';
    const a11yScore = proj.score_accessibility != null ? proj.score_accessibility : '--';
    const bpScore = proj.score_best_practices != null ? proj.score_best_practices : '--';
    const seoScore = proj.score_seo != null ? proj.score_seo : '--';
    const secScore = proj.score_security != null ? proj.score_security : '--';

    const projKey = `${proj.department}|||${proj.platform}`;
    html += `
      <div class="${getRankCardClass(rank)}" style="cursor:pointer;" onclick="showProjectPages('${projKey.replace(/'/g, "\\'")}')">
        <div class="ranking-card-rank">
          ${getRankBadge(rank)}
        </div>
        <div class="ranking-card-info">
          <div class="ranking-card-name">${proj.platform}</div>
          <span class="ranking-card-dept">${proj.department}</span>
          <span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.5rem;">${proj.page_count} 个页面 · ${proj.scanned_count} 已巡检 · 达标率 ${proj.pass_rate}%</span>
        </div>
        <div class="ranking-card-health">
          <div class="ranking-card-health-score" style="color:${healthColor}">${healthScore}</div>
          <div class="ranking-card-health-label">健康度</div>
        </div>
        <div class="ranking-card-scores">
          <div class="ranking-mini-score"><span class="ranking-mini-label">性能</span><span class="ranking-mini-value" style="color:${getRankingScoreColor(proj.score_performance)}">${perfScore}</span></div>
          <div class="ranking-mini-score"><span class="ranking-mini-label">无障碍</span><span class="ranking-mini-value" style="color:${getRankingScoreColor(proj.score_accessibility)}">${a11yScore}</span></div>
          <div class="ranking-mini-score"><span class="ranking-mini-label">最佳实践</span><span class="ranking-mini-value" style="color:${getRankingScoreColor(proj.score_best_practices)}">${bpScore}</span></div>
          <div class="ranking-mini-score"><span class="ranking-mini-label">SEO</span><span class="ranking-mini-value" style="color:${getRankingScoreColor(proj.score_seo)}">${seoScore}</span></div>
          <div class="ranking-mini-score"><span class="ranking-mini-label">安全</span><span class="ranking-mini-value" style="color:${getRankingScoreColor(proj.score_security)}">${secScore}</span></div>
        </div>
        <div class="ranking-card-stability">
          <div class="ranking-stability-value">${proj.stability != null ? proj.stability + '%' : '--'}</div>
          <div class="ranking-stability-label">稳定性</div>
        </div>
        <div class="ranking-card-change">
          ${changeHtml}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderRankingSummary(summary) {
  const el = document.getElementById('rankingSummary');
  el.style.display = 'flex';
  document.getElementById('rankingSumTotal').textContent = summary.totalProjects;
  document.getElementById('rankingSumPages').textContent = summary.totalPages;
  document.getElementById('rankingSumAvgHealth').textContent = summary.avgHealth;
  document.getElementById('rankingSumPassRate').textContent = summary.passRate + '%';
}
