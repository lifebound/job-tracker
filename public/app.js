const API = '';
let allApps = [];
let alertDismissedAt = null;
let alertDismissedIds = null;
let lastAlertApps = [];
let currentFilter = 'all';
let currentSearch = '';
let currentSort = 'newest';
let editingId = null;
const collapsedCompanyGroups = new Set();
const mobileTableMediaQuery = window.matchMedia('(max-width: 760px)');

function normalizeCompanyKey(companyName) {
  return String(companyName || '').trim().toLowerCase();
}

function isMobileTableView() {
  return mobileTableMediaQuery.matches;
}

// ── Data ──────────────────────────────────────────────────────────
async function loadApplications() {
  try {
    const res = await fetch(`${API}/api/applications`);
    allApps = await res.json();
    renderTable();
    updateStats();
    updateCompanySuggestions();
  } catch (e) {
    document.getElementById('table-body').innerHTML =
      `<div class="loading loading-error">⚠ Could not reach server</div>`;
  }
}

async function checkAlerts() {
  console.log('[checkAlerts] fetching /api/applications/stale');
  try {
    const apps = await fetch(`${API}/api/applications/stale`).then(r => r.json());
    console.log(`[checkAlerts] response: ${apps.length} stale app(s)`, apps.map(a => ({ id: a.id, company: a.company, days: parseFloat(a.days_since_check).toFixed(1) })));

    if (apps.length === 0) {
      alertDismissedAt = null;
      alertDismissedIds = null;
      document.getElementById('alert-banner').classList.remove('visible');
      console.log('[checkAlerts] no stale apps — banner hidden, suppression cleared');
      return;
    }

    if (alertDismissedAt !== null) {
      const now = Date.now();
      const snoozeHours = Math.max(1, parseInt(document.getElementById('snooze-hours')?.value || '4', 10));
      const currentIds = new Set(apps.map(a => String(a.id)));
      const crossedMidnight = new Date(now).toDateString() !== new Date(alertDismissedAt).toDateString();
      const snoozeElapsed = (now - alertDismissedAt) >= snoozeHours * 60 * 60 * 1000;
      const hasNewApps = [...currentIds].some(id => !alertDismissedIds.has(id));
      console.log('[checkAlerts] suppressed — checking:', { crossedMidnight, snoozeElapsed, hasNewApps });
      if (!crossedMidnight && !snoozeElapsed && !hasNewApps) {
        console.log('[checkAlerts] staying suppressed');
        return;
      }
      console.log('[checkAlerts] suppression lifted');
      alertDismissedAt = null;
      alertDismissedIds = null;
    }

    console.log('[checkAlerts] showing alert banner');
    showAlertBanner({ count: apps.length, applications: apps });
  } catch (err) {
    console.error('[checkAlerts] fetch failed:', err);
  }
}

