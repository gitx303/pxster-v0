const $ = (id) => document.getElementById(id);
const state = { accounts: [], posts: [], media: null, user: null, config: null, uploading: false, sending: false, previewUrl: null, creatorInfo: {}, creatorLoading: false, historyOffset: 0 };
const names = { facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
const symbols = { facebook: 'f', tiktok: '♪', youtube: '▶' };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => new Date(value && !/[Z+]\d*:?\d*$/.test(value) ? value + 'Z' : value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const badge = value => `<span class="badge ${escape(value)}">${escape(value.replaceAll('_', ' '))}</span>`;
const icon = platform => `<span class="platform-icon ${platform}">${symbols[platform]}</span>`;
let toastTimer;
let consentPreviewAccepted = false;
const simulatedPlatforms = new Set();
let previewPlatform = "tiktok";
const disconnectedSimulations = new Set();
let removalTarget = null;
const maskIcon = `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" style="vertical-align:middle;fill:currentColor"><path fill-rule="evenodd" d="M2 3l14 2v7c0 5-4 8-7 9-3-2-6-6-6-10L2 3zm3 5 4 1-1 2-3-1V8zm6 1 3 1-1 2-3-1 1-2zm-5 5c2 4 5 4 7 1l-7-1zM18 3l4-1-1 9c0 4-2 7-5 9l-2-1c3-3 4-6 4-10V3z"/></svg>`;

let simulationRun = 0;
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
function availableAccounts() { return [...state.accounts.filter(a => a.status === 'connected'), ...[...simulatedPlatforms].map(platform => ({id: 'simulation-' + platform, platform, display_name: 'pxster-test · Simulation', status: 'connected', simulation: true}))]; }
$('consent-preview-accept').addEventListener('click', () => {
  if (!state.user) return;
  simulatedPlatforms.add(previewPlatform); disconnectedSimulations.delete(previewPlatform);
  consentPreviewAccepted = true;
  $('consent-preview').close(); renderAccounts();
  toast(names[previewPlatform] + ' test channel connected. Select it in Composer.');
});
$('consent-preview-cancel').addEventListener('click', () => $('consent-preview').close());
let channelNoticeTimer, channelNoticeFadeTimer;
function flashChannelAction(platform, removed = false) {
  let notice = $('channel-notice');
  if (!notice) {
    notice = document.createElement('div'); notice.id = 'channel-notice';
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    document.body.append(notice);
  }
  clearTimeout(channelNoticeTimer); clearTimeout(channelNoticeFadeTimer);
  notice.textContent = removed ? 'Account Removed' : 'Disconnected';
  notice.hidden = false; notice.classList.remove('fading');
  channelNoticeFadeTimer = setTimeout(() => notice.classList.add('fading'), 1700);
  channelNoticeTimer = setTimeout(() => { notice.hidden = true; }, 2300);
}
async function disconnectChannel(account) {
  if (!state.user || !account) return;
  if (account.simulation) {
    simulatedPlatforms.delete(account.platform);
    disconnectedSimulations.add(account.platform);
    consentPreviewAccepted = simulatedPlatforms.size > 0;
    simulationRun++;
    if (!consentPreviewAccepted && state.media?.simulation) removeMedia();
    renderAccounts();
  } else {
    await api(`/accounts/${account.id}`, {method: 'DELETE'});
    await refreshAccounts();
  }
  flashChannelAction(account.platform);
}
function openRemoval(account) {
  if (!account) return;
  removalTarget = account;
  const connected = account.simulation ? simulatedPlatforms.has(account.platform) : account.status === 'connected';
  $('remove-account-message').textContent = connected
    ? 'Disconnect this channel first to stop using it in Composer. This clears its Pxster connection credentials; it does not delete your social account or change its platform settings. Existing publishing history is retained.'
    : 'This channel is disconnected. Remove its entry from Pxster? Your social account and existing publishing history will remain.';
  $('remove-account-action').textContent = connected ? 'Disconnect channel first' : 'Remove my Account';
  $('remove-account-dialog').showModal();
}
$('remove-account-cancel').addEventListener('click', () => $('remove-account-dialog').close());
$('remove-account-action').addEventListener('click', async () => {
  const account = removalTarget;
  if (!state.user || !account) return;
  const connected = account.simulation ? simulatedPlatforms.has(account.platform) : account.status === 'connected';
  $('remove-account-action').disabled = true;
  try {
    if (account.simulation) {
      if (connected) { simulatedPlatforms.delete(account.platform); disconnectedSimulations.add(account.platform); }
      else disconnectedSimulations.delete(account.platform);
      consentPreviewAccepted = simulatedPlatforms.size > 0; simulationRun++;
      if (!consentPreviewAccepted && state.media?.simulation) removeMedia();
      renderAccounts();
    } else {
      await api(`/accounts/${account.id}${connected ? '' : '/remove'}`, {method: 'DELETE'});
      await refreshAccounts(); account.status = 'disconnected';
    }
    flashChannelAction(account.platform, !connected);
    if (connected) {
      $('remove-account-message').textContent = 'Disconnected from Pxster. You can now remove this entry. For a real connection, manage any remaining platform-side authorization in the social platform’s app settings.';
      $('remove-account-action').textContent = 'Remove my Account';
    } else { $('remove-account-dialog').close(); }
  } catch (error) { $('remove-account-message').textContent = error.message; }
  finally { $('remove-account-action').disabled = false; }
});
function selectedAccounts() { return [...document.querySelectorAll('.channel input:checked')].map(input => availableAccounts().find(a => a.id === input.value)).filter(Boolean); }
function navigate() {
  const view = ['accounts', 'history', 'settings', 'publishing-approval'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'composer';
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== view);
  document.querySelectorAll('nav a[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = 'Workspace / ' + { composer: 'Composer', accounts: 'Connected accounts', history: 'Publishing history', settings: 'Settings / General Settings', 'publishing-approval': 'Settings / Publishing Approval' }[view];
  if (view === 'history' && state.user) loadHistory().catch(e => toast(e.message));
}
window.addEventListener('hashchange', navigate);
function renderAccounts() {
  const previous = new Set(selectedAccounts().map(a => a.id));
  $('channel-list').innerHTML = availableAccounts().map(a => `<label class="channel">${icon(a.platform)}<span>${names[a.platform]}<small>${escape(a.display_name)}</small></span><input type="checkbox" value="${a.id}" ${previous.has(a.id) ? 'checked' : ''} aria-label="Publish to ${escape(a.display_name)}"></label>`).join('') || '<p class="empty-text">Your channels are waiting. <a href="#accounts">Connect your first account →</a></p>';
  $('provider-cards').innerHTML = Object.keys(names).map(p => `<article class="provider-card" id="provider-${p}">${icon(p)}<h2>${names[p]}</h2><button class="primary" data-connect="${p}">Connect ${names[p]} ↗</button></article>`).join('');
  if (state.config?.demo || state.config?.connection_test) {
    for (const platform of Object.keys(names)) {
      const connected = simulatedPlatforms.has(platform);
      const card = $('provider-' + platform);
      const button = document.createElement('button');
      button.className = 'primary'; button.type = 'button';
      button.innerHTML = maskIcon + (connected ? ' Channel connected' : ' Connect ' + names[platform]);
      button.disabled = connected;
      button.setAttribute('aria-label', names[platform] + ' simulated channel connection');
      button.addEventListener('click', () => {
        previewPlatform = platform;
        $('consent-preview-title').textContent = 'Connect ' + names[platform] + ' — test consent';
        $('consent-permission').textContent = platform === 'tiktok' ? 'Preview permission: user.info.basic — identify the account and display its name.' : 'Preview permission: identify your ' + names[platform] + ' channel and show it in Composer. No real permissions are requested.';
        $('consent-preview').showModal();
      });
      const simulationAction = document.createElement('div');
      simulationAction.className = 'simulation-action';
      card.append(simulationAction);
      const note = document.createElement('p'); note.className = 'field-note';
      note.textContent = connected ? 'pxster-test · Connected for simulation' : disconnectedSimulations.has(platform) ? 'pxster-test · Disconnected simulation' : 'Simulation · No real account access';
      simulationAction.append(note, button);
    }
  }
  for (const platform of Object.keys(names)) {
    const accounts = state.accounts.filter(a => a.platform === platform && a.status !== 'removed');
    if (simulatedPlatforms.has(platform) || disconnectedSimulations.has(platform)) accounts.unshift({platform, simulation:true, display_name:'pxster-test · Simulation'});
    if (!accounts.length) continue;
    const card = $('provider-' + platform);
    let chosen = accounts[0];
    const row = document.createElement('div'); row.className = 'channel-actions';
    const disconnect = document.createElement('button'); disconnect.type = 'button'; disconnect.className = 'text-button';
    const status = document.createElement('span'); status.className = 'channel-disconnected'; status.textContent = 'Disconnected';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button remove-account-button'; remove.textContent = 'Remove my Account';
    const syncActions = () => {
      const connected = chosen.simulation ? simulatedPlatforms.has(platform) : chosen.status === 'connected';
      disconnect.textContent = 'Disconnect'; disconnect.hidden = !connected; status.hidden = true;
    };
    if (accounts.length > 1) {
      const select = document.createElement('select'); select.className = 'channel-account-picker'; select.setAttribute('aria-label', names[platform] + ' account to manage');
      accounts.forEach((account, i) => { const option = document.createElement('option'); option.value = i; option.textContent = account.display_name.replace(/^Demo /, 'Simulation '); select.append(option); });
      select.addEventListener('change', () => { chosen = accounts[Number(select.value)]; syncActions(); });
      card.append(select);
    }
    disconnect.addEventListener('click', async () => {
      disconnect.disabled = true;
      try { await disconnectChannel(chosen); } catch (error) { toast(error.message); disconnect.disabled = false; }
    });
    remove.addEventListener('click', () => openRemoval(chosen));
    row.append(disconnect, status, remove); syncActions(); card.append(row);
  }
  document.querySelectorAll('.channel input').forEach(el => el.addEventListener('change', updateChannels));
  updateChannels();
}
async function refreshAccounts() { state.accounts = await api('/accounts'); renderAccounts(); }
let creatorRequest = 0;
async function updateChannels() {
  const selected = selectedAccounts();
  const youtube = selected.some(a => a.platform === 'youtube' && !a.simulation);
  const tiktoks = selected.filter(a => a.platform === 'tiktok' && !a.simulation);
  $('simulation-note').hidden = !selected.some(a => a.simulation);
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
function updatePublishButton() { const simulated = selectedAccounts().some(a => a.simulation); $('publish-button').disabled = state.uploading || state.sending || state.creatorLoading || !selectedAccounts().length; $('media-input').disabled = !!state.config?.connection_test && !consentPreviewAccepted; $('publish-button').textContent = simulated ? 'Simulate publishing' : 'Publish post'; }
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-connect],[data-demo],[data-disconnect],[data-remove],[data-retry]');
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.connect) { const result = await api(`/oauth/${button.dataset.connect}/start`, { method: 'POST' }); location.assign(result.url); }
    if (button.dataset.demo) { await api(`/accounts/demo/${button.dataset.demo}`, { method: 'POST' }); await refreshAccounts(); toast('Simulation account connected. Publishing will be simulated.'); }
    if (button.dataset.disconnect) await disconnectChannel(state.accounts.find(a => a.id === button.dataset.disconnect));
    if (button.dataset.remove) openRemoval(state.accounts.find(a => a.id === button.dataset.remove));
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
  if (consentPreviewAccepted && (state.config?.connection_test || selectedAccounts().some(a => a.simulation))) {
    if (!file || file.type !== 'video/mp4' || !file.size || file.size > 64 * 1024 * 1024) return errorBox('form-error', 'Choose a non-empty MP4 up to 64 MiB for this simulation.');
    state.media = { simulation: true, content_type: file.type };
    preview(file, file.type); $('media-info').hidden = false;
    $('media-name').textContent = file.name; $('media-meta').textContent = 'Simulation · Local preview only; not uploaded or platform-validated.';
    $('drop-zone').hidden = true; return;
  }
  if (state.config?.connection_test) { toast('Connect a test channel first.'); return; }
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
  if (selectedAccounts().some(a => a.simulation)) {
    if (state.sending) return;
    if (selectedAccounts().some(a => !a.simulation)) return errorBox('form-error', 'Select only the simulated channel for a test post.');
    if (!state.media?.simulation) return errorBox('form-error', 'Choose a local test video first.');
    if ($('caption').value.length > 2200) return errorBox('form-error', 'Use up to 2,200 characters for TikTok.');
    if (document.querySelector('[name=timing]:checked').value !== 'now') return errorBox('form-error', 'This walkthrough supports Publish now only.');
    const run = ++simulationRun; state.sending = true; updatePublishButton();
    try {
      for (const message of ['TEST · Preparing post…', 'TEST · Simulating upload…', 'TEST · Simulating processing…']) {
        $('simulation-note').textContent = message;
        await new Promise(resolve => setTimeout(resolve, 900));
        if (run !== simulationRun || !consentPreviewAccepted || !state.user) return;
      }
      $('simulation-note').textContent = 'SIMULATED PUBLISHED · Nothing was uploaded to any platform. No live post exists.';
    } finally { state.sending = false; updatePublishButton(); }
    return;
  }
  if (state.media?.simulation) return errorBox('form-error', 'Local test media can only be used with the simulated channel.');
  if (state.config?.connection_test) { toast('Connection test only. Publishing is disabled.'); return; }
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
  consentPreviewAccepted = false; simulatedPlatforms.clear(); disconnectedSimulations.clear(); simulationRun++;
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
    $('connection-status').textContent = state.config.demo ? 'Simulation API connected' : 'Workspace API connected';
    $('demo-banner').hidden = !state.config.demo && !state.config.connection_test;
    if (state.config.connection_test) {
      $('demo-banner').textContent = 'Private Cloudflare test · TikTok account connection only. Uploads, publishing, and scheduling are disabled.';
      $('publish-button').disabled = true; $('media-input').disabled = true;
      $('auth-status').textContent = 'Private test: use your generated test access key. Public registration is disabled.';
    }
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
  if (connection) { toast(({ success: state.config?.connection_test ? 'TikTok connected. Publishing remains disabled for this test.' : 'Account connected. You’re ready to compose.', cancelled: 'Connection cancelled.', failed: 'Connection failed. Check platform permissions and try again.', no_accounts: 'No eligible Page or channel was found for this login.' })[connection] || 'Connection finished.'); history.replaceState(null, '', location.pathname + location.hash); }
}
setInterval(() => { if (state.user && !state.config?.connection_test && location.hash === '#history' && !document.hidden) loadHistory().catch(() => {}); }, 10000);
init();
