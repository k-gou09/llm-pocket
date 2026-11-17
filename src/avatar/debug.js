// Overlay de diagnostic : affiche l'etat reel de l'avatar, la source de la
// synchronisation labiale et le cout de rendu. Active uniquement par '?debug=1'
// ou par la touche 'D'. Il ne change aucun comportement de l'application.

const ROWS = [
  ['etat', (s) => s.state],
  ['emotion', (s) => s.emotion],
  ['viseme', (s) => s.viseme],
  ['sync', (s) => s.syncPath],
  ['amplitude', (s) => (s.amplitude * 100).toFixed(0) + ' %'],
  ['paroles', (s) => String(s.boundaryCount) + ' boundary / ' + String(s.wordCount) + ' mots' + (s.lastBoundaryMs >= 0 ? ' (recalage ok)' : '')],
  ['partition', (s) => s.scriptDurationMs + ' ms'],
  ['micro', (s) => s.dictation],
  ['reseau', (s) => (s.dictationOnline ? 'dictee en ligne' : 'dictee inactive')],
  ['moteur', (s) => (s.engineBusy ? 'calcul en cours' : 'libre')],
  ['image', (s) => s.fps + ' fps (' + s.renderMode + ')'],
  ['memoire', (s) => (s.heapMb >= 0 ? s.heapMb + ' Mo' : 'non mesure')],
];

export class DebugOverlay {
  constructor({ getStats, host = document.body, active = false } = {}) {
    this.getStats = typeof getStats === 'function' ? getStats : () => ({});
    this.active = active;
    this.timer = null;
    this.host = host;

    this.panel = document.createElement('div');
    this.panel.className = 'debug-overlay';
    this.panel.hidden = !this.active;
    this.panel.setAttribute('role', 'status');
    this.panel.setAttribute('aria-live', 'polite');
    this.rows = new Map();

    for (const [label, read] of ROWS) {
      const line = document.createElement('div');
      line.className = 'debug-row';
      const key = document.createElement('span');
      key.className = 'debug-key';
      key.textContent = label;
      const value = document.createElement('span');
      value.className = 'debug-value';
      line.append(key, value);
      this.panel.appendChild(line);
      this.rows.set(label, { read, value });
    }

    const note = document.createElement('div');
    note.className = 'debug-note';
    note.textContent = 'diagnostic : lecture seule, ' + (active ? 'actif' : 'inactif');
    this.panel.appendChild(note);

    this.host.appendChild(this.panel);

    window.addEventListener('keydown', (event) => {
      if (event.key === 'D' || event.key === 'd') {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (target && /input|textarea|select/i.test(target.tagName)) return;
        this.toggle();
      }
    });

    if (this.active) this.#start();
  }

  toggle() {
    this.active = !this.active;
    this.panel.hidden = !this.active;
    if (this.active) this.#start();
    else this.#stop();
  }

  show() {
    if (!this.active) this.toggle();
  }

  destroy() {
    this.#stop();
    this.panel.remove();
  }

  #start() {
    if (this.timer) return;
    this.tick = 0;
    const loop = () => {
      this.tick += 1;
      if (this.tick % 10 === 0) this.#render();
      this.timer = requestAnimationFrame(loop);
    };
    this.#render();
    this.timer = requestAnimationFrame(loop);
  }

  #stop() {
    if (this.timer) cancelAnimationFrame(this.timer);
    this.timer = null;
  }

  #render() {
    const stats = this.getStats();
    for (const [label, entry] of this.rows) {
      let text = '';
      try {
        text = String(entry.read(stats) ?? '');
      } catch {
        text = '';
      }
      if (entry.value.textContent !== text) entry.value.textContent = text;
    }
    const sync = String(stats.syncPath ?? '');
    this.panel.classList.toggle('debug-ok', sync === 'boundary');
    this.panel.classList.toggle('debug-warn', sync === 'estimate' || sync === 'silent');
  }
}