// ── Render ────────────────────────────────────────────────────────
function renderTable() {
  let apps = [...allApps];
  const closed = ['rejected', 'accepted', 'withdrawn', 'ghosted'];

  if (currentFilter === 'stale')  apps = apps.filter(a => a.is_stale && !closed.includes(a.status));
  else if (currentFilter === 'closed') apps = apps.filter(a => closed.includes(a.status));
  else if (currentFilter !== 'all') apps = apps.filter(a => a.status === currentFilter);

  if (currentSearch) {
    const s = currentSearch.toLowerCase();
    apps = apps.filter(a =>
      a.company.toLowerCase().includes(s) ||
      (a.role || '').toLowerCase().includes(s) ||
      (a.notes || '').toLowerCase().includes(s)
    );
  }

  apps.sort((a, b) => {
    const aTs = new Date(a.applied_at).getTime() || 0;
    const bTs = new Date(b.applied_at).getTime() || 0;
    return currentSort === 'oldest' ? aTs - bTs : bTs - aTs;
  });

  const container = document.getElementById('table-body');
  if (apps.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">No applications found</div>
        <div class="empty-sub">Log your first application above</div>
      </div>`;
    return;
  }

  const grouped = new Map();
  for (const app of apps) {
    const companyName = (app.company || '').trim() || 'Unknown Company';
    if (!grouped.has(companyName)) grouped.set(companyName, []);
    grouped.get(companyName).push(app);
  }

  const rows = Array.from(grouped.entries()).map(([companyName, companyApps]) => {
    const companyKey = normalizeCompanyKey(companyName);
    const isCollapsed = isMobileTableView() && collapsedCompanyGroups.has(companyKey);
    const appRows = companyApps.map(a => {
      const staleClass = a.is_stale && !['rejected','accepted','withdrawn','ghosted'].includes(a.status) ? 'stale' : '';
      const staleDot = staleClass ? '<span class="stale-dot"></span>' : '';
      const daysAgo = Math.round(parseFloat(a.days_since_check));
      const checkLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`;
      const checkClass = a.is_stale ? 'date-stale' : '';
      const isClosed = ['rejected', 'accepted', 'withdrawn', 'ghosted'].includes(a.status);
      const checkButton = isClosed
        ? '<span class="action-spacer" aria-hidden="true"></span>'
        : `<button class="btn-check" onclick="markChecked(${a.id})">✓ Checked</button>`;

      const safePortalUrl = /^https?:\/\//i.test(a.portal_url || '') ? a.portal_url : null;
      const portalCell = safePortalUrl
        ? `<a class="portal-link" href="${escHtml(safePortalUrl)}" target="_blank" rel="noopener">↗ ${domain(safePortalUrl)}</a>`
        : `<span class="muted-dash">—</span>`;

      return `<tr class="${staleClass}" data-id="${a.id}">
        <td data-label="Role">
          <div class="role-name">${staleDot}${escHtml(a.role || 'No role specified')}</div>
        </td>
        <td data-label="Portal">${portalCell}</td>
        <td data-label="Status"><span class="badge badge-${a.status}">${a.status}</span></td>
        <td data-label="Applied"><div class="date-cell">${formatDate(a.applied_at)}</div></td>
        <td data-label="Last Checked"><div class="date-cell ${checkClass}">${checkLabel}</div></td>
        <td data-label="Notes" class="notes-cell" title="${escHtml(a.notes || '')}">${escHtml(a.notes || '—')}</td>
        <td data-label="Actions">
          <div class="actions">
            ${checkButton}
            <button class="btn btn-ghost btn-ghost-compact" onclick="openEdit(${a.id})">Edit</button>
            <button class="btn btn-danger" onclick="deleteApp(${a.id})">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    return `
      <tr class="company-group-row ${isCollapsed ? 'collapsed' : ''}">
        <td colspan="7">
          <button
            class="company-group-toggle"
            onclick='toggleCompanyGroup(${JSON.stringify(companyKey)})'
            aria-expanded="${isCollapsed ? 'false' : 'true'}"
            aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escHtml(companyName)} applications"
          >
            <div class="company-group">
              <div class="company-group-name">${escHtml(companyName)}</div>
              <div class="company-group-count-wrap">
                <div class="company-group-count">${companyApps.length} application${companyApps.length === 1 ? '' : 's'}</div>
                <span class="company-group-chevron" aria-hidden="true">▾</span>
              </div>
            </div>
          </button>
        </td>
      </tr>
      ${isCollapsed ? '' : appRows}
    `;
  }).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Portal</th>
          <th>Status</th>
          <th>Applied</th>
          <th>Last Checked</th>
          <th>Notes</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function updateStats() {
  const closed = ['rejected', 'accepted', 'withdrawn', 'ghosted'];
  const active = allApps.filter(a => !closed.includes(a.status));
  const interviews = allApps.filter(a => a.status === 'interview');
  const stale = allApps.filter(a => a.is_stale && !closed.includes(a.status));
  document.getElementById('stat-total').textContent = allApps.length;
  document.getElementById('stat-active').textContent = active.length;
  document.getElementById('stat-interview').textContent = interviews.length;
  document.getElementById('stat-stale').textContent = stale.length;
}

// ── Actions ───────────────────────────────────────────────────────
async function addApplication() {
  const company = document.getElementById('f-company').value.trim();
  if (!company) { toast('Company name is required', true); return; }

  const body = {
    company,
    role: document.getElementById('f-role').value.trim(),
    portal_url: document.getElementById('f-url').value.trim() || null,
    status: document.getElementById('f-status').value,
    applied_at: document.getElementById('f-applied-date').value || null,
    notes: document.getElementById('f-notes').value.trim() || null,
  };

  try {
    const res = await fetch(`${API}/api/applications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error();
    ['f-company','f-role','f-url','f-notes','f-applied-date'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('f-status').value = 'applied';
    toast(`✓ Logged application to ${company}`);
    loadApplications();
  } catch { toast('Failed to save', true); }
}

