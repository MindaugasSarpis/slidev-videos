// Advance on end: whether a clip's `ended` goes on to the next slide. The
// decision in one place, read off what the player sees, so it reads and tests
// as one table (test/advance.test.mjs).

// A press within this many ms before the clip's end has navigated already
// (Slidev moves the route a tick after the key; the `ended` lands in between).
export const NAV_GRACE_MS = 500;

// The keys Slidev navigates on, as `e.key` (Space reads ' ').
export const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', ' ', 'PageUp', 'PageDown', 'Enter', 'Home', 'End']);

// s: { armed, armedClicks, clicks, advance, loop, context, printing, active,
//      rec, page, current, fallback, plateNext, lastNavMs, nowMs }
// → { go, reason }: the first rule that decides it, in this order.
export function shouldAdvance(s) {
  const no = (reason) => ({ go: false, reason });
  if (!s.armed) return no('disarmed');                 // not this visit's arming, or spent
  if (!s.advance) return no('off');                    // advanceOnEnd off
  if (s.loop) return no('loop');                       // a looping clip never ends
  if (s.context !== 'slide') return no('context');     // the presenter window, the overview, a preview
  if (s.printing) return no('print');
  if (!s.active) return no('inactive');
  if (s.rec) return no('rec');                         // slidev-stage-record moves the deck itself
  if (s.current !== s.page) return no('page');         // the deck has moved on
  if ((s.clicks ?? 0) !== (s.armedClicks ?? 0)) return no('clicks');   // a click was taken since
  // Without a world (html[data-stage-fallback]) the next slide is a still or a
  // plate: go on only onto a loaded plate (html[data-stage-plate-next], the
  // next slide's number), which begins on this clip's last frame so the motion
  // carries on; onto a still the presenter goes by hand.
  const plate = s.fallback ? Number(s.plateNext) === s.page + 1 : null;
  if (plate === false) return no('no-plate');
  if (Number.isFinite(s.lastNavMs) && s.nowMs - s.lastNavMs < NAV_GRACE_MS) return no('pressed');
  return { go: true, reason: plate ? 'plate' : 'ended' };
}

// One per player: armed as its slide becomes the current one, with the click
// count it stands at; one `ended` spends the arming, however it is decided.
export function advanceGate() {
  let armed = null;   // { clicks } while armed
  return {
    arm(clicks = 0) { armed = { clicks }; },
    disarm() { armed = null; },
    ended(s) {
      const a = armed;
      armed = null;
      return shouldAdvance({ ...s, armed: !!a, armedClicks: a?.clicks ?? 0 });
    },
  };
}
