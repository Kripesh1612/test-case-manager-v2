// Shared utilities used by every page.
// Loaded BEFORE each page-specific script, so token + helpers are in scope.

// ----- Auth state (read fresh from localStorage on each page load) -----
const token = localStorage.getItem('tcm_token') || '';
const currentUser = JSON.parse(localStorage.getItem('tcm_user') || 'null');

function setAuth(data) {
  localStorage.setItem('tcm_token', data.token);
  localStorage.setItem('tcm_user', JSON.stringify(data.user));
}
function clearAuth() {
  localStorage.removeItem('tcm_token');
  localStorage.removeItem('tcm_user');
}

// ----- HTTP helper -----
async function fetchJSON(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

// ----- Toast -----
// Supports an optional { action: { label, onClick, href }, duration } so we can
// show an "Undo" toast after bulk delete (great for Cypress testing async UX)
// or a "Open Trash" link after a soft-delete.
function toast(msg, kind = 'error', opts = {}) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('data-cy', 'toast');
  if (kind === 'success') t.setAttribute('data-cy-toast', 'success');
  if (kind === 'error') t.setAttribute('data-cy-toast', 'error');

  const text = document.createElement('span');
  text.textContent = msg;
  t.appendChild(text);

  if (opts.action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.setAttribute('data-cy', 'toast-action');
    btn.textContent = opts.action.label;
    btn.addEventListener('click', () => {
      if (typeof opts.action.onClick === 'function') {
        opts.action.onClick();
      } else if (opts.action.href) {
        // Use replace so the trash page isn't reachable via the back button
        // from where the user just came (they'd be confused why the deleted
        // row reappeared in their list).
        location.replace(opts.action.href);
      }
      t.remove();
    });
    t.appendChild(btn);
  }

  document.body.appendChild(t);
  const duration = opts.duration || 3500;
  setTimeout(() => t.remove(), duration);
}

// ----- HTML escape -----
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ----- Auth gate for protected pages -----
async function requireAuth() {
  if (!token) {
    location.href = '/login';
    return false;
  }
  try {
    // /auth/me returns the fresh user from DB, so role changes by an admin
    // propagate on the next page load without requiring a re-login.
    const me = await fetchJSON('GET', '/auth/me');
    if (me && me.user) {
      localStorage.setItem('tcm_user', JSON.stringify(me.user));
      // currentUser is a const snapshot taken at script load — patch it
      // in place so role helpers (canWrite / isAdmin) see the fresh value.
      if (currentUser) {
        currentUser.role = me.user.role;
        currentUser.name = me.user.name;
        currentUser.email = me.user.email;
      }
    }
    applyRoleToBody();
    return true;
  } catch (e) {
    clearAuth();
    location.href = '/login';
    return false;
  }
}

// Sets body class so CSS can hide [data-writable] for viewers,
// and inserts a read-only banner if the role can't write.
function applyRoleToBody() {
  const r = currentUser?.role || 'viewer';
  document.body.classList.add(`role-${r}`);

  // Insert a read-only banner for viewers (if not already present)
  if (!canWrite() && !document.getElementById('readonly-banner')) {
    const banner = document.createElement('div');
    banner.id = 'readonly-banner';
    banner.className = 'readonly-banner';
    banner.setAttribute('data-cy', 'readonly-banner');
    banner.textContent = `You're signed in as a ${r} — this is a read-only view. Ask an admin to upgrade your role.`;
    const main = document.querySelector('main.content');
    if (main) main.prepend(banner);
  }
}

// ----- Role helpers -----
// currentUser.role is one of: 'admin' | 'editor' | 'viewer'
const role = currentUser?.role || 'viewer';

function canWrite() {
  return role === 'admin' || role === 'editor';
}
function isAdmin() {
  return role === 'admin';
}

// ----- Profile dropdown (for app pages) -----
function setupProfileMenu() {
  const btn = document.getElementById('profile-btn');
  if (!btn) return;
  renderProfile();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('profile-dropdown');
    if (dd) dd.hidden = !dd.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.profile-menu')) {
      const dd = document.getElementById('profile-dropdown');
      if (dd) dd.hidden = true;
    }
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    location.href = '/login';
  });

  // Show / hide the Admin tab based on role
  document.querySelectorAll('[data-cy="tab-admin"], [data-admin-tab]').forEach((el) => {
    el.hidden = !isAdmin();
  });
}

function renderProfile() {
  if (!currentUser) return;
  const initial = (currentUser.name?.[0] || currentUser.email[0] || '?').toUpperCase();
  const initialEl = document.getElementById('profile-initial');
  const nameEl = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  const roleEl = document.getElementById('profile-role');
  if (initialEl) initialEl.textContent = initial;
  if (nameEl) nameEl.textContent = currentUser.name || 'User';
  if (emailEl) emailEl.textContent = currentUser.email;
  if (roleEl) {
    roleEl.textContent = currentUser.role || 'viewer';
    roleEl.setAttribute('data-cy', `profile-role-${currentUser.role}`);
    roleEl.className = `dropdown-role role-${currentUser.role}`;
  }
}

// ----- Confirm modal -----
// Replaces browser confirm() so Cypress can target the modal buttons directly.
function confirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.setAttribute('data-cy', 'modal-backdrop');
    wrap.innerHTML = `
      <div class="modal" data-cy="modal">
        <h3 data-cy="modal-title">${escapeHtml(title)}</h3>
        <p data-cy="modal-message">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn" data-cy="modal-cancel" data-action="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-cy="modal-confirm" data-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = (result) => {
      wrap.remove();
      resolve(result);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close(false);
      if (e.target.dataset.action === 'cancel') close(false);
      if (e.target.dataset.action === 'confirm') close(true);
    });
    wrap.querySelector('[data-cy="modal-cancel"]').focus();
  });
}

// ----- Loading spinner -----
// Shows a full-page overlay while async work runs. Returns a stop() function.
function spinner(message = 'Loading…') {
  const wrap = document.createElement('div');
  wrap.className = 'spinner-overlay';
  wrap.setAttribute('data-cy', 'spinner');
  wrap.innerHTML = `
    <div class="spinner-box">
      <div class="spinner-ring"></div>
      <div class="spinner-msg" data-cy="spinner-message">${escapeHtml(message)}</div>
    </div>`;
  document.body.appendChild(wrap);
  return {
    update(msg) {
      const m = wrap.querySelector('[data-cy="spinner-message"]');
      if (m) m.textContent = msg;
    },
    stop() {
      wrap.remove();
    },
  };
}

// Wraps an async function with a spinner — convenient for CRUD handlers.
async function withSpinner(message, fn) {
  const s = spinner(message);
  try {
    return await fn();
  } finally {
    s.stop();
  }
}
