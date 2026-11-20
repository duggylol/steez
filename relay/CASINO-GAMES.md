# Steez Casino: how a game screen is built

The site lives in `relay/casino-site/`. It is plain ES modules, with no build step.

- **`casino.css`** holds the design tokens and every shared class.
- **`ui.js`** is the UI kit.
- **`app.js`** is the shell: the lobby, the sidebar, and the `ctx` object each game gets.

Each game is one file, `games/<id>.js`, exporting `mount(el, ctx)`. Two reference games show the patterns:

- **`games/dice.js`**: an instant game with autoplay.
- **`games/mines.js`**: a round game with moves and a cash-out.

The game rules and maths run on the server, in `src/main/bot/casino/`:

- **`engine.js`** has slots, plinko, mines, dice, wheel, roulette, hilo and blackjack, plus `gameInfo`.
- **`more.js`** has crash, keno, tower, coinflip, cases, scratch, baccarat and videopoker.
- **`slots.js`** has the slot maths.

Read them to see exactly what `res.result` / `res.view` and `ctx.meta` contain. Don't change server files.

## Look and feel (non-negotiable)

**Colours.** Use the palette tokens in `casino.css` only. Never invent colours.

| Token | Value | Use |
|---|---|---|
| `--bg`, `--bg-1` | | Page and sidebar |
| `--surface`, `--surface-2`, `--surface-3` | | Panels, raised areas |
| `--line`, `--line-2` | | Borders |
| `--text`, `--text-2`, `--text-3` | | Text |
| `--gold` (+ `--gold-hi`, `--gold-grad`, `--gold-soft`) | | The single accent: primary buttons, highlights, big wins |
| `--win` | `#22c77a` | Wins and safe results |
| `--lose` | `#ef4b5f` | Losses, mines, red |

- A game may use near-black navy (`#141a26` or `--surface-3`) for "black" (roulette pockets, card suits).
- Use `--win` for green (the roulette zero).
- Use `--lose` for red pockets and suits.
- Nothing else: no purple, no blue, no random gradients.

**Type.** Geist for text. Every number uses `font-family: var(--mono)`.

**Filling the space.** The board must fill the stage.

- The stage element is a CSS container (`container-type: size`).
- Size boards with `cqw` / `cqh` / `cqmin`, as `.mn` in `mines.js` does: `--s: min(calc(100cqh - 90px), calc(100cqw - 40px), 640px)`.
- Leave about 50px at the top for the stage bar (game badge, RTP badge, history chips).
- There must be no big empty areas, at any size from a 375px phone to a 2560px monitor.
- On screens under 1100px the stage sits above the controls at about 62–68vh (`casino.css` already handles this).

**Premium feel:**
- Smooth easing (`tween`, `ease` in `ui.js`).
- Depth: subtle shadows and inner highlights, like `.mt` tiles.
- Every action gets satisfying feedback.
- Use the generated art wherever it fits.
- Sound on every meaningful event (`sfx.*`).
- Results go through `showResult(pop, res)`: a bubble for wins, confetti for 10× and up.
- Push a chip for every result with `history(L.bar).push(label, kind)`.

## The ctx contract (from app.js)

- `ctx.meta` is the game's `gameInfo` (boards, pay tables, and so on). `ctx.casino` is `{ currency, minBet, maxBet, returnPercent }`.
- `ctx.bet(bet, params, cost?)` places a bet.
  - It resolves to the server result: `{ done, result | view, cost | staked, payout, balance }`.
  - It throws after showing a toast.
  - The balance drops right away.
  - **You must call `ctx.settle(res)` once the result is shown.** For a round start, call `ctx.settle({ balance: res.balance })`.
- `ctx.move(move, extra, { quiet })` plays a round game.
  - When `res.done`, call `ctx.roundOver()`, show the result, then `ctx.settle(res)`.
  - Mid-round extra stakes (a blackjack double or split) need `ctx.setBalance(res.balance)`.
- `ctx.round` is `{ view, staked }` when the player left a round unfinished. Resume it.
- `ctx.balance()` is the current balance. `ctx.toast(msg, bad)` shows a message.
- `mount` returns `{ unmount() }`. It must stop every timer, `requestAnimationFrame` loop, `ResizeObserver` and document listener.

## UI kit (ui.js)

**DOM and numbers:** `h(tag, attrs, ...kids)`, `put`, `css(id, text)` (scoped CSS once per game), `fmt`, `fmtMult`, `signed`, `short`, `sleep`, `tween(ms, fn)`, `ease`, `countUp`.

**Controls:**
- `betBox(ctx, {label})`: `.el`, `.value`, `.lock(on)`, `.onChange(fn)`.
- `seg(options, value, onChange)`: `.el`, `.value`, `.set`, `.lock`.
- `field(label, el, note)` and `stat(k)`: `.el`, `.set`.
- `autoplay(ctx, { button, play, lock, label })` gives instant games Manual/Auto. `play()` returns `{cost, payout}` or `null`. Put `auto.mode` at the top of the controls and `auto.box` under the bet.

**Layout:**
- `gameLayout(el, ctx, { controls: [...], stage: node })` returns `{ bar, body, stage }`.
- Controls end with `h('div', {class: 'spacer'})` and then the main button, `.btn.lg.gold`. Use `.green` for cash-out.

**Results:** `history(bar)`, `pop(body)`, `showResult(pop, res, {lossText})`, `celebrate(mult, amount)`.

**Cards:**
- `card(c, { w })` makes a playing card (don't pass `w: "var(--w)"`: the card uses `--w` itself, so pick another name such as `--cw`), with flip animation and the generated card back. `c` is `{rank 1–13, suit}`, or `null` for face down.
- `setCard(el, c)` flips it.
- Pass `w` as a CSS length such as `'clamp(60px, 11cqmin, 120px)'` so cards scale with the stage.

**Sounds** (`sfx.<name>()`): `click`, `tick(pitch)`, `chip`, `deal`, `flip`, `win`, `big`, `lose`, `gem`, `boom`, `cash`, `launch`, `crash`, `dice`, `coin`, `spin`, `stop`, `wheel`, `roll`, `scratch`, `open`, `pop`. Missing files fall back silently.

**Art** (`asset('img/<name>.webp')`, or `symbolImg(name)` for symbols):

| Asset | Files |
|---|---|
| Game covers | `cover-<game>` |
| Lobby banners | `hero-1`–`hero-3` |
| Slot and scratch symbols | `sym-cherry`, `sym-lemon`, `sym-plum`, `sym-bell`, `sym-bar`, `sym-seven`, `sym-gem`, `sym-crown`, `sym-wild`, `sym-star` |
| Coins | `coin` (small currency icon), `coin-heads`, `coin-tails` |
| Cases | `chest-bronze`, `chest-silver`, `chest-gold`, `chest-diamond` |
| Other | `rocket`, `gem`, `bomb`, `cardback`, `felt` (navy felt texture), `stars` (space background), `logo` |

All transparent PNG art has been converted to WebP with alpha. A few files may still be arriving; reference them anyway.

## Testing locally

- The preview server is already running at http://127.0.0.1:8790/casino/devchannel. It uses the real relay code and the real game engine, with a pretend Twitch login. Static files are read from disk on every request, so your edits show up on reload. Don't start, stop or restart it.
- Use the built-in browser in a tab of your own (`tabs_create`, then `navigate` with that `tabId`), and close it when done.
- The session is shared, so you're already logged in as viewer1 (50,000 points).
- Test at **1600×900** and on **mobile** (`resize_window` preset `mobile`). Reset to `desktop` afterwards.
- Check the console for errors.
