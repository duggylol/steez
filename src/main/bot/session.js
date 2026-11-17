// Things that are running right now (an open giveaway, a poll, bets, a heist, a raid boss, a trivia
// round) are written to the database as they change, so closing Steez and opening it again picks
// them up where they left off. Deadlines move forward by however long Steez was closed.
import { db, save } from './store.js';

db.session ||= {};

/** How long Steez was closed, measured from the last time something running was saved. */
const closedFor = db.session.savedAt ? Math.max(0, Date.now() - db.session.savedAt) : 0;
export const downtime = () => closedFor;

const active = () => Object.keys(db.session).some((k) => k !== 'savedAt');

/** Save (or clear, with null) one running thing. */
export function keep(key, value) {
  if (value == null) delete db.session[key];
  else db.session[key] = value;
  db.session.savedAt = Date.now();
  save();
}

export function restore(key) {
  return db.session[key] ?? null;
}

/** Mark "still running at this moment" — called on a timer and when Steez quits. */
export function touch() {
  if (!active()) return;
  db.session.savedAt = Date.now();
  save();
}

/** A deadline saved before the restart, moved forward by the time Steez was closed. */
export const resumeAt = (endsAt) => (endsAt ? endsAt + closedFor : 0);

const tick = setInterval(touch, 10_000);
tick.unref?.();
