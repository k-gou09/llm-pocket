// Robot compagnon : SVG anime, etats et humeurs.
const SVG = `
<svg viewBox="0 0 120 132" role="presentation" focusable="false">
  <ellipse class="shadow" cx="60" cy="125" rx="27" ry="4.5"/>
  <g class="robot-body">
    <line class="antenna" x1="60" y1="27" x2="60" y2="12"/>
    <circle class="antenna-ball" cx="60" cy="9.5" r="4.8"/>
    <rect class="head" x="22" y="26" width="76" height="62" rx="24"/>
    <rect class="visor" x="30" y="34" width="60" height="46" rx="18"/>
    <g class="eyes">
      <circle class="eye" cx="47" cy="55" r="4.6"/>
      <circle class="eye" cx="73" cy="55" r="4.6"/>
    </g>
    <g class="eyes-happy">
      <path d="M41 57 q6 -7 12 0"/>
      <path d="M67 57 q6 -7 12 0"/>
    </g>
    <g class="eyes-sad">
      <path d="M41 54 q6 7 12 0"/>
      <path d="M67 54 q6 7 12 0"/>
    </g>
    <g class="eyes-surprised">
      <circle cx="47" cy="55" r="6.6"/>
      <circle cx="73" cy="55" r="6.6"/>
    </g>
    <path class="mouth" d="M52 68 q8 5 16 0"/>
    <g class="mouth-talk"><rect x="52" y="64.5" width="16" height="6.5" rx="3.2"/></g>
    <g class="mouth-o"><ellipse cx="60" cy="68" rx="4.6" ry="5.8"/></g>
    <rect class="neck" x="54" y="86" width="12" height="7" rx="3.5"/>
    <rect class="torso" x="34" y="93" width="52" height="27" rx="12"/>
    <rect class="arm" x="20" y="96" width="10" height="19" rx="5"/>
    <rect class="arm" x="90" y="96" width="10" height="19" rx="5"/>
    <circle class="chest" cx="60" cy="106.5" r="4"/>
  </g>
  <g class="think-dots">
    <circle cx="46" cy="16" r="2.6"/>
    <circle cx="60" cy="11.5" r="2.6"/>
    <circle cx="74" cy="16" r="2.6"/>
  </g>
</svg>`;

export class Robot {
  #el;
  #emotionTimer = null;

  constructor(el) {
    this.#el = el ?? null;
    if (this.#el) {
      this.#el.innerHTML = SVG;
      this.#el.dataset.state = 'idle';
      this.#el.dataset.emotion = 'neutral';
    }
  }

  get element() {
    return this.#el;
  }

  setState(state) {
    if (this.#el) this.#el.dataset.state = state;
  }

  setEmotion(emotion, duration = 2200) {
    if (!this.#el) return;
    this.#el.dataset.emotion = emotion;
    clearTimeout(this.#emotionTimer);
    if (emotion !== 'neutral' && duration > 0) {
      this.#emotionTimer = setTimeout(() => {
        this.#el.dataset.emotion = 'neutral';
      }, duration);
    }
  }

  reset() {
    this.setState('idle');
    this.setEmotion('neutral', 0);
  }
}
