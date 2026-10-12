const $ = (id) => document.getElementById(id);
const state = { accounts: [], posts: [], media: null, user: null, config: null, uploading: false, sending: false, previewUrl: null, creatorInfo: {}, creatorLoading: false, historyOffset: 0 };
const names = { facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
const symbols = { facebook: 'f', tiktok: '♪', youtube: '▶' };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => new Date(value && !/[Z+]\d*:?\d*$/.test(value) ? value + 'Z' : value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const badge = value => `<span class="badge ${escape(value)}">${escape(value.replaceAll('_', ' '))}</span>`;
const icon = platform => `<span class="platform-icon ${platform}">${symbols[platform]}</span>`;
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
function errorBox(id, message) { $(id).textContent = message; $(id).hidden = !message; }
async function api(path, options = {}) {
  let response;
  try { response = await fetch(window.PXSTER.apiUrl + path, { credentials: 'include', ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
  catch { throw new Error('The API is unavailable. Check your connection and try again.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.user) { showAuth('login'); }
    const message = Array.isArray(body.detail) ? body.detail.map(e => `${e.loc.slice(1).join(' ')}: ${e.msg}`).join('. ') : body.detail;
    throw new Error(message || `Request failed (${response.status}). Please try again.`);
  }
  return body;
}
function selectedAccounts() { return [...document.querySelectorAll('.channel input:checked')].map(input => state.accounts.find(a => a.id === input.value)).filter(Boolean); }
function navigate() {
  const view = ['accounts', 'history', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'composer';
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== view);
  document.querySelectorAll('nav a[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = 'Workspace / ' + { composer: 'Composer', accounts: 'Connected accounts', history: 'Publishing history', settings: 'Settings / Publishing Approval' }[view];
  if (view === 'history' && state.user) loadHistory().catch(e => toast(e.message));
}
window.addEventListener('hashchange', navigate);
function renderAccounts() {
  const previous = new Set(selectedAccounts().map(a => a.id));
  $('channel-list').innerHTML = state.accounts.filter(a => a.status === 'connected').map(a => `<label class="channel">${icon(a.platform)}<span>${names[a.platform]}<small>${escape(a.display_name)}</small></span><input type="checkbox" value="${a.id}" ${previous.has(a.id) ? 'checked' : ''} aria-label="Publish to ${escape(a.display_name)}"></label>`).join('') || '<p class="empty-text">Your channels are waiting. <a href="#accounts">Connect your first account →</a></p>';
  $('account-list').innerHTML = state.accounts.map(a => `<div class="account-row">${icon(a.platform)}<div><strong>${escape(a.display_name)}</strong><small>${names[a.platform]}${a.demo ? ' · Demo account' : ''}${a.expires_at ? ' · Token expires ' + date(a.expires_at) : ''}</small></div>${badge(a.status)}${a.status === 'connected' ? `<button class="text-button" data-disconnect="${a.id}">Disconnect</button>` : ''}</div>`).join('') || '<p class="empty-text">No accounts yet. Choose a platform above to connect.</p>';
  $('provider-cards').innerHTML = Object.keys(names).map(p => `<article class="provider-card">${icon(p)}<h2>${names[p]}</h2><p>${{ facebook: 'Publish photos and videos to your Facebook Pages.', tiktok: 'Share videos with your TikTok audience.', youtube: 'Upload videos to your YouTube channel.' }[p]}</p><button class="primary" data-connect="${p}">Connect ${names[p]} ↗</button>${state.config?.demo ? `<button class="text-button" data-demo="${p}">Add demo ${names[p]} account</button>` : ''}${!state.config?.platforms[p] ? '<p class="field-note">OAuth credentials need to be configured.</p>' : ''}</article>`).join('');
  document.querySelectorAll('.channel input').forEach(el => el.addEventListener('change', updateChannels));
  updateChannels();
}
async function refreshAccounts() { state.accounts = await api('/accounts'); renderAccounts(); }
let creatorRequest = 0;
async function updateChannels() {
  const selected = selectedAccounts();
  const youtube = selected.some(a => a.platform === 'youtube');
  const tiktoks = selected.filter(a => a.platform === 'tiktok');
  $('youtube-options').hidden = !youtube;
  for (const id of ['youtube-title', 'youtube-privacy', 'youtube-kids']) { $(id).required = youtube; $(id).disabled = !youtube; }
  $('tiktok-options').hidden = !tiktoks.length;
  $('tiktok-privacy').required = !!tiktoks.length;
  $('tiktok-consent').required = !!tiktoks.length;
  $('tiktok-privacy').disabled = !tiktoks.length;
  $('tiktok-consent').disabled = !tiktoks.length;
  $('selection-summary').textContent = selected.length ? `${selected.length} account${selected.length > 1 ? 's' : ''} selected` : 'Select accounts to continue';
  $('preview-account-name').textContent = selected.map(a => a.display_name).join(', ') || 'Choose a connected account';
  const requestId = ++creatorRequest;
  state.creatorLoading = !!tiktoks.length;
  updatePublishButton();
  if (!tiktoks.length) return;
  $('tiktok-creator').textContent = 'Loading current TikTok creator settings…';
  $('tiktok-privacy').innerHTML = '<option value="">Select visibility</option>';
  try {
    const infos = await Promise.all(tiktoks.map(async a => [a.id, await api(`/accounts/${a.id}/creator-info`)]));
    if (requestId !== creatorRequest) return;
    state.creatorInfo = Object.fromEntries(infos);
    const sharedOptions = infos[0][1].privacy_level_options.filter(option => infos.every(([, info]) => info.privacy_level_options.includes(option)));
    const labels = { SELF_ONLY: 'Only me', PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers' };
    $('tiktok-privacy').innerHTML = '<option value="">Select visibility</option>' + sharedOptions.map(option => `<option value="${escape(option)}">${escape(labels[option] || option)}</option>`).join('');
    $('tiktok-creator').textContent = infos.map(([, info]) => `${info.creator_nickname} · up to ${info.max_video_post_duration_sec} seconds`).join(' / ');
    for (const action of ['comment', 'duet', 'stitch']) { $(`allow-${action}`).disabled = infos.some(([, info]) => info[`${action}_disabled`]); $(`allow-${action}`).checked = false; }
    $('tiktok-consent').checked = false;
    state.creatorLoading = false;
  } catch (error) { if (requestId !== creatorRequest) return; $('tiktok-creator').textContent = error.message + ' Reselect the TikTok account to retry.'; }
  updatePublishButton();
}
function updatePublishButton() { $('publish-button').disabled = state.uploading || state.sending || state.creatorLoading; }
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-connect],[data-demo],[data-disconnect],[data-retry]');
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.connect) { const result = await api(`/oauth/${button.dataset.connect}/start`, { method: 'POST' }); location.assign(result.url); }
    if (button.dataset.demo) { await api(`/accounts/demo/${button.dataset.demo}`, { method: 'POST' }); await refreshAccounts(); toast('Demo account connected. Publishing will be simulated.'); }
    if (button.dataset.disconnect) { await api(`/accounts/${button.dataset.disconnect}`, { method: 'DELETE' }); await refreshAccounts(); toast('Account disconnected from Pxster. Manage platform-side access in the platform’s app settings.'); }
    if (button.dataset.retry) { await api(`/destinations/${button.dataset.retry}/retry`, { method: 'POST' }); await loadHistory(); toast('Destination queued for another attempt or status check.'); }
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
function preview(data, type) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(data);
  const el = document.createElement(type.startsWith('video/') ? 'video' : 'img');
  el.src = state.previewUrl;
  if (el.tagName === 'VIDEO') { el.controls = true; el.preload = 'metadata'; } else el.alt = 'Selected media preview';
  $('preview-media').replaceChildren(el);
}
const placeholder = $('preview-media').innerHTML;
function removeMedia() {
  state.media = null;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  $('media-input').value = '';
  $('media-info').hidden = true;
  $('preview-media').innerHTML = placeholder;
  $('drop-zone').hidden = false;
}
async function upload(file) {
  if (!file || state.uploading) return;
  errorBox('form-error', '');
  if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(file.type)) return errorBox('form-error', 'Choose a JPEG, PNG, WebP, or MP4 file.');
  if (!file.size || file.size > 64 * 1024 * 1024) return errorBox('form-error', 'Choose a non-empty file up to 64 MiB.');
  state.uploading = true; updatePublishButton(); $('remove-media').disabled = true;
  $('drop-zone').setAttribute('aria-busy', 'true');
  $('media-info').hidden = false; $('media-name').textContent = 'Uploading and validating…'; $('media-meta').textContent = file.name;
  const body = new FormData(); body.append('file', file);
  try {
    state.media = await api('/media', { method: 'POST', body });
    preview(file, file.type);
    $('media-name').textContent = file.name;
    const v = state.media.validation;
    $('media-meta').textContent = `✓ Validated · ${(file.size / 1024 / 1024).toFixed(1)} MiB · ${v.width} × ${v.height}${v.duration ? ' · ' + Math.round(v.duration) + ' seconds' : ''}`;
    $('drop-zone').hidden = true;
  } catch (error) { removeMedia(); errorBox('form-error', error.message); }
  finally { state.uploading = false; updatePublishButton(); $('remove-media').disabled = false; $('drop-zone').removeAttribute('aria-busy'); }
}
$('media-input').addEventListener('change', e => upload(e.target.files[0]));
$('remove-media').addEventListener('click', removeMedia);
$('drop-zone').addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); $('media-input').click(); } });
for (const type of ['dragover', 'dragleave', 'drop']) $('drop-zone').addEventListener(type, e => { e.preventDefault(); $('drop-zone').classList.toggle('dragover', type === 'dragover'); if (type === 'drop') upload(e.dataTransfer.files[0]); });
$('caption').addEventListener('input', () => { $('preview-caption').textContent = $('caption').value || 'A blank canvas for your next idea.'; $('character-count').textContent = `${$('caption').value.length.toLocaleString()} / 5,000`; });
document.querySelectorAll('[name=timing]').forEach(el => el.addEventListener('change', () => { const later = el.value === 'later'; $('schedule-field').hidden = !later; $('schedule-at').required = later; $('publish-button').innerHTML = later ? 'Schedule post <span>◷</span>' : 'Publish post <span>↗</span>'; }));
$('timezone-note').textContent = `Your local timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Schedules are stored in UTC.`;
function commercialChanged() { $('commercial-options').hidden = !$('commercial').checked; if (!$('commercial').checked) { $('own-brand').checked = false; $('paid-brand').checked = false; } $('brand-policy').hidden = !$('paid-brand').checked; $('tiktok-consent').checked = false; }
$('commercial').addEventListener('change', commercialChanged); $('paid-brand').addEventListener('change', commercialChanged);
$('composer-form').addEventListener('submit', async event => {
  event.preventDefault(); errorBox('form-error', '');
  if (state.sending || state.uploading || state.creatorLoading) return;
  const accounts = selectedAccounts();
  try {
    if (!state.media) throw new Error('Add and validate your media first.');
    if (!accounts.length) throw new Error('Choose at least one connected account.');
    if (accounts.some(a => ['tiktok', 'youtube'].includes(a.platform)) && state.media.content_type !== 'video/mp4') throw new Error('Choose an MP4 video for TikTok or YouTube. Facebook also accepts photos.');
    const later = document.querySelector('[name=timing]:checked').value === 'later';
    const payload = { caption: $('caption').value, media_id: state.media.id, account_ids: accounts.map(a => a.id), scheduled_at: later ? new Date($('schedule-at').value).toISOString() : null };
    if (later && new Date(payload.scheduled_at) <= new Date()) throw new Error('Choose a time in the future.');
    if (accounts.some(a => a.platform === 'youtube')) payload.youtube = { title: $('youtube-title').value, privacy: $('youtube-privacy').value, made_for_kids: $('youtube-kids').value === 'yes' };
    if (accounts.some(a => a.platform === 'tiktok')) {
      if ($('caption').value.length > 2200) throw new Error('TikTok captions must be 2,200 characters or fewer.');
      if ($('commercial').checked && !$('own-brand').checked && !$('paid-brand').checked) throw new Error('Choose your brand, branded content, or both.');
      if ($('paid-brand').checked && $('tiktok-privacy').value === 'SELF_ONLY') throw new Error('Branded TikTok content cannot be private.');
      payload.tiktok = { privacy_level: $('tiktok-privacy').value, disable_comment: !$('allow-comment').checked, disable_duet: !$('allow-duet').checked, disable_stitch: !$('allow-stitch').checked, brand_content_toggle: $('paid-brand').checked, brand_organic_toggle: $('own-brand').checked, consent: $('tiktok-consent').checked };
    }
    const serialized = JSON.stringify(payload);
    let pending; try { pending = JSON.parse(sessionStorage.getItem('pxster-pending')); } catch { /* Empty session. */ }
    const key = pending?.body === serialized ? pending.key : crypto.randomUUID();
    sessionStorage.setItem('pxster-pending', JSON.stringify({ body: serialized, key }));
    state.sending = true; updatePublishButton();
    await api('/posts', { method: 'POST', body: serialized, headers: { 'Idempotency-Key': key } });
    sessionStorage.removeItem('pxster-pending');
    $('composer-form').reset(); removeMedia(); $('caption').dispatchEvent(new Event('input')); $('schedule-field').hidden = true; $('schedule-at').required = false; $('publish-button').innerHTML = 'Publish post <span>↗</span>'; commercialChanged(); updateChannels();
    toast(later ? 'Post scheduled. Track each account in publishing history.' : 'Post queued. Track each account in publishing history.');
    location.hash = 'history';
  } catch (error) { errorBox('form-error', error.message); }
  finally { state.sending = false; updatePublishButton(); }
});
function renderHistory() {
  const filter = $('history-filter').value;
  const posts = state.posts.filter(p => filter === 'all' || p.state === filter || (filter === 'attention' && ['failed', 'partial_failure', 'needs_attention'].includes(p.state)));
  $('history-list').innerHTML = posts.map(post => `<article class="card history-post"><div class="history-post-heading"><h2>${escape(post.caption || 'Untitled media post')}</h2>${badge(post.state)}</div><p class="dates">Created ${date(post.created_at)} · Publish time ${date(post.scheduled_at)}</p>${post.destinations.map(d => `<div class="destination"><div class="destination-title">${icon(d.platform)}<strong>${escape(d.account)}</strong>${badge(d.state)}</div>${d.last_error ? `<p>${escape(d.last_error)}</p>` : ''}${d.platform_post_id ? `<p>Platform post ID: <code>${escape(d.platform_post_id)}</code></p>` : ''}${['failed', 'needs_attention'].includes(d.state) ? `<button class="text-button" data-retry="${d.id}">Retry / check status ↻</button>` : ''}<details><summary>${d.attempts.length} publishing attempt${d.attempts.length === 1 ? '' : 's'}</summary><ul>${d.attempts.map(a => `<li>${date(a.attempted_at)} · ${escape(a.state)}${a.error_code ? ' · ' + escape(a.error_code) : ''}${a.retry_at ? ' · Retry ' + date(a.retry_at) : ''}</li>`).join('') || '<li>Waiting for its scheduled time.</li>'}</ul></details></div>`).join('')}</article>`).join('') || '<section class="card"><p class="empty-text">No posts here yet. Your next idea is a good place to start.</p><a href="#composer" class="text-link">Create a post →</a></section>';
}
async function loadHistory(more = false) {
  const offset = more ? state.posts.length : 0;
  const posts = await api('/posts?offset=' + offset);
  state.posts = more ? [...state.posts, ...posts] : posts;
  $('load-more').hidden = posts.length < 50;
  renderHistory();
}
$('history-filter').addEventListener('change', renderHistory);
$('refresh-history').addEventListener('click', () => loadHistory().catch(e => toast(e.message)));
$('load-more').addEventListener('click', () => loadHistory(true).catch(e => toast(e.message)));
async function signedIn(user) {
  state.user = user;
  await refreshAccounts();
  $('profile-email').textContent = user.email; $('profile-name').textContent = user.username || 'Creator workspace'; $('logout').hidden = false;
  $('workspace').hidden = false; document.body.classList.add('authenticated'); $('auth-dialog').close();
  document.title = 'Pxster — Your publishing workspace';
  const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('auth'); history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  navigate();
}
let authMode = new URLSearchParams(location.search).get('auth') === 'signup' ? 'signup' : 'login';
function setAuthMode(mode) {
  authMode = mode === 'signup' && state.config?.registration !== false ? 'signup' : 'login';
  const signup = authMode === 'signup';
  document.title = signup ? 'Pxster — Sign up' : 'Pxster — Log in';
  $('auth-title').textContent = signup ? 'Find your frequency.' : 'Welcome back.';
  $('auth-description').textContent = signup ? 'Create your account. Make your next move.' : 'Your next great post is waiting.';
  $('login-identifier-label').hidden = signup; $('email').disabled = signup; $('email').required = !signup;
  for (const [label, input] of [['signup-username-label', 'signup-username'], ['signup-email-label', 'signup-email'], ['confirm-password-label', 'confirm-password']]) {
    $(label).hidden = !signup; $(input).disabled = !signup; $(input).required = signup;
  }
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('confirm-password').setCustomValidity('');
  $('login-button').innerHTML = signup ? 'Create account <span>↗</span>' : 'Log in <span>↗</span>';
  $('auth-login-tab').classList.toggle('active', !signup); $('auth-login-tab').setAttribute('aria-pressed', String(!signup));
  $('register-button').classList.toggle('active', signup); $('register-button').setAttribute('aria-pressed', String(signup));
  $('auth-switch-copy').textContent = signup ? 'Already on the same wavelength?' : 'New to Pxster?';
  $('auth-switch-button').textContent = signup ? 'Log in' : 'Create an account';
  $('auth-switch-button').hidden = !signup && state.config?.registration === false;
  $('auth-switch-copy').hidden = !signup && state.config?.registration === false;
  errorBox('auth-error', '');
}
function showAuth(mode = authMode) {
  state.user = null; $('workspace').hidden = true; document.body.classList.remove('authenticated');
  setAuthMode(mode);
  if (!$('auth-dialog').open) $('auth-dialog').showModal();
}
async function authenticate() {
  const register = authMode === 'signup';
  if (register && $('password').value !== $('confirm-password').value) { errorBox('auth-error', 'Your passwords do not match. Please enter them again.'); return; }
  errorBox('auth-error', ''); $('login-button').disabled = $('register-button').disabled = true;
  $('auth-login-tab').disabled = $('auth-switch-button').disabled = true;
  try {
    const payload = register ? { username: $('signup-username').value.trim(), email: $('signup-email').value.trim(), password: $('password').value } : { identifier: $('email').value.trim(), password: $('password').value };
    const user = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    $('password').value = $('confirm-password').value = ''; await signedIn(user);
  }
  catch (error) { $('workspace').hidden = true; document.body.classList.remove('authenticated'); errorBox('auth-error', error.message); }
  finally { $('login-button').disabled = $('register-button').disabled = false; }
  $('auth-login-tab').disabled = $('auth-switch-button').disabled = false;
}
$('auth-form').addEventListener('submit', e => { e.preventDefault(); authenticate(); });
$('register-button').addEventListener('click', () => setAuthMode('signup'));
$('auth-login-tab').addEventListener('click', () => setAuthMode('login'));
$('auth-switch-button').addEventListener('click', () => setAuthMode(authMode === 'signup' ? 'login' : 'signup'));
$('toggle-password').addEventListener('click', () => { const reveal = $('password').type === 'password'; $('password').type = reveal ? 'text' : 'password'; $('toggle-password').textContent = reveal ? 'Hide' : 'Show'; $('toggle-password').setAttribute('aria-label', reveal ? 'Hide password' : 'Show password'); });
$('auth-dialog').addEventListener('cancel', e => e.preventDefault());
$('logout').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST' }); location.reload(); } catch (e) { toast(e.message); } });
async function init() {
  $('auth-home').href = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:5174' : 'https://pxster.xyz';
  setAuthMode(authMode);
  navigate();
  try {
    state.config = await api('/config');
    $('connection-status').textContent = state.config.demo ? 'Demo API connected' : 'Workspace API connected';
    $('demo-banner').hidden = !state.config.demo;
    $('register-button').hidden = !state.config.registration;
    renderAccounts();
    if (new URLSearchParams(location.search).has('auth')) showAuth();
    else {
      try { await signedIn(await api('/auth/me')); }
      catch { showAuth(); }
    }
  } catch (error) {
    $('connection-status').textContent = 'API unavailable'; $('connection-status').classList.add('offline');
    showAuth(); $('auth-status').textContent = 'Start the Pxster API to sign in. ' + error.message;
  }
  const connection = new URLSearchParams(location.search).get('connection');
  if (connection) { toast(({ success: 'Account connected. You’re ready to compose.', cancelled: 'Connection cancelled.', failed: 'Connection failed. Check platform permissions and try again.', no_accounts: 'No eligible Page or channel was found for this login.' })[connection] || 'Connection finished.'); history.replaceState(null, '', location.pathname + location.hash); }
}
setInterval(() => { if (state.user && location.hash === '#history' && !document.hidden) loadHistory().catch(() => {}); }, 10000);
init();
