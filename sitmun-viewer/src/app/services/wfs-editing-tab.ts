const TAB_ID_KEY = 'sitmun.wfs.editing.tab-id.v1';
const TAB_CHANNEL = 'sitmun.wfs.editing.tab-id.v1';
let resolvedTabId: string | undefined;
let resolvingTabId: Promise<string> | undefined;

function createTabId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getWfsEditingTabId(storage?: Storage): string {
  try {
    const target = storage ?? sessionStorage;
    const id = target.getItem(TAB_ID_KEY);
    if (id) return id;

    const created = createTabId();
    target.setItem(TAB_ID_KEY, created);
    return created;
  } catch {
    throw new Error('WFS editing tab storage unavailable');
  }
}

export function resolveWfsEditingTabId(storage?: Storage): Promise<string> {
  if (resolvingTabId) return resolvingTabId;

  let target: Storage;
  let id: string;
  try {
    target = storage ?? sessionStorage;
    id = getWfsEditingTabId(target);
  } catch (error) {
    return Promise.reject(error);
  }
  if (resolvedTabId) return Promise.resolve(resolvedTabId);
  if (typeof BroadcastChannel === 'undefined') {
    resolvedTabId = id;
    return resolvingTabId = Promise.resolve(id);
  }

  const owner = createTabId();
  const channel = new BroadcastChannel(TAB_CHANNEL);
  let collision = false;
  channel.addEventListener('message', ({ data }: MessageEvent<{ type?: string; id?: string; owner?: string }>) => {
    if (data?.type === 'claim' && data.id === id && data.owner !== owner) {
      channel.postMessage({ type: 'taken', id, owner: data.owner, claimant: owner });
    } else if (data?.type === 'taken' && data.id === id && data.owner === owner) {
      collision = true;
    }
  });
  channel.postMessage({ type: 'claim', id, owner });

  resolvingTabId = new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      try {
        if (collision) {
          id = createTabId();
          target.setItem(TAB_ID_KEY, id);
          channel.postMessage({ type: 'claim', id, owner });
        }
        resolvedTabId = id;
        resolve(id);
      } catch {
        reject(new Error('WFS editing tab identity unavailable'));
      }
    }, 40);
  });
  return resolvingTabId;
}