async function markChecked(id) {
  console.log(`[markChecked] marking id=${id} as checked`);
  try {
    const res = await fetch(`${API}/api/applications/${id}/check`, { method: 'POST' });
    const updated = await res.json();
    console.log(`[markChecked] server response for id=${id}:`, { last_checked_at: updated.last_checked_at, status: updated.status });
    toast('✓ Marked as checked');
    loadApplications();
    checkAlerts();
  } catch (err) {
    console.error('[markChecked] failed:', err);
    toast('Failed', true);
  }
}

async function deleteApp(id) {
  const app = allApps.find(a => a.id === id);
  if (!confirm(`Remove ${app?.company}?`)) return;
  try {
    await fetch(`${API}/api/applications/${id}`, { method: 'DELETE' });
    toast('Removed');
    loadApplications();
  } catch { toast('Failed', true); }
}

function openEdit(id) {
  const a = allApps.find(x => x.id === id);
  if (!a) return;
  editingId = id;
  document.getElementById('e-company').value = a.company || '';
  document.getElementById('e-role').value = a.role || '';
  document.getElementById('e-url').value = a.portal_url || '';
  document.getElementById('e-status').value = a.status || 'applied';
  document.getElementById('e-applied-date').value = toDateInputValue(a.applied_at);
  document.getElementById('e-notes').value = a.notes || '';
  document.getElementById('modal-overlay').classList.add('open');
}

