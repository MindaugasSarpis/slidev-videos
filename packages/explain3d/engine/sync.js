// Presenter ↔ audience: two windows of one browser show the same view. Each
// posts its state when the room moves it; a window that opens late says hello
// and a window that has been moved answers with its state.
export const CHANNEL = 'explain3d';

/**
 * key: which figure (page, name, id); get(): the state to post; set(state):
 * take another window's. Channel: BroadcastChannel, or a stand-in for a test.
 * Returns { post(), touched(), close() }, or null where there is no channel.
 */
export function openSync({ key, get, set, hasMoved, Channel = globalThis.BroadcastChannel }) {
  if (!Channel) return null;
  const from = Math.random().toString(36).slice(2);
  const chan = new Channel(CHANNEL);
  let shared = JSON.stringify(get());
  chan.onmessage = ({ data: m }) => {
    if (!m || m.key !== key || m.from === from) return;
    if (m.type === 'state') { shared = m.state; set(JSON.parse(m.state)); } else if (m.type === 'hello' && hasMoved()) chan.postMessage({ key, from, type: 'state', state: JSON.stringify(get()) });
  };
  chan.postMessage({ key, from, type: 'hello' });
  return {
    /** Post the state if it differs from what the windows share. */
    post() {
      const s = JSON.stringify(get());
      if (s === shared) return false;
      shared = s;
      chan.postMessage({ key, from, type: 'state', state: s });
      return true;
    },
    close() { chan.close(); },
  };
}
