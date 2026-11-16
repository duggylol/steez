/* Streamer dashboard */
(() => {
  const h = SMP.h, $ = (id) => document.getElementById(id);
  let S = null;          // admin state from server
  let conn = null;
  let nowPlaying = null;
  let settingsDirty = false;

  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = SMP.icons[el.dataset.icon] || ''; });

  // ------------------------------------------------------------ api
  async function api(method, url, body) {
    const res = await fetch(url, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && url !== '/api/login' && url !== '/api/setup') { showAuth(false); throw new Error('Not logged in'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { SMP.toast(e.message, true); } };

  // ------------------------------------------------------------ auth
  let setupMode = false;
  function showAuth(setup) {
    setupMode = setup;
    $('app').hidden = true; $('auth').hidden = false;
    $('authTitle').textContent = setup ? 'Create your password' : 'Welcome back';
    $('authSub').textContent = setup ? 'First time here! Pick a password to protect your dashboard.' : 'Log in to your subathon dashboard.';
    $('authPw2Wrap').hidden = !setup;
    $('authBtn').textContent = setup ? 'Create & continue' : 'Log in';
    $('authPw').autocomplete = setup ? 'new-password' : 'current-password';
    $('authPw').focus();
  }
  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('authErr').textContent = '';
    const pw = $('authPw').value;
    if (setupMode && pw !== $('authPw2').value) { $('authErr').textContent = "Passwords don't match"; return; }
    try {
      await api('POST', setupMode ? '/api/setup' : '/api/login', { password: pw });
      $('authPw').value = ''; $('authPw2').value = '';
      start();
    } catch (err) { $('authErr').textContent = err.message; }
  });

  async function boot() {
    const a = await api('GET', '/api/auth');
    if (a.loggedIn) start(); else showAuth(a.setup);
  }

  function start() {
    $('auth').hidden = true; $('app').hidden = false;
    if (conn) return;
    conn = SMP.connect('admin', '', onMessage);
  }

  // ------------------------------------------------------------ live messages
  function onMessage(m) {
    switch (m.t) {
      case 'init':
        if (m.role !== 'admin') { showAuth(false); return; }
        S = m.state;
        renderAll();
        break;
      case 'timer': if (S) { S.timer = m.timer; renderTimer(); } break;
      case 'stats': if (S) { S.stats = m.stats; S.goals = m.goals; renderStats(); renderGoalBars(); } break;
      case 'feed': if (S) { S.feed.unshift(m.item); S.feed.length = Math.min(S.feed.length, 100); renderFeed(); } break;
      case 'status': if (S) { S.statuses = m.statuses; renderStatus(); } break;
      case 'chat': if (S) { S.chat.push(m.msg); if (S.chat.length > 60) S.chat.shift(); addChat(m.msg); } break;
      case 'clear': if (S) renderChat(); break;
      case 'nowPlaying': nowPlaying = m; renderNowPlaying(); break;
    }
  }

  // ------------------------------------------------------------ tabs
  function showTab() {
    const tab = (location.hash || '#dash').slice(1);
    const known = ['dash', 'media', 'goals', 'test', 'settings'];
    const t = known.includes(tab) ? tab : 'dash';
    known.forEach((k) => { $('tab-' + k).hidden = k !== t; });
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === t));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', showTab);
  showTab();

  // Don't re-render a list while the user is typing in it.
  const deferred = {};
  function renderSafe(id, fn) {
    const el = $(id);
    if (el && el.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) {
      deferred[id] = fn;
      return;
    }
    fn();
  }
  document.addEventListener('focusout', () => setTimeout(() => {
    for (const id of Object.keys(deferred)) {
      const el = $(id);
      if (!el.contains(document.activeElement)) { const fn = deferred[id]; delete deferred[id]; fn(); }
    }
  }, 50));

  function renderAll() {
    SMP.applyTheme(S.settings);
    $('brandTitle').textContent = S.settings.title || 'SUBATHON';
    renderTimer(); renderStats(); renderStatus(); renderFeed(); renderChat(); renderLinks();
    renderSafe('soundboard', renderSoundboard);
    renderSafe('mediaList', renderMedia);
    renderSafe('goalList', renderGoals);
    renderPriceFire();
    renderHow();
    if (!settingsDirty) fillSettings();
    $('mediaPaused').checked = !!S.settings.mediaPaused;
    renderBanner();
    document.querySelectorAll('[data-money]').forEach((b) => { b.querySelector('em').textContent = 'Donate ' + SMP.money(b.dataset.money, S.settings.currencySymbol); });
  }

  function renderBanner() {
    const todo = [];
    const chan = S.settings.channel || S.channelInUse; // Steez: blank = the Twitch account logged into Steez
    if (!chan) todo.push('set your Twitch username');
    if (S.settings.donation.provider === 'none') todo.push('connect a donation service (optional)');
    if (!S.media.length) todo.push('upload your sounds/videos');
    $('setupBanner').hidden = !!(chan && S.media.length);
    $('setupText').textContent = todo.join(' · ');
  }

  // ------------------------------------------------------------ timer
  function renderTimer() {
    if (!S) return;
    const t = S.timer;
    const rem = SMP.remaining(t, conn);
    $('bigTimer').textContent = SMP.fmtClock(rem).text;
    const st = $('timerState');
    st.textContent = t.ended ? 'Ended' : t.running ? '● Running' : 'Paused';
    st.className = 'chip' + (t.running ? ' running' : '') + (t.ended ? ' ended' : '');
    $('btnStartPause').textContent = t.running ? '❚❚ Pause timer' : t.ended ? 'Timer ended' : '▶ Start timer';
    $('btnStartPause').disabled = !t.running && rem <= 0;
    let hint = '';
    if (t.running) hint = 'Ends ' + new Date(conn.now() + rem).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    if (t.startedAt) hint += (hint ? ' · ' : '') + 'started ' + new Date(t.startedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    $('timerHint').textContent = hint || 'Press start when you go live. Time added while paused is kept.';
  }
  setInterval(renderTimer, 250);

  $('btnStartPause').addEventListener('click', safe(() => api('POST', '/api/timer', { action: S.timer.running ? 'pause' : 'start' })));
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', safe(() => api('POST', '/api/timer', { action: 'add', seconds: Number(b.dataset.add) }))));
  function parseHMS(v) {
    v = v.trim();
    if (!v) return null;
    if (/^\d+(\.\d+)?h$/i.test(v)) return parseFloat(v) * 3600;
    const parts = v.split(':').map(Number);
    if (parts.some((n) => isNaN(n))) return null;
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  $('btnSet').addEventListener('click', safe(async () => {
    const secs = parseHMS($('setTime').value);
    if (secs == null) throw new Error('Use HH:MM:SS, e.g. 12:00:00');
    await api('POST', '/api/timer', { action: 'set', seconds: secs });
    $('setTime').value = '';
    SMP.toast('Timer set to ' + SMP.fmtClock(secs * 1000).text);
  }));
  $('setTime').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnSet').click(); });

  // ------------------------------------------------------------ stats
  function renderStats() {
    const st = S.stats;
    $('stSubs').textContent = SMP.num(st.subs);
    $('stBits').textContent = SMP.num(st.bits);
    $('stMoney').textContent = SMP.money(st.donations, S.settings.currencySymbol);
    $('stTime').textContent = SMP.fmtDur(st.timeAdded || 0);
  }
  // Click a stat tile to correct it manually (e.g. subs that came in while the app was off)
  const statKeys = { stSubs: 'subs', stBits: 'bits', stMoney: 'donations' };
  Object.keys(statKeys).forEach((id) => $(id).closest('.stat-tile').addEventListener('click', safe(async () => {
    const k = statKeys[id];
    const v = prompt('Set total ' + k + ' (this only changes the counter, not the timer):', S.stats[k]);
    if (v == null || v === '' || isNaN(Number(v))) return;
    await api('PUT', '/api/stats', { [k]: Number(v) });
  })));

  // ------------------------------------------------------------ status
  function renderStatus() {
    const st = S.statuses;
    const tw = st.twitch || {}, dn = st.donations || {};
    $('dTwitch').className = 'dot ' + tw.status;
    $('dDon').className = 'dot ' + (dn.status === 'off' ? '' : dn.status);
    $('dTv').className = 'dot ' + (st.tvs > 0 ? 'connected' : '');
    $('tvCountTxt').textContent = st.tvs > 0 ? st.tvs + ' TV screen' + (st.tvs > 1 ? 's' : '') + ' on' : 'No TV connected';
    $('tvCount2').textContent = st.tvs || 0;
    const label = (s) => ({ connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', error: 'Error', off: 'Off', disconnected: 'Not connected' }[s] || s);
    $('connList').innerHTML = '';
    [['Twitch chat', tw, S.channelInUse ? '#' + S.channelInUse : 'No username set'],
      ['Donations', dn, S.settings.donation.provider === 'none' ? 'Not set up' : S.settings.donation.provider],
      ['TV screens', { status: st.tvs > 0 ? 'connected' : 'off' }, (st.tvs || 0) + ' connected']].forEach(([name, s, extra]) => {
      $('connList').appendChild(h('div', { class: 'st-row' }, [
        h('i', { class: 'dot ' + (s.status === 'off' ? '' : s.status) }), h('span', { text: name + ' — ' + label(s.status) }),
        h('small', { text: s.detail && s.status !== 'connected' ? s.detail : extra }),
      ]));
    });
  }
  $('btnReconnect').addEventListener('click', safe(async () => { await api('POST', '/api/reconnect'); SMP.toast('Reconnecting…'); }));

  function renderNowPlaying() {
    const box = $('nowPlaying');
    box.innerHTML = '';
    if (nowPlaying && nowPlaying.item) {
      box.appendChild(h('div', { class: 'np-eq' }, [h('i'), h('i'), h('i')]));
      box.appendChild(h('div', {}, [h('b', { text: nowPlaying.item.name }), h('div', { class: 'hint', text: (nowPlaying.item.by ? 'from ' + nowPlaying.item.by : '') + (nowPlaying.queue ? ' · ' + nowPlaying.queue + ' in queue' : '') })]));
    } else box.appendChild(h('div', { class: 'np-idle', text: 'Nothing playing' }));
  }
  document.querySelectorAll('[data-tv]').forEach((b) => b.addEventListener('click', safe(async () => {
    await api('POST', '/api/tv/control', { action: b.dataset.tv });
    if (!S.statuses.tvs) SMP.toast('No TV screen is connected right now', true);
    else SMP.toast({ skip: 'Skipped', clear: 'Queue cleared', reload: 'TV reloading', 'test-sound': 'Test sound sent to TV' }[b.dataset.tv]);
  })));
  $('mediaPaused').addEventListener('change', safe(async (e) => {
    await api('PUT', '/api/settings', { mediaPaused: e.target.checked });
    SMP.toast(e.target.checked ? 'Viewer media paused' : 'Viewer media on');
  }));

  // ------------------------------------------------------------ feed + chat
  function renderFeed() {
    const box = $('feedList');
    box.innerHTML = '';
    if (!S.feed.length) { box.appendChild(h('div', { class: 'empty', text: 'No activity yet. Try the Test lab!' })); return; }
    S.feed.slice(0, 50).forEach((f) => {
      const info = SMP.eventInfo(f, S.settings.currencySymbol);
      const meta = [SMP.timeAgo(f.ts)];
      if (f.media && f.media.length) meta.push('▶ ' + f.media.join(', '));
      if (f.message) meta.push('“' + f.message + '”');
      box.appendChild(h('div', { class: 'fl-item k-' + info.kind }, [
        h('div', { class: 'fl-ico', html: info.icon }),
        h('div', { class: 'fl-body' }, [
          h('div', { class: 'fl-line' }, [h('b', { text: info.title }), ' ' + info.action, f.test ? h('span', { class: 'test-tag', text: 'TEST' }) : null]),
          h('div', { class: 'fl-meta', text: meta.join(' · ') }),
        ]),
        f.added > 0 ? h('div', { class: 'fl-add', text: '+' + SMP.fmtDur(f.added) }) : null,
      ]));
    });
  }
  $('btnClearFeed').addEventListener('click', safe(async () => { await api('POST', '/api/feed/clear'); }));

  function chatLine(c) {
    const line = h('div', {}, [h('b', { style: { color: c.color || 'var(--accent)' }, text: c.user }), c.action ? ' ' : ': ']);
    const span = h('span');
    span.appendChild(SMP.chatFragment(c.text || '', c.emotes));
    line.appendChild(span);
    return line;
  }
  function renderChat() {
    const box = $('chatMirror');
    box.innerHTML = '';
    $('chatChan').textContent = S.channelInUse ? '#' + S.channelInUse : '';
    if (!S.chat.length) box.appendChild(h('div', { class: 'empty', id: 'chatEmpty', text: S.channelInUse ? 'Waiting for chat messages…' : 'Set your Twitch username in Settings' }));
    S.chat.forEach((c) => box.appendChild(chatLine(c)));
    box.scrollTop = box.scrollHeight;
  }
  function addChat(c) {
    const box = $('chatMirror');
    const e = $('chatEmpty'); if (e) e.remove();
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.appendChild(chatLine(c));
    while (box.children.length > 80) box.firstChild.remove();
    if (stick) box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------ links
  function linkRow(url) {
    const input = h('input', { type: 'text', readonly: true, value: url });
    input.addEventListener('focus', () => input.select());
    return h('div', { class: 'link-row' }, [input,
      h('button', { class: 'btn sm', html: SMP.icons.copy + 'Copy', onclick: () => { copy(url); } }),
      h('a', { class: 'btn sm', href: url, target: '_blank', text: 'Open' })]);
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => SMP.toast('Copied!'), () => {
      const t = h('textarea', {}, text); document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); SMP.toast('Copied!');
    });
  }
  function renderLinks() {
    const lan = S.lanUrls.length ? S.lanUrls : [location.origin];
    $('tvCodeChip').textContent = S.tvCode;
    $('tvLinks').innerHTML = '';
    lan.forEach((u) => $('tvLinks').appendChild(linkRow(u + '/tv/' + S.tvCode)));
    $('tvShort').textContent = lan[0] + '/tv';
    $('openTv').href = '/tv/' + S.tvCode;
    $('viewerLinks').innerHTML = '';
    const pub = S.settings.publicUrl;
    if (pub) $('viewerLinks').appendChild(linkRow(pub + '/'));
    lan.forEach((u) => $('viewerLinks').appendChild(linkRow(u + '/')));
    if (!pub) $('viewerLinks').appendChild(h('p', { class: 'hint', html: 'This link only works on your home Wi-Fi. To share it with viewers, put the app online — see <b>README.md</b> (“Let viewers in”).' }));
    $('kofiUrl').textContent = (pub || lan[0]) + '/webhook/kofi';
  }
  $('btnRegen').addEventListener('click', safe(async () => {
    if (!confirm('Make a new TV code? The TV will disconnect and you will need to open the new link on it.')) return;
    await api('POST', '/api/tv/regen-code');
  }));

  // ------------------------------------------------------------ soundboard
  function renderSoundboard() {
    const box = $('soundboard');
    box.innerHTML = '';
    if (!S.media.length) { box.appendChild(h('a', { class: 'empty', href: '#media', text: 'Upload your first sound or video →', style: { 'grid-column': '1 / -1', display: 'block' } })); return; }
    S.media.forEach((m) => {
      box.appendChild(h('button', { class: 'sb-btn' + (m.enabled ? '' : ' off'), title: 'Play on TV', onclick: () => playOnTv(m) }, [
        h('span', { html: SMP.icons[m.type] || '' }), h('b', { text: m.name }),
        h('small', { class: 'hint', text: priceText(m) || 'No price' }),
      ]));
    });
  }
  const playOnTv = safe(async (m) => {
    await api('POST', '/api/media/' + m.id + '/play');
    SMP.toast(S.statuses.tvs ? '▶ ' + m.name : 'Sent — but no TV screen is connected', !S.statuses.tvs);
  });

  function priceText(m) {
    const p = m.prices || {}, out = [];
    if (p.bits) out.push(SMP.num(p.bits) + ' bits');
    if (p.subs) out.push(p.subs + ' sub' + (p.subs > 1 ? 's' : ''));
    if (p.donation) out.push(SMP.money(p.donation, S.settings.currencySymbol));
    return out.join(' · ');
  }

  // ------------------------------------------------------------ media
  function renderHow() {
    const pfx = S.settings.triggerPrefix || '#', cs = S.settings.currencySymbol;
    $('howText').innerHTML = '';
    $('howText').append(
      'Give each item a price in bits, gifted subs and/or donations (leave blank to skip). ',
      h('b', { text: 'With a trigger code: ' }), `a viewer includes ${pfx}code in their cheer, resub or donation message and pays at least the price. `,
      h('b', { text: 'Without a code: ' }),
      S.settings.matchMode === 'tier'
        ? 'the most expensive item their amount covers plays.'
        : `the item whose price matches the amount exactly plays (e.g. exactly 500 bits, or exactly ${cs}5).`,
      ' Gift bombs use the number of subs gifted.'
    );
  }

  function renderMedia() {
    const box = $('mediaList');
    box.innerHTML = '';
    if (!S.media.length) { box.appendChild(h('div', { class: 'empty', text: 'Nothing uploaded yet. Your sounds, videos and images will show up here.' })); return; }
    S.media.forEach((m, idx) => box.appendChild(mediaCard(m, idx)));
  }

  function mediaCard(m, idx) {
    const node = $('tplMedia').content.firstElementChild.cloneNode(true);
    node.classList.toggle('disabled', !m.enabled);
    const pv = node.querySelector('.mc-preview');
    const url = '/media/' + m.file;
    if (m.type === 'image') pv.appendChild(h('img', { src: url, alt: '' }));
    else if (m.type === 'video') pv.appendChild(h('video', { src: url, controls: true, preload: 'metadata' }));
    else pv.appendChild(h('div', { class: 'audio-prev' }, [h('span', { html: SMP.icons.audio }), h('audio', { src: url, controls: true, preload: 'none' })]));
    node.querySelector('.type-pill').textContent = m.type;
    node.querySelector('.pfx').textContent = S.settings.triggerPrefix || '#';
    node.querySelector('.don-lbl').textContent = 'Donation (' + S.settings.currencySymbol + ')';
    node.querySelector('.f-duration').hidden = m.type !== 'image';
    node.querySelector('.f-max').hidden = m.type === 'image';

    node.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') el.checked = f === 'enabled' ? m.enabled !== false : m[f] !== false;
      else el.value = m[f] != null ? m[f] : '';
      if (f === 'maxSeconds' && !m.maxSeconds) el.value = '';
    });
    node.querySelectorAll('[data-p]').forEach((el) => { const v = (m.prices || {})[el.dataset.p]; el.value = v != null ? v : ''; });
    const volOut = node.querySelector('.vol-out');
    const volIn = node.querySelector('[data-f=volume]');
    volOut.textContent = volIn.value + '%';
    volIn.addEventListener('input', () => { volOut.textContent = volIn.value + '%'; });

    const summary = node.querySelector('.mc-summary');
    const drawSummary = () => {
      summary.innerHTML = '';
      const p = m.prices || {};
      const cs = S.settings.currencySymbol, pfx = S.settings.triggerPrefix || '#';
      if (p.bits) summary.appendChild(h('span', { class: 'chip bits', html: SMP.icons.bits + SMP.num(p.bits) + ' bits' }));
      if (p.subs) summary.appendChild(h('span', { class: 'chip subs', html: SMP.icons.gift + p.subs + ' gifted sub' + (p.subs > 1 ? 's' : '') }));
      if (p.donation) summary.appendChild(h('span', { class: 'chip money', html: SMP.icons.money + SMP.money(p.donation, cs) }));
      if (m.code) summary.appendChild(h('span', { class: 'chip code', text: pfx + m.code }));
      if (!p.bits && !p.subs && !p.donation) summary.appendChild(h('span', { class: 'warn', text: '⚠ No price set — viewers can’t trigger this (you can still play it from the soundboard).' }));
      if (!m.enabled) summary.appendChild(h('span', { class: 'warn', text: 'Disabled' }));
    };
    drawSummary();

    let t = null;
    const save = () => {
      clearTimeout(t);
      t = setTimeout(safe(async () => {
        const body = { prices: {} };
        node.querySelectorAll('[data-f]').forEach((el) => { body[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
        node.querySelectorAll('[data-p]').forEach((el) => { body.prices[el.dataset.p] = el.value; });
        const r = await api('PUT', '/api/media/' + m.id, body);
        Object.assign(m, r.item);
        node.classList.toggle('disabled', !m.enabled);
        drawSummary();
        SMP.toast('Saved “' + m.name + '”');
      }), 500);
    };
    node.querySelectorAll('[data-f],[data-p]').forEach((el) => el.addEventListener('change', save));

    node.querySelector('[data-a=play]').addEventListener('click', () => playOnTv(m));
    node.querySelector('[data-a=delete]').addEventListener('click', safe(async () => {
      if (!confirm('Delete “' + m.name + '”? This removes the file too.')) return;
      await api('DELETE', '/api/media/' + m.id);
      SMP.toast('Deleted');
    }));
    const move = (dir) => safe(async () => {
      const ids = S.media.map((x) => x.id);
      const j = idx + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[idx], ids[j]] = [ids[j], ids[idx]];
      await api('POST', '/api/media/reorder', { ids });
    });
    node.querySelector('[data-a=up]').addEventListener('click', move(-1));
    node.querySelector('[data-a=down]').addEventListener('click', move(1));
    node.querySelector('[data-a=replace]').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) uploadFile(f, '/api/media/' + m.id + '/file');
    });
    return node;
  }

  // uploads
  function uploadFile(file, url) {
    const row = h('div', { class: 'upload-row' }, [h('span', { text: file.name }), h('div', { class: 'progress' }, h('b', { style: { width: '0%' } })), h('span', { class: 'pct', text: '0%' })]);
    $('uploads').appendChild(row);
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url || '/api/media');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      row.querySelector('b').style.width = p + '%';
      row.querySelector('.pct').textContent = p + '%';
    };
    xhr.onload = () => {
      let d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) { SMP.toast('Uploaded ' + file.name); row.remove(); }
      else { SMP.toast(d.error || 'Upload failed', true); row.querySelector('.pct').textContent = 'Failed'; setTimeout(() => row.remove(), 4000); }
    };
    xhr.onerror = () => { SMP.toast('Upload failed', true); row.remove(); };
    xhr.send(fd);
  }
  $('fileInput').addEventListener('change', (e) => { [...e.target.files].forEach((f) => uploadFile(f)); e.target.value = ''; });
  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => [...e.dataTransfer.files].forEach((f) => uploadFile(f)));

  // ------------------------------------------------------------ goals
  const METRICS = { subs: 'Subs', bits: 'Bits', donations: 'Donations', time: 'Hours added', manual: 'Manual' };
  function goalNum(g) {
    if (g.metric === 'donations') return SMP.money(g.current, S.settings.currencySymbol) + ' / ' + SMP.money(g.target, S.settings.currencySymbol);
    if (g.metric === 'time') return g.current + 'h / ' + g.target + 'h';
    return SMP.num(g.current) + ' / ' + SMP.num(g.target);
  }
  function renderGoals() {
    const box = $('goalList');
    box.innerHTML = '';
    if (!S.goals.length) { box.appendChild(h('div', { class: 'empty', text: 'No goals yet. Add things like “50 subs: spicy noodle challenge”.' })); return; }
    S.goals.forEach((g, idx) => {
      const sel = h('select', {}, Object.keys(METRICS).map((k) => h('option', { value: k, text: METRICS[k], selected: g.metric === k })));
      const title = h('input', { type: 'text', value: g.title, placeholder: 'Goal title' });
      const target = h('input', { type: 'number', min: 0, step: 'any', value: g.target });
      const prog = h('input', { type: 'number', min: 0, step: 'any', value: g.progress || 0 });
      const progField = h('label', { class: 'field' }, [h('span', { text: 'Progress' }), prog]);
      progField.hidden = g.metric !== 'manual';
      const desc = h('input', { type: 'text', value: g.description || '', placeholder: 'What happens when it’s reached (shown to viewers)' });
      const done = h('input', { type: 'checkbox', checked: !!g.done });
      const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
      const card = h('div', { class: 'card goal-card goal' + (g.done || g.current >= g.target ? ' done' : ''), 'data-goal': g.id }, [
        h('div', { class: 'gc-fields' }, [
          h('label', { class: 'field' }, [h('span', { text: 'Title' }), title]),
          h('label', { class: 'field' }, [h('span', { text: 'Counts' }), sel]),
          h('label', { class: 'field' }, [h('span', { text: 'Target' }), target]),
          progField,
        ]),
        h('div', { class: 'gc-actions' }, [
          h('button', { class: 'btn sm', text: '↑', title: 'Move up', onclick: move(idx, -1) }),
          h('button', { class: 'btn sm', text: '↓', title: 'Move down', onclick: move(idx, 1) }),
          h('button', { class: 'btn sm danger', text: 'Delete', onclick: safe(async () => { if (confirm('Delete this goal?')) await api('DELETE', '/api/goals/' + g.id); }) }),
        ]),
        h('label', { class: 'field gc-desc' }, [h('span', { text: 'Reward / description' }), desc]),
        h('div', { class: 'gc-bar' }, [h('div', { class: 'progress' }, h('b', { style: { width: pct + '%' } })), h('span', { class: 'gc-num', text: goalNum(g) }),
          h('label', { class: 'switch sm-switch' }, [done, h('i'), 'Mark done'])]),
      ]);
      const save = safe(async () => {
        await api('PUT', '/api/goals/' + g.id, { title: title.value, metric: sel.value, target: target.value, progress: prog.value, description: desc.value, done: done.checked });
        SMP.toast('Goal saved');
      });
      [title, sel, target, prog, desc, done].forEach((el) => el.addEventListener('change', save));
      sel.addEventListener('change', () => { progField.hidden = sel.value !== 'manual'; });
      box.appendChild(card);
    });
    function move(idx, dir) {
      return safe(async () => {
        const ids = S.goals.map((x) => x.id);
        const j = idx + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[idx], ids[j]] = [ids[j], ids[idx]];
        await api('POST', '/api/goals/reorder', { ids });
      });
    }
  }
  function renderGoalBars() {
    // live progress update without rebuilding inputs
    S.goals.forEach((g) => {
      const card = document.querySelector('[data-goal="' + g.id + '"]');
      if (!card) return;
      const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
      card.querySelector('.progress b').style.width = pct + '%';
      card.querySelector('.gc-num').textContent = goalNum(g);
      card.classList.toggle('done', !!(g.done || g.current >= g.target));
    });
  }
  $('btnAddGoal').addEventListener('click', safe(async () => {
    await api('POST', '/api/goals', { title: 'New goal', metric: 'subs', target: 25 });
    setTimeout(() => { const last = $('goalList').lastElementChild; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = last.querySelector('input'); i && i.select(); } }, 300);
  }));

  // ------------------------------------------------------------ test lab
  const QUICK = [
    ['q-sub', 'sub', 'Prime sub', { type: 'sub', tier: 'prime' }],
    ['q-sub', 'sub', 'Tier 1 sub', { type: 'sub', tier: 'tier1' }],
    ['q-sub', 'sub', 'Tier 3 sub', { type: 'sub', tier: 'tier3' }],
    ['q-sub', 'sub', 'Resub', { type: 'resub', tier: 'tier1' }],
    ['q-gift', 'gift', 'Gift 1 sub', { type: 'gift', tier: 'tier1' }],
    ['q-gift', 'gift', 'Gift bomb ×5', { type: 'giftbomb', amount: 5 }],
    ['q-gift', 'gift', 'Gift bomb ×20', { type: 'giftbomb', amount: 20 }],
    ['q-bits', 'bits', '100 bits', { type: 'bits', amount: 100 }],
    ['q-bits', 'bits', '500 bits', { type: 'bits', amount: 500 }],
    ['q-bits', 'bits', '1,000 bits', { type: 'bits', amount: 1000 }],
    ['q-money', 'money', 'Donate 5', { type: 'donation', amount: 5 }],
    ['q-money', 'money', 'Donate 25', { type: 'donation', amount: 25 }],
  ];
  QUICK.forEach(([cls, icon, label, ev]) => {
    const b = h('button', { class: 'btn ' + cls, onclick: () => fire(ev) }, [h('span', { html: SMP.icons[icon] }), h('em', { text: label })]);
    if (ev.type === 'donation') b.dataset.money = ev.amount;
    $('quickGrid').appendChild(b);
  });
  async function fireRaw(ev) {
    const body = { user: $('tUser').value, message: $('tMsg').value, real: $('tReal').checked, tier: 'tier1', ...ev };
    if (body.type === 'bits' && body.message.indexOf('Cheer') < 0) body.message = ('Cheer' + body.amount + ' ' + body.message).trim();
    await api('POST', '/api/test', body);
  }
  const fire = safe(async (ev) => {
    await fireRaw(ev);
    SMP.toast('Test event sent' + ($('tReal').checked ? ' (counted for real)' : ''));
  });
  $('btnFire').addEventListener('click', () => fire({ type: $('tType').value, amount: Number($('tAmount').value), tier: $('tTier').value }));
  $('btnTestChat').addEventListener('click', safe(async () => {
    const text = prompt('Chat message to show on the TV:', 'Hello from the test lab! Kappa');
    if (text == null) return;
    await api('POST', '/api/test-chat', { text: text === 'Hello from the test lab! Kappa' ? '' : text });
  }));
  $('btnCheck').addEventListener('click', safe(async () => {
    const r = await api('POST', '/api/test-match', { currency: $('mCur').value, amount: $('mAmount').value, message: $('mMsg').value });
    const out = $('matchOut');
    out.innerHTML = '';
    if (!r.matched.length) out.appendChild(h('span', { class: 'hint', text: 'Nothing would play for this event (it still adds time).' }));
    else { out.appendChild(h('span', { class: 'hint', text: 'Would play:' })); r.matched.forEach((m) => out.appendChild(h('span', { class: 'chip code', text: '▶ ' + m.name }))); }
  }));
  function renderPriceFire() {
    const box = $('priceFire');
    box.innerHTML = '';
    const priced = S.media.filter((m) => m.prices && (m.prices.bits || m.prices.subs || m.prices.donation));
    if (!priced.length) { box.appendChild(h('div', { class: 'empty', text: 'Set prices on your media to test them here.' })); return; }
    const pfx = S.settings.triggerPrefix || '#';
    priced.forEach((m) => {
      const msg = m.code ? pfx + m.code : '';
      const row = h('div', { class: 'pf-row' }, [h('b', { text: m.name })]);
      if (m.prices.bits) row.appendChild(h('button', { class: 'btn sm', html: SMP.icons.bits + SMP.num(m.prices.bits) + ' bits', onclick: () => fire({ type: 'bits', amount: m.prices.bits, message: msg }) }));
      if (m.prices.subs) row.appendChild(h('button', { class: 'btn sm', html: SMP.icons.gift + m.prices.subs + ' subs', onclick: () => fire(m.prices.subs === 1 ? { type: 'gift', message: msg } : { type: 'giftbomb', amount: m.prices.subs, message: msg }) }));
      if (m.prices.donation) row.appendChild(h('button', { class: 'btn sm', html: SMP.icons.money + SMP.money(m.prices.donation, S.settings.currencySymbol), onclick: () => fire({ type: 'donation', amount: m.prices.donation, message: msg }) }));
      box.appendChild(row);
    });
  }
  let demoRunning = false;
  $('btnDemo').addEventListener('click', safe(async () => {
    if (demoRunning) return;
    demoRunning = true;
    $('btnDemo').disabled = true; $('btnDemo').textContent = 'Demo running…';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const real = $('tReal').checked; $('tReal').checked = false;
    const pick = (cur) => S.media.find((m) => m.enabled && m.prices && m.prices[cur]);
    const send = (ev) => api('POST', '/api/test', { real: false, tier: 'tier1', message: '', ...ev });
    const chat = (user, text) => api('POST', '/api/test-chat', { user, text });
    try {
      await chat('NightOwl', 'is the subathon starting??');
      await wait(1200); await chat('CoffeeGoblin', 'LETS GOOO');
      await wait(1500); await send({ type: 'sub', user: 'NightOwl', tier: 'tier1', message: 'Happy subathon!' });
      await wait(3500); await chat('SleepyPanda', 'he looks so tired lol');
      const b = pick('bits');
      await wait(1200); await send({ type: 'bits', user: 'SleepyPanda', amount: b ? b.prices.bits : 500, message: 'Cheer' + (b ? b.prices.bits : 500) + ' WAKE UP ' + (b && b.code ? (S.settings.triggerPrefix || '#') + b.code : '') });
      await wait(4500); await send({ type: 'giftbomb', user: 'xXGamerXx', amount: (pick('subs') || { prices: { subs: 5 } }).prices.subs });
      await wait(4500); await chat('ModSquad', 'chat is going crazy');
      const d = pick('donation');
      await wait(1200); await send({ type: 'donation', user: 'pixelpirate', amount: d ? d.prices.donation : 10, message: 'stay strong! ' + (d && d.code ? (S.settings.triggerPrefix || '#') + d.code : '') });
      SMP.toast('Demo finished');
    } finally {
      $('tReal').checked = real;
      demoRunning = false; $('btnDemo').disabled = false; $('btnDemo').textContent = '▶ Run demo';
    }
  }));

  // ------------------------------------------------------------ settings
  const SW = [['#a970ff', '#00e5ff'], ['#ff4d8d', '#ffb86b'], ['#3ddc97', '#00b4d8'], ['#ff5c5c', '#ffd93d'], ['#4d96ff', '#c77dff'], ['#f72585', '#7209b7']];
  SW.forEach(([a, b]) => $('swatches').appendChild(h('button', { type: 'button', title: 'Use these colors', style: { background: `linear-gradient(135deg, ${a}, ${b})` }, onclick: () => { $('sAccent').value = a; $('sAccent2').value = b; markDirty(); SMP.applyTheme({ accent: a, accent2: b }); } })));

  function fillSettings() {
    const s = S.settings;
    $('sChannel').value = s.channel || '';
    $('sChannel').placeholder = S.twitchLogin || 'yourname';
    $('sProvider').value = s.donation.provider;
    $('sSlToken').value = s.donation.provider === 'streamlabs' ? s.donation.token : '';
    $('sSeToken').value = s.donation.provider === 'streamelements' ? s.donation.token : '';
    $('sKofiToken').value = s.donation.kofiToken || '';
    document.querySelectorAll('[data-time]').forEach((el) => { el.value = +(s.time[el.dataset.time] / 60).toFixed(2); });
    $('sMult').value = s.time.multiplier; $('sInitial').value = s.time.initialHours; $('sCap').value = s.time.capHours;
    $('sPrefix').value = s.triggerPrefix; $('sCurrency').value = s.currencySymbol; $('sMatch').value = s.matchMode;
    $('sTitle').value = s.title; $('sAccent').value = s.accent; $('sAccent2').value = s.accent2;
    $('sShowChat').checked = s.tv.showChat; $('sShowGoals').checked = s.tv.showGoals; $('sShowFeed').checked = s.tv.showFeed; $('sShowNames').checked = s.tv.showNames !== false;
    $('sAlertSecs').value = s.tv.alertSeconds; $('sVolume').value = s.tv.volume; $('volLbl').textContent = s.tv.volume + '%';
    $('sIntro').value = s.viewer.intro; $('sShowRecent').checked = s.viewer.showRecent; $('sPublicUrl').value = s.publicUrl || '';
    $('perDollarLbl').textContent = 'Per ' + s.currencySymbol + '1 donated';
    showProvider();
    settingsDirty = false;
    $('btnSave').textContent = 'Save settings';
  }
  function showProvider() {
    const p = $('sProvider').value;
    $('provStreamlabs').hidden = p !== 'streamlabs';
    $('provStreamelements').hidden = p !== 'streamelements';
    $('provKofi').hidden = p !== 'kofi';
  }
  function markDirty() { settingsDirty = true; $('btnSave').textContent = 'Save settings •'; }
  $('sProvider').addEventListener('change', showProvider);
  $('sVolume').addEventListener('input', () => { $('volLbl').textContent = $('sVolume').value + '%'; });
  $('tab-settings').addEventListener('input', (e) => { if (e.target.closest('.card') && !e.target.closest('.danger-zone') && !['pwCur', 'pwNew'].includes(e.target.id)) markDirty(); });
  $('tab-settings').addEventListener('change', (e) => { if (e.target.closest('.card') && !['pwCur', 'pwNew'].includes(e.target.id)) markDirty(); });

  $('btnSave').addEventListener('click', safe(async () => {
    const p = $('sProvider').value;
    const time = {};
    document.querySelectorAll('[data-time]').forEach((el) => { time[el.dataset.time] = Math.round(Number(el.value || 0) * 60); });
    Object.assign(time, { multiplier: Number($('sMult').value || 1), initialHours: Number($('sInitial').value || 0), capHours: Number($('sCap').value || 0) });
    const body = {
      channel: $('sChannel').value, title: $('sTitle').value, accent: $('sAccent').value, accent2: $('sAccent2').value,
      triggerPrefix: $('sPrefix').value, currencySymbol: $('sCurrency').value, matchMode: $('sMatch').value, publicUrl: $('sPublicUrl').value,
      time,
      donation: { provider: p, token: p === 'streamlabs' ? $('sSlToken').value : p === 'streamelements' ? $('sSeToken').value : '', kofiToken: $('sKofiToken').value },
      tv: { showChat: $('sShowChat').checked, showGoals: $('sShowGoals').checked, showFeed: $('sShowFeed').checked, showNames: $('sShowNames').checked, alertSeconds: Number($('sAlertSecs').value), volume: Number($('sVolume').value) },
      viewer: { intro: $('sIntro').value, showRecent: $('sShowRecent').checked },
    };
    settingsDirty = false;
    await api('PUT', '/api/settings', body);
    SMP.toast('Settings saved');
  }));

  $('btnPw').addEventListener('click', safe(async () => {
    await api('POST', '/api/password', { current: $('pwCur').value, password: $('pwNew').value });
    $('pwCur').value = ''; $('pwNew').value = '';
    SMP.toast('Password changed');
  }));
  $('btnLogout').addEventListener('click', safe(async () => { await api('POST', '/api/logout'); location.reload(); }));
  $('btnResetTimer').addEventListener('click', safe(async () => {
    if (!confirm('Reset the timer to ' + S.settings.time.initialHours + ' hours and stop it?')) return;
    await api('POST', '/api/timer', { action: 'reset' });
    SMP.toast('Timer reset');
  }));
  $('btnResetStats').addEventListener('click', safe(async () => {
    if (!confirm('Reset subs, bits, donations and time-added counters to zero and clear the activity list?')) return;
    await api('POST', '/api/stats/reset');
    SMP.toast('Stats reset');
  }));

  window.addEventListener('beforeunload', (e) => { if (settingsDirty) { e.preventDefault(); e.returnValue = ''; } });

  boot().catch((e) => SMP.toast(e.message, true));
})();
