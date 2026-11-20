// Steez Casino: log in with Twitch, play with the channel's loyalty points.
// The games are decided by the streamer's Steez app; this page asks, animates and keeps score.
import { h, put, add, fmt, fmtMult, signed, short, toast, sfx, icon, coin, asset, load } from './ui.js';

const CFG = window.CASINO || { base: '', clientId: '', authorize: 'https://id.twitch.tv/oauth2/authorize' };
const BASE = CFG.base || '';
const app = document.getElementById('app');
const KEY = 'steezCasinoSession';

// Lobby order, sections and the short rules shown under each game.
export const CATALOG = {
  slots: { cat: 'originals', rules: ['5 reels, 10 fixed lines. Wins pay left to right.', 'WILD stands in for every symbol except the star.', '3, 4 or 5 stars anywhere start 8, 12 or 20 free spins, all wins doubled.'] },
  crash: { cat: 'originals', tag: 'Hot', rules: ['The multiplier climbs until the rocket blows up.', 'Cash out any time before that to win your bet times the multiplier.', 'Set an auto cash-out to take the win at a target automatically.'] },
  plinko: { cat: 'originals', rules: ['Drop balls through the pegs. Each one lands on a multiplier.', 'More rows and higher risk make the edges pay more and the middle less.'] },
  mines: { cat: 'originals', rules: ['25 tiles hide gems and mines.', 'Every gem raises the multiplier. Cash out whenever you like.', 'More mines, bigger multipliers.'] },
  dice: { cat: 'originals', rules: ['Pick your win chance and roll over or under.', 'Lower chances pay more.'] },
  wheel: { cat: 'originals', rules: ['Spin a 30-segment wheel and win the multiplier it stops on.', 'High risk has more blanks and a bigger top prize.'] },
  keno: { cat: 'originals', tag: 'New', rules: ['Pick 1 to 10 numbers from 40. Ten are drawn.', 'The pay table depends on how many you picked and how many hit.'] },
  tower: { cat: 'originals', tag: 'New', rules: ['Climb 8 floors by picking a safe tile on each one.', 'Harder levels have fewer safe tiles and much bigger multipliers.', 'Cash out on any floor.'] },
  coinflip: { cat: 'originals', tag: 'New', rules: ['Call heads or tails.', 'Each right call doubles the multiplier. Cash out any time, up to 20 in a row.'] },
  hilo: { cat: 'originals', rules: ['Guess whether the next card is higher or lower.', 'Riskier guesses grow the multiplier faster. Aces are low, kings are high.'] },
  cases: { cat: 'originals', tag: 'New', rules: ['Open a chest and win the item it lands on.', 'Rarer items pay more. Diamond chests have the biggest prizes.'] },
  scratch: { cat: 'originals', tag: 'New', rules: ['Scratch nine spots. Three of the same symbol wins its prize.', 'Scratch by dragging, or reveal everything at once.'] },
  blackjack: { cat: 'table', rules: ['Beat the dealer without going over 21.', 'Blackjack pays 3 to 2. The dealer stands on all 17s.', 'Double on any first two cards, split a pair once.'] },
  roulette: { cat: 'table', rules: ['European wheel with one zero.', 'Numbers pay 36×, dozens and columns 3×, red, black, odd, even, low and high 2×.'] },
  baccarat: { cat: 'table', tag: 'New', rules: ['Back the Player, the Banker or a Tie.', 'Player pays 2×, Banker 1.95×, Tie 9×. A tie returns Player and Banker bets.'] },
  videopoker: { cat: 'table', tag: 'New', rules: ['Jacks or Better. You get five cards; hold the ones you want and draw.', 'A pair of jacks or better returns your bet. A royal flush pays 800×.'] },
};
const cover = (id) => asset(`img/cover-${id}.webp`);

let session = null;
try {
  session = JSON.parse(load(KEY) || 'null');
} catch {
  session = null;
}
function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: this tab only */
  }
}


