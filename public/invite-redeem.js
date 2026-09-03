// Page: /invite-redeem — public; takes ?token= from URL and lets the
// invitee set name + password. On success, stores the JWT and redirects
// to /dashboard.

const params = new URLSearchParams(window.location.search);
const inviteToken = params.get('token');

const form = document.getElementById('invite-redeem-form');
const error = document.getElementById('invite-error');

if (!inviteToken) {
  error.textContent = 'Missing invite token. Use the link from your invitation email.';
  error.hidden = false;
  form.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
} else {
  // Look up the invite so we can preview which email was invited.
  fetch(`/invites`, { headers: {} })
    .then((r) => r.ok ? r.json() : null)
    .catch(() => null)
    .then((data) => {
      // /invites is admin-only — non-admin won't get the email. That's
      // fine; the user can still submit and see the real error if the
      // token is bad.
      if (data && Array.isArray(data.invites)) {
        const mine = data.invites.find((i) => i.token === inviteToken);
        if (mine) {
          document.getElementById('invite-email-hint').textContent =
            `You've been invited as ${mine.email} (role: ${mine.role}).`;
        }
      }
    });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const name = document.getElementById('name').value.trim();
  const password = document.getElementById('password').value;
  if (!name || !password) return;

  try {
    const resp = await fetch('/invites/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteToken, name, password }),
    });
    const body = await resp.json();
    if (!resp.ok) {
      error.textContent = body.error || 'Invite redemption failed';
      error.hidden = false;
      return;
    }
    // Success — store auth and bounce to dashboard.
    setAuth(body.user, body.token);
    window.location.replace('/dashboard');
  } catch (err) {
    error.textContent = 'Network error — please retry';
    error.hidden = false;
  }
});