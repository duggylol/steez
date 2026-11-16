/* Public viewer page */
(() => {
  const h = SMP.h, $ = (id) => document.getElementById(id);
  let S = null, filter = 'all', lastRem = null;
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = SMP.icons[el.dataset.icon] || ''; });

  const conn = SMP.connect('public', '', (m) => {
    if (m.t === 'init') { S = m.state; renderAll(); }
    else if (!S) return;
    else if (m.t === 'timer') { S.timer = m.timer; renderTimer(true); }
    else if (m.t === 'stats') { S.stats = m.stats; S.goals = m.goals; renderStats(); renderGoals(); }
    else if (m.t === 'feed') { S.feed.unshift(m.item); S.feed.length = Math.min(S.feed.length, 15); renderRecent(true); }
  }, (ok) => { $('connTxt').textContent = ok ? 'connected' : 'reconnecting…'; });

  function renderAll() {
    const s = S.settings;
    SMP.applyTheme(s);
    document.title = (s.title || 'Subathon') + (s.channel ? ' · ' + s.channel : '');
    $('title').textContent = s.title || 'SUBATHON';
    $('intro').textContent = s.viewer.intro || '';
    $('intro').hidden = !s.viewer.intro;
    if (s.channel) { $('twitchLink').hidden = false; $('twitchLink').href = 'https://twitch.tv/' + encodeURIComponent(s.channel); $('twitchName').textContent = s.channel; }
    $('fDon').hidden = !s.donationsEnabled;
    renderRules(); renderTimer(); renderStats(); renderGoals(); renderMenu(); renderRecent();
  }

  function renderTimer(fromUpdate) {
    if (!S) return;
    const t = S.timer;
    const rem = SMP.remaining(t, conn);
    const el = $('timer');
    el.textContent = SMP.fmtClock(rem).text;
    if (fromUpdate && lastRem != null && rem > lastRem + 1500) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    lastRem = rem;
    const pill = $('statePill');
    pill.className = 'live-pill' + (t.ended ? ' ended' : t.running ? '' : ' paused');
    $('stateTxt').textContent = t.ended ? 'COMPLETE' : t.running ? 'LIVE' : 'PAUSED';
    $('timerLabel').textContent = t.ended ? 'THE SUBATHON IS OVER — THANK YOU!' : 'TIME LEFT ON THE CLOCK';
    $('timerSub').textContent = t.running ? 'Ends around ' + new Date(conn.now() + rem).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : t.ended ? '' : 'The clock is paused';
  }
  setInterval(() => renderTimer(false), 250);

  function renderStats() {
    const st = S.stats, s = S.settings;
    $('sSubs').textContent = SMP.num(st.subs);
    $('sBits').textContent = SMP.num(st.bits);
    $('sMoney').textContent = SMP.money(st.donations, s.currencySymbol);
    $('moneyStat').hidden = !s.donationsEnabled && !st.donations;
    $('sTime').textContent = SMP.fmtDur(st.timeAdded || 0);
  }

  function renderRules() {
    const s = S.settings, t = s.time, box = $('rules');
    box.innerHTML = '';
    const mult = Number(t.multiplier) || 1;
    if (mult !== 1) box.appendChild(h('span', { class: 'chip mult', text: '⚡ ' + mult + '× TIME RIGHT NOW' }));
    const add = (cls, icon, text) => box.appendChild(h('span', { class: 'chip ' + cls, html: SMP.icons[icon] + text }));
    if (t.tier1) add('subs', 'sub', '1 sub = +' + SMP.fmtDur(t.tier1));
    if (t.tier3 && t.tier3 !== t.tier1) add('subs', 'sub', 'Tier 3 = +' + SMP.fmtDur(t.tier3));
    if (t.per100Bits) add('bits', 'bits', '100 bits = +' + SMP.fmtDur(t.per100Bits));
    if (t.perDollar && s.donationsEnabled) add('money', 'money', SMP.money(1, s.currencySymbol) + ' = +' + SMP.fmtDur(t.perDollar));
  }

  function goalNum(g) {
    const cs = S.settings.currencySymbol;
    if (g.metric === 'donations') return SMP.money(g.current, cs) + ' / ' + SMP.money(g.target, cs);
    if (g.metric === 'time') return g.current + 'h / ' + g.target + 'h';
    const unit = g.metric === 'subs' ? ' subs' : g.metric === 'bits' ? ' bits' : '';
    return SMP.num(g.current) + ' / ' + SMP.num(g.target) + unit;
  }
  function renderGoals() {
    const box = $('goals');
    box.innerHTML = '';
    $('goalsSec').hidden = !S.goals.length;
    let nextFound = false;
    S.goals.forEach((g) => {
      const done = g.done || (g.target > 0 && g.current >= g.target);
      const isNext = !done && !nextFound;
      if (isNext) nextFound = true;
      const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : done ? 100 : 0;
      box.appendChild(h('div', { class: 'card goal' + (done ? ' done' : '') + (isNext ? ' next' : '') }, [
        h('div', { class: 'goal-top' }, [h('div', { class: 'goal-title', text: g.title }), h('div', { class: 'goal-num', text: goalNum(g) })]),
        h('div', { class: 'progress' }, h('b', { style: { width: pct + '%' } })),
        g.description ? h('p', { class: 'goal-desc', text: g.description }) : null,
      ]));
    });
  }

  const TT_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2h-3.3v13.3a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.3 6.3 0 1 0 5.3 6.2V8.6a8 8 0 0 0 4.7 1.5V6.8a4.7 4.7 0 0 1-4.7-4.8z"/></svg>';
  const safeImg = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
  const hasTt = (m) => !!(m.tiktok && m.tiktok.length);
  const giftLabel = (g) => (Number(g.minCount) > 1 ? g.minCount + '× ' : '') + (g.gift || 'Gift');

  function renderMenu() {
    const s = S.settings, pfx = s.triggerPrefix || '#', cs = s.currencySymbol;
    const anyTt = S.media.some(hasTt);
    $('fTt').hidden = !anyTt;
    if (!anyTt && filter === 'tiktok') {
      filter = 'all';
      document.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('on', x.dataset.f === 'all'));
    }
    const tt = s.tiktokEnabled || anyTt;
    const how = $('how');
    how.innerHTML = '';
    const ways = ['Cheer bits', 'gift subs'];
    if (s.donationsEnabled) ways.push('donate');
    if (tt) ways.push('send TikTok gifts');
    how.append(
      ways.slice(0, -1).join(', ') + ' or ' + ways[ways.length - 1] + ' to set these off on stream. ',
      h('b', { text: 'Use a code: ' }), 'put the code (like ', h('b', { text: pfx + 'code' }), ') in your cheer', s.donationsEnabled ? ' or donation' : '', ' message and pay at least the price. ',
      h('b', { text: 'No code? ' }),
      s.matchMode === 'tier' ? 'The biggest item your amount covers plays.' : 'Send the exact amount shown and that item plays.'
    );
    if (tt) how.append(' ', h('b', { text: 'On TikTok: ' }), 'send the gift shown on an item and it plays.');
    if (S.media.some((m) => m.previewUrl)) how.append(' ', h('b', { text: 'Tap any item to preview it.' }));
    if (s.mediaPaused) how.append(h('div', { class: 'chip', style: { 'margin-top': '10px', color: 'var(--warn)' }, text: '⏸ The wake-up menu is paused right now' }));

    const box = $('menu');
    stopPreview();
    box.innerHTML = '';
    const items = S.media.filter((m) => {
      const p = m.prices || {};
      const don = p.donation && s.donationsEnabled;
      if (!p.bits && !p.subs && !don && !hasTt(m)) return false;
      if (filter === 'all') return true;
      if (filter === 'donation') return !!don;
      if (filter === 'tiktok') return hasTt(m);
      return !!p[filter];
    });
    if (!items.length) { box.appendChild(h('div', { class: 'empty', style: { 'grid-column': '1 / -1' }, text: S.media.length ? 'Nothing in this category.' : 'The menu is being set up — check back soon!' })); return; }
    items.forEach((m) => {
      const p = m.prices || {};
      const prices = h('div', { class: 'prices' });
      (m.tiktok || []).forEach((g) => {
        const img = safeImg(g.image);
        prices.appendChild(h('div', { class: 'price tiktok' }, [
          h('span', { html: TT_ICON + 'TikTok' }),
          h('b', {}, [img ? h('img', { src: img, alt: '', class: 'gift-img' }) : null, giftLabel(g)]),
        ]));
      });
      if (p.bits) prices.appendChild(h('div', { class: 'price bits' }, [h('span', { html: SMP.icons.bits + 'Cheer' }), h('b', { text: SMP.num(p.bits) + ' bits' })]));
      if (p.subs) prices.appendChild(h('div', { class: 'price subs' }, [h('span', { html: SMP.icons.gift + 'Gift' }), h('b', { text: p.subs + ' sub' + (p.subs > 1 ? 's' : '') })]));
      if (p.donation && s.donationsEnabled) prices.appendChild(h('div', { class: 'price donation' }, [h('span', { html: SMP.icons.money + 'Donate' }), h('b', { text: SMP.money(p.donation, cs) })]));
      const fx = m.effect && m.effect !== 'none' ? h('span', { class: 'fx', text: { flash: 'FLASH', shake: 'SHAKE', both: 'FLASH + SHAKE' }[m.effect] }) : null;
      const canPreview = !!m.previewUrl;
      const ico = h('div', { class: 'item-ico', html: SMP.icons[m.type] || SMP.icons.audio });
      const hint = canPreview ? h('span', { class: 'pv-hint', text: m.type === 'audio' ? '▶ Preview' : m.type === 'video' ? '▶ Watch' : '◉ View' }) : null;
      const card = h('div', { class: 'card item' + (canPreview ? ' previewable' : ''), 'data-id': m.id }, [
        h('div', { class: 'item-top' }, [
          ico,
          h('div', { class: 'item-head' }, [
            h('div', { class: 'item-name', text: m.name }),
            h('div', { class: 'item-type' }, [{ audio: 'Sound', video: 'Video', image: 'Image' }[m.type] || m.type, hint]),
          ]),
          fx,
        ]),
        m.description ? h('p', { class: 'item-desc', text: m.description }) : null,
        prices,
        m.code ? h('div', { class: 'code-row' }, [
          'Code:', h('button', { class: 'code-btn', title: 'Copy code', html: SMP.icons.copy, onclick: (e) => { e.stopPropagation(); copy(pfx + m.code); } }, pfx + m.code),
        ]) : null,
        canPreview && m.type === 'audio' ? h('div', { class: 'pv-bar' }, h('b')) : null,
      ]);
      if (canPreview) {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Preview ' + m.name);
        const go = () => preview(m, card, ico);
        card.addEventListener('click', go);
        card.addEventListener('keydown', (e) => {
          if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); }
        });
      }
      box.appendChild(card);
    });
  }

  // ------------------------------------------------------------ previews
  const EQ = '<span class="eq"><i></i><i></i><i></i><i></i></span>';
  let pv = null; // { id, audio, card, ico, icoHtml, raf }
  function stopPreview() {
    if (!pv) return;
    const cur = pv;
    pv = null;
    try { cur.audio.pause(); } catch (e) {}
    cancelAnimationFrame(cur.raf);
    cur.card.classList.remove('playing');
    cur.ico.innerHTML = cur.icoHtml;
    const bar = cur.card.querySelector('.pv-bar b');
    if (bar) bar.style.width = '0%';
  }
  function preview(m, card, ico) {
    if (m.type !== 'audio') { stopPreview(); openLightbox(m); return; }
    if (pv && pv.id === m.id) { stopPreview(); return; }
    stopPreview();
    const audio = new Audio(m.previewUrl);
    audio.volume = 0.6;
    const cur = { id: m.id, audio, card, ico, icoHtml: ico.innerHTML, raf: 0 };
    pv = cur;
    card.classList.add('playing');
    ico.innerHTML = EQ;
    const bar = card.querySelector('.pv-bar b');
    const tick = () => {
      if (pv !== cur) return;
      if (bar && audio.duration) bar.style.width = Math.min(100, (audio.currentTime / audio.duration) * 100) + '%';
      cur.raf = requestAnimationFrame(tick);
    };
    audio.addEventListener('ended', () => { if (pv === cur) stopPreview(); });
    audio.addEventListener('error', () => { if (pv === cur) { stopPreview(); SMP.toast('Could not play this preview', true); } });
    const p = audio.play();
    if (p && p.catch) p.catch(() => { if (pv === cur) stopPreview(); });
    tick();
  }
  let lbReturn = null;
  function openLightbox(m) {
    const box = $('lbBox');
    box.innerHTML = '';
    if (m.type === 'video') {
      const v = h('video', { src: m.previewUrl, controls: true, autoplay: true, playsinline: true });
      v.volume = 0.6;
      box.appendChild(v);
    } else box.appendChild(h('img', { src: m.previewUrl, alt: m.name }));
    box.appendChild(h('div', { class: 'lb-cap', text: m.name }));
    lbReturn = document.activeElement;
    $('lightbox').hidden = false;
    document.body.classList.add('lb-open');
    $('lbClose').focus();
  }
  function closeLightbox() {
    if ($('lightbox').hidden) return;
    $('lightbox').hidden = true;
    $('lbBox').innerHTML = '';
    document.body.classList.remove('lb-open');
    if (lbReturn && lbReturn.focus) lbReturn.focus();
  }
  $('lbClose').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('lightbox').hidden) closeLightbox();
    else stopPreview();
  });

  function copy(text) {
    const done = () => SMP.toast('Copied ' + text + ' — paste it in your message');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
    else done();
  }
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('on', x === b));
    renderMenu();
  });

  function renderRecent(isNew) {
    const box = $('recent');
    box.innerHTML = '';
    $('recentSec').hidden = !S.feed.length;
    S.feed.slice(0, 10).forEach((f, i) => {
      const info = SMP.eventInfo(f, S.settings.currencySymbol);
      box.appendChild(h('div', { class: 'r-item k-' + info.kind + (isNew && i === 0 ? ' new' : '') }, [
        h('div', { class: 'r-ico', html: info.icon }),
        h('div', { class: 'r-body' }, [h('b', { text: info.title }), ' ' + info.action,
          h('small', { text: SMP.timeAgo(f.ts) + (f.media && f.media.length ? ' · played ' + f.media.join(', ') : '') })]),
        f.added > 0 ? h('div', { class: 'r-add', text: '+' + SMP.fmtDur(f.added) }) : null,
      ]));
    });
  }
  setInterval(() => { if (S && S.feed.length) renderRecent(false); }, 30000);
})();