function loginUrl() {
  const state = crypto.getRandomValues(new Uint32Array(4)).join('');
  try {
    sessionStorage.setItem('casinoState', state);
    sessionStorage.setItem('casinoReturn', location.pathname + location.hash);
  } catch {
    /* fine */
  }
  const p = new URLSearchParams({ client_id: CFG.clientId, redirect_uri: `${location.origin}${BASE}/auth`, response_type: 'token', scope: '', state });
  return `${CFG.authorize}?${p}`;
}

async function finishLogin() {
  put(app, h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  const hp = new URLSearchParams(location.hash.slice(1));
  let back = `${BASE}/`;
  let expected = null;
  try {
    back = sessionStorage.getItem('casinoReturn') || back;
    expected = sessionStorage.getItem('casinoState');
  } catch {
    /* fine */
  }
  const token = hp.get('access_token');
  if (!token || (expected && hp.get('state') !== expected)) {
    toast(new URLSearchParams(location.search).get('error_description') || 'Login was cancelled.', true);
    return setTimeout(() => location.replace(back), 900);
  }
  try {
    const r = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Login failed');
    saveSession({ token: j.session, user: j.user });
  } catch (e) {
    toast(e.message, true);
  }
  location.replace(back);
}

const logo = () => h('img', { src: asset('img/logo.webp'), alt: '' });
const tick = (b, t) => h('div', {}, icon('check'), h('span', {}, h('b', {}, b), ' ', t));
function gate(...side) {
  put(app, h('div', { class: 'gate' }, h('div', { class: 'art' }, h('img', { src: asset('img/hero-1.webp'), alt: '' })), h('div', { class: 'side' }, h('div', { class: 'logo' }, logo(), h('b', {}, 'Steez Casino')), side)));
}

function landing() {
  document.title = 'Steez Casino';
  const input = h('input', { class: 'inp', placeholder: 'Twitch channel name', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const go = () => {
    const v = input.value.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').toLowerCase();
    if (/^[a-z0-9_]{2,25}$/.test(v)) location.href = `${BASE}/${v}`;
    else toast('Type a Twitch channel name.', true);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  gate(
    h('h1', {}, 'The casino for your ', h('em', {}, 'channel points')),
    h('p', {}, '16 games, from slots and crash to blackjack and video poker. Free to play with the points you earn watching. Nothing to buy, nothing to cash out.'),
    h('div', { class: 'find' }, input, h('button', { class: 'btn gold', onclick: go }, 'Open')),
    h('p', { class: 'faint', style: { fontSize: '13px' } }, 'Streamers: type !casino in your chat to share your casino.'),
  );
}

async function openChannel(login) {
  put(app, h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  let ch;
  try {
    const r = await fetch(`${BASE}/api/channel?login=${encodeURIComponent(login)}`);
    ch = await r.json();
    if (!r.ok) throw new Error(ch.error || 'Couldn’t find that channel.');
  } catch (e) {
    return gate(h('h1', {}, 'Channel not found'), h('p', {}, e.message), h('a', { class: 'btn', href: `${BASE}/`, style: { width: 'fit-content' } }, 'Pick another channel'));
  }
  document.title = `${ch.title || `${ch.display}’s Casino`} · Steez Casino`;
  if (!ch.open) {
    return gate(
      ch.avatar ? h('div', { class: 'who' }, h('img', { src: ch.avatar, alt: '' }), h('div', {}, h('b', {}, ch.display), h('div', { class: 'faint' }, 'Casino closed'))) : null,
      h('h1', {}, 'The casino is ', h('em', {}, 'closed')),
      h('p', {}, ch.online ? `${ch.display} has the casino switched off right now.` : `${ch.display}’s casino opens while their Steez app is running, usually when they’re live.`),
      h('button', { class: 'btn', style: { width: 'fit-content' }, onclick: () => openChannel(login) }, 'Check again'),
    );
  }
  if (!session) return loginScreen(ch);
  new Casino(ch).start();
}

function loginScreen(ch) {
  gate(
    h('div', { class: 'who' }, ch.avatar ? h('img', { src: ch.avatar, alt: '' }) : logo(), h('div', {}, h('b', {}, ch.title || `${ch.display}’s Casino`), h('div', { class: 'faint', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('span', { class: 'live-dot' }), 'Open now'))),
    h('h1', {}, 'Play with your ', h('em', {}, `${ch.display}`), ' points'),
    h('p', {}, '16 casino games. Your wins and losses are the same points you have in chat.'),
    h('a', { class: 'btn lg twitch', href: loginUrl() }, twitchGlyph(), 'Log in with Twitch'),
    h('div', { class: 'ticks' }, tick('Free.', 'Points can’t be bought or cashed out.'), tick('Just your name.', 'Twitch tells us who you are. No permissions asked.'), tick('Fair.', 'Every result is decided on the streamer’s PC, never in your browser.')),
  );
}
const twitchGlyph = () => h('svg', { viewBox: '0 0 24 24' }, h('path', { fill: '#fff', d: 'M4.3 3 3 6.4v13.4h4.6V22h2.6l2.4-2.2h3.6l4.8-4.6V3H4.3Zm15 11.4-2.8 2.7H12l-2.4 2.2v-2.2H5.8V4.8h13.5v9.6ZM16.4 8v4.8h-1.8V8h1.8Zm-4.6 0v4.8H10V8h1.8Z' }));

// ── The casino ─────────────────────────────────────────────
class Casino {
  constructor(ch) {
    this.ch = ch;
    this.info = null;
    this.bal = 0;
    this.busy = 0;
    this.mounted = null;
    this.recentSeen = new Set();
  }

  async call(action, args = {}) {
    const r = await fetch(`${BASE}/api/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ channelId: this.ch.id, action, args }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      saveSession(null);
      loginScreen(this.ch);
      throw new Error('Your login expired. Log in again.');
    }
    if (r.status === 503) throw new Error(`The casino just closed: ${this.ch.display}’s Steez went offline.`);
    if (!r.ok || j.ok === false) throw new Error(j.error || 'Something went wrong. Try again.');
    return j.result;
  }

  async start() {
    try {
      this.info = await this.call('info');
    } catch (e) {
      if (!session) return;
      return gate(h('h1', {}, 'Can’t open the casino'), h('p', {}, e.message), h('button', { class: 'btn', style: { width: 'fit-content' }, onclick: () => openChannel(this.ch.login) }, 'Try again'));
    }
    this.bal = this.info.me.balance;
    this.games = this.info.games.filter((g) => CATALOG[g.id]).sort((a, b) => Object.keys(CATALOG).indexOf(a.id) - Object.keys(CATALOG).indexOf(b.id));
    this.shell();
    window.addEventListener('hashchange', () => this.route());
    this.route();
    setInterval(() => this.refresh(), 15_000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.refresh());
  }

  async refresh() {
    if (document.visibilityState !== 'visible' || this.busy) return;
    try {
      const info = await this.call('info');
      if (this.busy) return;
      this.info = { ...info, games: this.info.games };
      this.setBalance(info.me.balance);
      this.onData?.();
    } catch {
      /* next time */
    }
  }

  setBalance(v, pulse = true) {
    const before = this.bal;
    this.bal = Math.max(0, Math.round(v));
    this.balNum.textContent = fmt(this.bal);
    if (pulse && this.bal !== before) {
      this.wallet.classList.remove('up', 'down');
      void this.wallet.offsetWidth;
      this.wallet.classList.add(this.bal > before ? 'up' : 'down');
      clearTimeout(this.wTimer);
      this.wTimer = setTimeout(() => this.wallet.classList.remove('up', 'down'), 900);
    }
  }

  shell() {
    const me = session.user;
    const closeNav = () => document.body.classList.remove('nav-open');
    const link = (href, img, label, extra) => h('a', { href, 'data-r': href.slice(1), onclick: closeNav, title: label }, img, h('span', {}, label), extra);
    const gameLink = (g) => link(`#${g.id}`, h('img', { class: 'th', src: cover(g.id), alt: '', loading: 'lazy' }), g.name);
    this.nav = h(
      'nav',
      { class: 'nav' },
      h('a', { class: 'brand', href: '#', onclick: closeNav, style: { boxShadow: 'none', background: 'none' } }, logo(), h('div', {}, h('b', {}, 'Steez Casino'), h('small', {}, this.ch.display))),
      link('#', h('span', { class: 'ic' }, icon('home')), 'Lobby'),
      h('h6', {}, 'Originals'),
      this.games.filter((g) => CATALOG[g.id].cat === 'originals').map(gameLink),
      h('h6', {}, 'Table games'),
      this.games.filter((g) => CATALOG[g.id].cat === 'table').map(gameLink),
      h('div', { class: 'foot' }, `Free to play with ${this.ch.display}’s channel ${this.info.currency}. Points can’t be bought or cashed out.`),
    );
    this.balNum = h('span', {}, fmt(this.bal));
    this.wallet = h('div', { class: 'wallet', title: `Your ${this.info.currency} in ${this.ch.display}’s channel` }, coin(), this.balNum, h('span', { class: 'cur' }, this.info.currency));
    const mute = h('button', { class: 'btn ghost icon', title: 'Sound', onclick: () => put(mute, icon(sfx.toggle() ? 'mute' : 'sound')) }, icon(sfx.muted ? 'mute' : 'sound'));
    const top = h(
      'header',
      { class: 'top' },
      h('button', { class: 'btn ghost icon menu', title: 'Games', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu')),
      h('div', { class: 'chan' }, this.ch.avatar ? h('img', { src: this.ch.avatar, alt: '' }) : null, h('div', { style: { minWidth: 0 } }, h('b', {}, this.info.title || `${this.ch.display}’s Casino`), h('small', {}, h('span', { class: 'live-dot' }), 'Casino open'))),
      h('div', { class: 'grow' }),
      this.wallet,
      mute,
      h('div', { class: 'me' }, me.avatar ? h('img', { src: me.avatar, alt: '' }) : null, h('span', { class: 'n' }, me.display), h('button', { class: 'btn ghost icon', title: 'Log out', onclick: () => (saveSession(null), loginScreen(this.ch)) }, icon('out'))),
    );
    this.view = h('main', { class: 'view' });
    put(app, h('div', { class: 'shell' }, this.nav, h('div', { class: 'main' }, top, this.view)), h('div', { class: 'scrim', onclick: closeNav }));
  }

  route() {
    const id = location.hash.slice(1);
    const g = this.games.find((x) => x.id === id);
    if (this.mounted) {
      try {
        this.mounted.unmount?.();
      } catch {
        /* ignore */
      }
      this.mounted = null;
    }
    clearInterval(this.heroTimer);
    this.onData = null;
    this.nav.querySelectorAll('a[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === (g ? g.id : '')));
    if (g) this.openGame(g);
    else this.lobby();
    window.scrollTo({ top: 0 });
  }

  // ── Lobby ──
  lobby() {
    const { me, currency } = this.info;
    const slides = [
      { img: 'hero-1', eyebrow: `${this.ch.display} · Casino`, title: [h('em', {}, `${this.games.length} games`), ' for your channel points'], text: `Slots, crash, plinko, blackjack and more. You have ${fmt(this.bal)} ${currency} to play with.`, play: 'slots', alt: 'crash' },
      { img: 'hero-2', eyebrow: 'Steez Original', title: ['Steez ', h('em', {}, 'Slots')], text: 'Five reels, ten lines, wilds and free spins that double every win.', play: 'slots' },
      { img: 'hero-3', eyebrow: 'Steez Original', title: ['How high will ', h('em', {}, 'Crash'), ' fly?'], text: 'Cash out before the rocket blows up. One in a hundred rounds tops 97×.', play: 'crash' },
    ].filter((s) => this.games.some((g) => g.id === s.play));
    const slideEls = slides.map((s, i) =>
      h(
        'div',
        { class: `slide${i ? '' : ' on'}` },
        h('img', { src: asset(`img/${s.img}.webp`), alt: '' }),
        h('div', { class: 'shade' }),
        h(
          'div',
          { class: 'copy' },
          h('span', { class: 'eyebrow' }, s.eyebrow),
          h('h1', {}, s.title),
          h('p', { class: 'p-hide' }, s.text),
          h('div', { class: 'cta' }, h('a', { class: 'btn gold', href: `#${s.play}` }, `Play ${this.games.find((g) => g.id === s.play).name}`), s.alt ? h('a', { class: 'btn', href: `#${s.alt}` }, `Try ${this.games.find((g) => g.id === s.alt)?.name || ''}`) : null),
        ),
      ),
    );
    let cur = 0;
    const dots = slides.map((_, i) => h('button', { class: i ? '' : 'on', 'aria-label': `Slide ${i + 1}`, onclick: () => show(i) }));
    const show = (i) => {
      cur = i;
      slideEls.forEach((s, j) => s.classList.toggle('on', j === i));
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
    };
    if (slides.length > 1) this.heroTimer = setInterval(() => show((cur + 1) % slides.length), 7000);

    const kpi = (ic, k, v) => {
      const val = h('div', { class: 'v' }, v);
      return { el: h('div', { class: 'panel kpi' }, h('div', { class: 'i' }, icon(ic)), h('div', {}, h('div', { class: 'k' }, k), val)), val };
    };
    const kBal = kpi('coins', 'Your balance', `${fmt(this.bal)}`);
    const kNet = kpi('chart', 'Your casino profit', signed(me.net || 0));
    const kBest = kpi('trophy', 'Biggest recent win', '—');
    const kGames = kpi('star', 'Games', String(this.games.length));
    const drawKpis = () => {
      kBal.val.textContent = fmt(this.bal);
      kNet.val.textContent = signed(this.info.me.net || 0);
      kNet.val.className = `v ${this.info.me.net > 0 ? 'win-t' : this.info.me.net < 0 ? 'lose-t' : ''}`;
      const best = [...this.info.feed].sort((a, b) => b.mult - a.mult)[0];
      kBest.val.textContent = best ? `${fmtMult(best.mult)} · ${best.user}` : '—';
    };

    let filter = 'all';
    const tiles = h('div', { class: 'tiles' });
    const filters = [['all', 'All games'], ['originals', 'Originals'], ['table', 'Table games']].map(([v, l]) => h('button', { class: `chip-f${v === filter ? ' on' : ''}`, onclick: () => ((filter = v), sfx.click(), drawTiles()) }, l));
    const drawTiles = () => {
      filters.forEach((b, i) => b.classList.toggle('on', ['all', 'originals', 'table'][i] === filter));
      const list = this.games.filter((g) => filter === 'all' || CATALOG[g.id].cat === filter);
      put(
        tiles,
        list.map((g) =>
          h(
            'a',
            { class: 'tile', href: `#${g.id}` },
            h('img', { src: cover(g.id), alt: '', loading: 'lazy' }),
            this.info.rounds[g.id] ? h('span', { class: 'tag live' }, 'In play') : CATALOG[g.id].tag ? h('span', { class: 'tag' }, CATALOG[g.id].tag) : null,
            h('div', { class: 't' }, h('b', {}, g.name), h('small', {}, CATALOG[g.id].cat === 'table' ? 'Table game' : 'Steez Original')),
          ),
        ),
      );
      fitTiles(tiles, list.length);
    };

    const bets = this.betsPanel();
    put(
      this.view,
      h('section', { class: 'hero' }, slideEls, slides.length > 1 ? h('div', { class: 'dots' }, dots) : null),
      h('section', { class: 'strip' }, kBal.el, kNet.el, kBest.el, kGames.el),
      h('section', {}, h('div', { class: 'sec-h' }, h('h2', {}, icon('dice'), 'Games'), h('div', { class: 'chips' }, filters)), tiles),
      bets.el,
    );
    drawTiles();
    drawKpis();
    const ro = new ResizeObserver(() => fitTiles(tiles, tiles.children.length));
    ro.observe(tiles);
    this.mounted = { unmount: () => ro.disconnect() };
    this.onData = () => {
      drawKpis();
      bets.draw();
    };
    if (!me.known) toast(`You don’t have any ${currency} here yet. Hang out in ${this.ch.display}’s chat to earn some.`);
  }

  /** Live bets / big wins / leaderboard, for the lobby or one game. */
  betsPanel(gameId = null) {
    let tab = 'all';
    const body = h('div', { class: 'tblwrap' });
    const tabs = [['all', 'Live bets'], ['big', 'Big wins'], ['top', 'Leaderboard']].map(([v, l]) => h('button', { class: v === tab ? 'on' : '', onclick: () => ((tab = v), draw()) }, l));
    const gameName = (id, name) => h('span', { class: 'g' }, CATALOG[id] ? h('img', { src: cover(id), alt: '' }) : null, name);
    const draw = () => {
      tabs.forEach((b, i) => b.classList.toggle('on', ['all', 'big', 'top'][i] === tab));
      const { currency } = this.info;
      if (tab === 'top') {
        const list = this.info.top || [];
        return put(body, list.length ? h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', { class: 'r hide-s' }, 'Plays'), h('th', { class: 'r' }, `Profit (${currency})`)), list.map((t, i) => h('tr', {}, h('td', { class: 'num faint' }, i + 1), h('td', {}, h('b', {}, t.user)), h('td', { class: 'r num hide-s' }, fmt(t.plays)), h('td', { class: `r num ${t.net >= 0 ? 'win-t' : 'lose-t'}` }, signed(t.net))))) : h('div', { class: 'empty' }, 'Nobody has played yet.'));
      }
      let rows = tab === 'big' ? (this.info.feed || []).map((f) => ({ ...f, name: f.game, game: this.games.find((g) => g.name === f.game)?.id })) : this.info.recent || [];
      if (gameId) rows = rows.filter((r) => r.game === gameId);
      rows = rows.slice(0, 12);
      if (!rows.length) return put(body, h('div', { class: 'empty' }, tab === 'big' ? 'No big wins yet. Be the first.' : 'No bets yet. Yours will show up here.'));
      put(
        body,
        h(
          'table',
          { class: 'tbl' },
          h('tr', {}, gameId ? null : h('th', {}, 'Game'), h('th', {}, 'Player'), h('th', { class: 'r hide-s' }, 'Bet'), h('th', { class: 'r' }, 'Multiplier'), h('th', { class: 'r' }, 'Payout')),
          rows.map((r) => {
            const key = `${r.t}|${r.user}|${r.game}|${r.staked}`;
            const fresh = !this.recentSeen.has(key);
            this.recentSeen.add(key);
            const won = r.payout > r.staked;
            return h(
              'tr',
              { class: fresh ? 'new' : '' },
              gameId ? null : h('td', {}, gameName(r.game, r.name)),
              h('td', {}, r.user),
              h('td', { class: 'r num hide-s' }, fmt(r.staked)),
              h('td', { class: `r num ${won ? 'win-t' : 'faint'}` }, fmtMult(r.mult)),
              h('td', { class: `r num ${won ? 'win-t' : 'faint'}` }, won ? `+${fmt(r.payout - r.staked)}` : `−${fmt(r.staked - r.payout)}`),
            );
          }),
        ),
      );
    };
    draw();
    return { el: h('section', { class: 'panel pad' }, h('div', { class: 'sec-h' }, h('h2', {}, icon('bolt'), gameId ? 'Recent plays' : 'Activity'), h('div', { class: 'tabs' }, tabs)), body), draw };
  }

  // ── A game ──
  async openGame(g) {
    const body = h('div');
    const info = CATALOG[g.id];
    const bets = this.betsPanel(g.id);
    const rules = h(
      'section',
      { class: 'panel pad' },
      h('div', { class: 'sec-h' }, h('h2', {}, icon('info'), `How ${g.name} works`)),
      h('ul', { class: 'rules' }, (info.rules || []).map((r) => h('li', {}, r))),
      h('p', { class: 'note', style: { marginTop: '12px' } }, g.fixedOdds ? 'Plays at normal table odds.' : `Pays back about ${this.info.returnPercent}% of what’s bet, on average. Every result is decided on the streamer’s PC.`),
    );
    put(this.view, body, h('div', { class: 'ginfo' }, rules, bets.el));
    this.onData = () => bets.draw();
    let mod;
    try {
      if (g.round) this.info.rounds = (await this.call('info')).rounds;
      mod = await import(`./games/${g.id}.js`);
    } catch (e) {
      return put(body, h('div', { class: 'panel pad' }, 'This game didn’t load. Refresh the page.'));
    }
    const self = this;
    const ctx = {
      game: g.id,
      meta: g,
      casino: { currency: this.info.currency, minBet: this.info.minBet, maxBet: this.info.maxBet, returnPercent: this.info.returnPercent },
      round: this.info.rounds[g.id] || null,
      balance: () => self.bal,
      /** Place a bet. `cost` (if known) comes off the shown balance right away. */
      async bet(bet, params = {}, cost = bet) {
        if (cost > self.bal) throw fail(`You only have ${fmt(self.bal)} ${self.info.currency}.`);
        self.busy++;
        try {
          const res = await self.call('bet', { game: g.id, bet, params });
          self.setBalance(self.bal - (res.cost ?? res.staked ?? cost), false);
          return res;
        } catch (e) {
          self.busy--;
          throw fail(e.message);
        }
      },
      async move(move, extra = {}, { quiet = false } = {}) {
        self.busy++;
        try {
          return await self.call('move', { game: g.id, move, ...extra });
        } catch (e) {
          throw quiet ? e : fail(e.message);
        } finally {
          self.busy--;
        }
      },
      /** The play is over and shown: show the real balance and log it. */
      settle(res) {
        self.busy = Math.max(0, self.busy - 1);
        if (res?.balance != null) self.setBalance(res.balance);
        const staked = res?.cost ?? res?.staked;
        if (res && res.payout != null && staked) {
          const mult = Math.round((res.payout / staked) * 100) / 100;
          const row = { t: Date.now(), user: session.user.display, game: g.id, name: g.name, staked, payout: res.payout, mult };
          self.info.recent = [row, ...(self.info.recent || [])].slice(0, 30);
          if (res.payout > staked && mult >= 5) self.info.feed = [{ ...row, game: g.name }, ...self.info.feed].slice(0, 20);
          self.info.me.net = (self.info.me.net || 0) + res.payout - staked;
          bets.draw();
        }
      },
      setBalance: (v) => self.setBalance(v),
      roundOver() {
        delete self.info.rounds[g.id];
      },
      toast,
    };
    try {
      this.mounted = mod.mount(body, ctx) || null;
    } catch (e) {
      console.error(e);
      put(body, h('div', { class: 'panel pad' }, 'This game hit a problem. Refresh the page.'));
    }
  }
}

/** Pick a column count that fills every row: as many columns as fit, fewer if that leaves a gap. */
function fitTiles(el, count) {
  const w = el.clientWidth;
  if (!w || !count) return;
  const gap = parseFloat(getComputedStyle(el).columnGap) || 12;
  const minTile = w < 520 ? 130 : w < 900 ? 150 : 165;
  const max = Math.max(2, Math.floor((w + gap) / (minTile + gap)));
  let best = max;
  for (let c = max; c >= Math.max(2, Math.ceil(max * 0.6)); c--) {
    if (count % c === 0) {
      best = c;
      break;
    }
  }
  el.style.gridTemplateColumns = `repeat(${best}, minmax(0, 1fr))`;
}

function fail(msg) {
  const e = new Error(msg);
  toast(msg, true);
  return e;
}

// ── Start (last, so everything above exists). Routes: <base>/ picks a channel, <base>/auth is the
// way back from Twitch, <base>/<channel>#game is a casino.
const rest = location.pathname.slice(BASE.length).replace(/^\/+|\/+$/g, '');
if (rest === 'auth') finishLogin();
else if (!rest) landing();
else openChannel(rest.toLowerCase());

export { add, short };