async function saveEdit() {
  if (!editingId) return;
  const body = {
    company: document.getElementById('e-company').value.trim(),
    role: document.getElementById('e-role').value.trim(),
    portal_url: document.getElementById('e-url').value.trim() || null,
    status: document.getElementById('e-status').value,
    applied_at: document.getElementById('e-applied-date').value || null,
    notes: document.getElementById('e-notes').value.trim() || null,
  };
  try {
    const res = await fetch(`${API}/api/applications/${editingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error();
    closeModal();
    toast('✓ Updated');
    loadApplications();
    checkAlerts();
  } catch { toast('Failed to update', true); }
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

// ── Filters ───────────────────────────────────────────────────────
function setFilter(filter, el) {
  currentFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderTable();
}
function setSort(val) { currentSort = val; renderTable(); }
function setSearch(val) { currentSearch = val; renderTable(); }

function toggleCompanyGroup(companyKey) {
  if (!isMobileTableView()) return;
  if (collapsedCompanyGroups.has(companyKey)) collapsedCompanyGroups.delete(companyKey);
  else collapsedCompanyGroups.add(companyKey);
  renderTable();
}

function updateCompanySuggestions() {
  const datalist = document.getElementById('company-suggestions');
  if (!datalist) return;
  const companyNames = Array.from(new Set(
    allApps.map(a => (a.company || '').trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  datalist.innerHTML = companyNames
    .map(name => `<option value="${escHtml(name)}"></option>`)
    .join('');
}

// ── Alert banner ──────────────────────────────────────────────────
function showAlertBanner(data) {
  lastAlertApps = data.applications;
  const banner = document.getElementById('alert-banner');
  document.getElementById('alert-text').textContent =
    `You have ${data.count} application${data.count > 1 ? 's' : ''} you haven't checked on in a few days. Time for a follow-up sweep!`;

  const tagsEl = document.getElementById('alert-apps');
  tagsEl.innerHTML = data.applications.slice(0, 8).map(a =>
    `<span class="alert-tag" onclick="focusApp('${escHtml(a.company)}')">${escHtml(a.company)}</span>`
  ).join('');
  if (data.applications.length > 8) {
    tagsEl.innerHTML += `<span class="alert-more">+${data.applications.length - 8} more</span>`;
  }

  banner.classList.add('visible');
}

function dismissAlert() {
  alertDismissedAt = Date.now();
  alertDismissedIds = new Set(lastAlertApps.map(a => String(a.id)));
  document.getElementById('alert-banner').classList.remove('visible');
}

function saveSnoozeHours(val) {
  const hours = Math.max(1, Math.min(24, parseInt(val, 10) || 4));
  localStorage.setItem('alert-snooze-hours', String(hours));
  document.getElementById('snooze-hours').value = hours;
}

function initSnoozeHours() {
  const saved = parseInt(localStorage.getItem('alert-snooze-hours') || '4', 10);
  const input = document.getElementById('snooze-hours');
  if (input) input.value = saved;
}

function focusApp(company) {
  currentSearch = company;
  document.querySelector('.search-input').value = company;
  setFilter('all', document.querySelector('[data-filter="all"]'));
  document.querySelector('main').scrollIntoView({ behavior: 'smooth' });
}

// ── Helpers ───────────────────────────────────────────────────────
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = isError ? 'error show' : 'show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function toDateInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Theme ─────────────────────────────────────────────────────────
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function updateThemeUi(preference) {
  const map = {
    system: document.getElementById('theme-system'),
    dark: document.getElementById('theme-dark'),
    light: document.getElementById('theme-light'),
  };

  Object.values(map).forEach(btn => btn && btn.classList.remove('active'));
  if (map[preference]) map[preference].classList.add('active');

  const toggle = document.getElementById('theme-fab-toggle');
  const iconByPreference = { system: '◐', dark: '☾', light: '☀' };
  if (toggle) toggle.textContent = iconByPreference[preference] || '◐';
}

function setThemePreference(preference) {
  localStorage.setItem('theme-preference', preference);
  const resolvedTheme = preference === 'system' ? getSystemTheme() : preference;
  applyTheme(resolvedTheme);
  updateThemeUi(preference);
  closeThemeMenu();
}

function initializeTheme() {
  const savedPreference = localStorage.getItem('theme-preference') || 'system';
  setThemePreference(savedPreference);
}

function toggleThemeMenu() {
  const menu = document.getElementById('theme-options');
  if (!menu) return;
  menu.classList.toggle('open');
}

function closeThemeMenu() {
  const menu = document.getElementById('theme-options');
  if (menu) menu.classList.remove('open');
}

function toggleSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  panel.classList.toggle('open');
}

function closeSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.remove('open');
}

document.addEventListener('click', (event) => {
  const fab = document.getElementById('theme-fab');
  if (fab && !fab.contains(event.target)) closeThemeMenu();
  const sfab = document.getElementById('settings-fab');
  if (sfab && !sfab.contains(event.target)) closeSettingsPanel();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('theme-preference') || 'system') === 'system') {
    applyTheme(getSystemTheme());
  }
});

mobileTableMediaQuery.addEventListener('change', () => {
  renderTable();
});

// ── Init ──────────────────────────────────────────────────────────
initializeTheme();
initSnoozeHours();
loadApplications();
checkAlerts();
// Poll for alerts every 30 minutes
setInterval(checkAlerts, 30 * 60 * 1000);
