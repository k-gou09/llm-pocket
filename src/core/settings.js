// Preferences de l'application : mode, voix, micro, economie de moyens.
// Stockees dans localStorage, jamais dans le modele, jamais envoyees.

const KEY = 'llm-pocket.settings';

const DEFAULTS = {
  mode: 'chat',
  tts: true,
  mic: true,
  lipSync: true,
  autoSend: true,
  voice: '',
};

const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    console.warn('[settings] lecture impossible', err);
    return { ...DEFAULTS };
  }
}

export const settings = read();

export function save(patch = {}) {
  const next = { ...settings, ...patch };
  let changed = false;
  for (const key of Object.keys(patch)) {
    if (settings[key] !== next[key]) changed = true;
  }
  Object.assign(settings, next);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[settings] sauvegarde impossible', err);
  }
  if (changed) {
    for (const fn of listeners) {
      try {
        fn(settings);
      } catch (err) {
        console.error('[settings] listener', err);
      }
    }
  }
  return settings;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Mode de rendu recommande pour l'avatar : complet, ou simplifie si l'appareil
// est deja en train de calculer une reponse.
export function renderMode(engineBusy) {
  if (reducedMotion()) return 'reduced';
  if (engineBusy) return 'reduced';
  return 'full';
}
