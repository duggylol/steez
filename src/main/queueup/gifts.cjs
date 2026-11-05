'use strict';

/**
 * Tallies TikTok LIVE gifts for the current stream session.
 *
 * Two things matter to the streamer, and both are tracked here:
 *   - who has given the most (by diamonds, TikTok's currency behind every gift)
 *   - the biggest gift combo, i.e. the longest streak of one gift tapped in a row
 *
 * Streakable gifts arrive as a run of events with a rising `repeatCount` and a
 * final one flagged `repeatEnd`. Only that final event is counted toward totals,
 * otherwise a 50-tap combo would be added 50 times over. The run in progress is
 * exposed as `liveStreak` so the overlay can animate it climbing.
 */

const RECENT_LIMIT = 40;
const STREAK_STALL_MS = 8000;   // a run with no new tap for this long is treated as ended

function createGiftTracker({ onChange } = {}) {
  let state = fresh();
  let stallTimer = null;

  function fresh() {
    return {
      sessionStart: Date.now(),
      totalDiamonds: 0,
      totalGifts: 0,
      gifters: {},        // login -> { login, name, avatar, diamonds, gifts, lastAt }
      topStreak: null,    // biggest combo seen this session
      liveStreak: null,   // combo currently being tapped
      recent: []          // newest first
    };
  }

  function emit(reason) {
    if (onChange) onChange(state, reason);
  }

  function gifter(evt) {
    const key = evt.login;
    const g = state.gifters[key] || (state.gifters[key] = {
      login: key, name: evt.name, avatar: evt.avatar, diamonds: 0, gifts: 0, lastAt: 0
    });
    // Names and pictures can change mid-stream; keep the freshest.
    if (evt.name) g.name = evt.name;
    if (evt.avatar) g.avatar = evt.avatar;
    return g;
  }

  function streakRecord(evt, count) {
    return {
      login: evt.login,
      name: evt.name,
      avatar: evt.avatar,
      giftId: evt.giftId,
      giftName: evt.giftName,
      giftImage: evt.giftImage,
      count,
      diamonds: (evt.diamonds || 0) * count,
      at: Date.now()
    };
  }

  function considerTopStreak(rec) {
    if (!state.topStreak || rec.count > state.topStreak.count) {
      state.topStreak = { ...rec };
      return true;
    }
    return false;
  }

  /** Credits a finished gift (or a finished combo) to the totals. */
  function finalize(evt, count) {
    const c = Math.max(1, count || 1);
    const diamonds = (evt.diamonds || 0) * c;
    const g = gifter(evt);
    g.diamonds += diamonds;
    g.gifts += c;
    g.lastAt = Date.now();
    state.totalDiamonds += diamonds;
    state.totalGifts += c;

    const rec = streakRecord(evt, c);
    state.recent.unshift(rec);
    if (state.recent.length > RECENT_LIMIT) state.recent.length = RECENT_LIMIT;
    considerTopStreak(rec);
  }

  function clearStall() {
    clearTimeout(stallTimer);
    stallTimer = null;
  }

  /** A combo whose final event never arrived (stream cut, packet lost). */
  function stallStreak() {
    const live = state.liveStreak;
    if (!live) return;
    state.liveStreak = null;
    finalize(live.evt, live.count);
    emit('streak-end');
  }

  /**
   * evt: { login, name, avatar, giftId, giftName, giftImage, diamonds (per unit),
   *        giftType, repeatCount, repeatEnd }
   */
  function handleGift(evt) {
    if (!evt || !evt.login) return;
    const streakable = Number(evt.giftType) === 1;
    const count = Math.max(1, Number(evt.repeatCount) || 1);

    if (!streakable) {
      finalize(evt, count);
      emit('gift');
      return;
    }

    if (!evt.repeatEnd) {
      // Run in progress. A different user/gift starting means the previous run
      // ended without its final event - settle it first.
      const live = state.liveStreak;
      if (live && (live.login !== evt.login || live.giftId !== evt.giftId)) {
        state.liveStreak = null;
        finalize(live.evt, live.count);
      }
      const rec = streakRecord(evt, count);
      state.liveStreak = { ...rec, evt, active: true };
      clearStall();
      stallTimer = setTimeout(stallStreak, STREAK_STALL_MS);
      const newTop = considerTopStreak(rec);
      emit(newTop ? 'streak-record' : 'streak');
      return;
    }

    // Final event of the run: this carries the true total.
    clearStall();
    const live = state.liveStreak;
    if (live && live.login === evt.login && live.giftId === evt.giftId) state.liveStreak = null;
    finalize(evt, count);
    emit('streak-end');
  }

  function topGifters(n = 10) {
    return Object.values(state.gifters)
      .sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts || a.lastAt - b.lastAt)
      .slice(0, n);
  }

  /** Everything the UI and overlay need, without the internal `evt` handle. */
  function snapshot(n = 10) {
    const live = state.liveStreak ? { ...state.liveStreak } : null;
    if (live) delete live.evt;
    return {
      sessionStart: state.sessionStart,
      totalDiamonds: state.totalDiamonds,
      totalGifts: state.totalGifts,
      gifterCount: Object.keys(state.gifters).length,
      topGifters: topGifters(n),
      topStreak: state.topStreak,
      liveStreak: live,
      recent: state.recent.slice(0, 20)
    };
  }

  function reset() {
    clearStall();
    state = fresh();
    emit('reset');
  }

  /** Restores a saved session (e.g. after the app restarts mid-stream). */
  function load(saved) {
    if (!saved || typeof saved !== 'object') return;
    const s = fresh();
    s.sessionStart = Number(saved.sessionStart) || s.sessionStart;
    s.totalDiamonds = Number(saved.totalDiamonds) || 0;
    s.totalGifts = Number(saved.totalGifts) || 0;
    s.gifters = saved.gifters && typeof saved.gifters === 'object' ? saved.gifters : {};
    s.topStreak = saved.topStreak || null;
    s.recent = Array.isArray(saved.recent) ? saved.recent.slice(0, RECENT_LIMIT) : [];
    state = s;
  }

  /** What gets written to disk - live combos are transient and are not saved. */
  function serialize() {
    return {
      sessionStart: state.sessionStart,
      totalDiamonds: state.totalDiamonds,
      totalGifts: state.totalGifts,
      gifters: state.gifters,
      topStreak: state.topStreak,
      recent: state.recent
    };
  }

  return { handleGift, snapshot, topGifters, reset, load, serialize };
}

module.exports = { createGiftTracker, STREAK_STALL_MS };
