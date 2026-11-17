// Voix : lecture phrase par phrase via speechSynthesis.
// La synchronisation labiale estimee est recalee par les evenements
// "boundary" quand le moteur vocal veut bien les emettre. Aucun acces
// au flux audio n'existe : on ne pretend jamais analyser le son.

import { LipSync } from '../avatar/speech.js';

const SPLIT_SENTENCES = /(?<=[.!?…])\s+/;

export function splitSentences(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(SPLIT_SENTENCES)
    .map((s) => s.trim())
    .filter(Boolean);
}

export class Speaker {
  constructor(avatar, { lang = 'fr-FR', rate = 1, pitch = 1.02, volume = 1 } = {}) {
    this.avatar = avatar;
    this.lang = lang;
    this.rate = Math.min(1.5, Math.max(0.7, Number(rate) || 1));
    this.pitch = pitch;
    this.volume = volume;

    this.speaking = false;
    this.voice = null;
    this.voices = [];
    this.onStateChange = null;
    this._token = 0;
    this._utterance = null;
    this._watchdog = 0;
    this._resolveOne = null;
    this._onEnd = null;
    this._lip = avatar
      ? new LipSync(avatar, { onSyncChange: (mode) => (this.sync = mode) })
      : null;
    this.sync = 'idle';
    this._voicesBound = false;
    // Mesures reelles du moteur vocal (aucune analyse du son, seulement des
    // evenements emis par le navigateur).
    this.lastStartLatencyMs = -1;
    this.estimateFallbackCount = 0;
    this.graceMs = 1200;
    this._grace = 0;
    this.maxRetries = 2;
    this.retryDelayMs = 140;
    this.retryCount = 0;
    this.breatheMs = 120;

    this.refreshVoices();
  }

  // La partition est jouee par LipSync : on expose son etat pour la garde d'etat.
  get lipActive() { return Boolean(this._lip?.active); }

  get supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  // Les voix arrivent en asynchrone sur Chrome : on recharge a chaque lecture.
  refreshVoices() {
    if (!this.supported) return [];
    const all = window.speechSynthesis.getVoices() || [];
    this.voices = all.filter((v) => /^fr/i.test(v.lang));
    const local = this.voices.find((v) => v.localService && /fr[-_]FR/i.test(v.lang));
    const anyFrench = this.voices.find((v) => /fr[-_]FR/i.test(v.lang)) || this.voices[0];
    this.voice = local || anyFrench || null;

    if (!this._voicesBound) {
      this._voicesBound = true;
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.refreshVoices());
    }
    return this.voices;
  }

  get voiceLabel() {
    if (!this.supported) return 'voix indisponible';
    if (!this.voice) return 'voix par defaut';
    return this.voice.name;
  }

  get voiceIsLocal() {
    return Boolean(this.voice && this.voice.localService);
  }

  speak(text, { onStart = null, onEnd = null, onBoundary = null, onSentence = null } = {}) {
    const sentences = splitSentences(text);
    if (!this.supported || sentences.length === 0) {
      onEnd?.({ reason: this.supported ? 'empty' : 'unsupported', cancelled: false });
      return;
    }

    const wasSpeaking = this.speaking;
    this.stop('restart', { silent: true });
    const token = ++this._token;
    this.refreshVoices();
    this.speaking = true;
    this.onStateChange?.('speaking');
    this._onEnd = onEnd;

    const hooks = { onStart, onEnd, onBoundary, onSentence };
    // Chrome ignore parfois une utterance emise juste apres cancel() : respiration
    // systematique (mesure emulator : 'end' sans 'start' sur 3 enonces sur 3).
    const start = () => this.#run(sentences, token, hooks);
    window.setTimeout(start, wasSpeaking ? Math.max(90, this.breatheMs) : this.breatheMs);
  }

  stop(reason = 'cancelled', { silent = false } = {}) {
    this._token += 1;
    clearTimeout(this._watchdog);
    this._watchdog = 0;
    clearTimeout(this._grace);
    this._grace = 0;
    if (this.supported && this.speaking) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* deja arrete */
      }
    }
    if (this._utterance) {
      this._utterance.onend = null;
      this._utterance.onerror = null;
      this._utterance.onboundary = null;
      this._utterance = null;
    }
    // Debloque la chaine en cours : le tour de boucle verra le jeton perime.
    this._resolveOne?.('cancelled');
    this._resolveOne = null;
    this._lip?.stop();
    const wasSpeaking = this.speaking;
    this.speaking = false;
    if (wasSpeaking) this.onStateChange?.('idle');

    const callback = this._onEnd;
    this._onEnd = null;
    if (callback && !silent) callback({ reason, cancelled: true });
  }

  async #run(sentences, token, hooks) {
    for (let i = 0; i < sentences.length; i += 1) {
      if (token !== this._token) return;
      const sentence = sentences[i];
      hooks.onSentence?.(sentence, i, sentences.length);
      const outcome = await this.#speakOne(sentence, token, hooks);
      if (token !== this._token) return;
      if (outcome === 'cancelled') return;
    }

    this._lip?.stop();
    this.speaking = false;
    this.onStateChange?.('idle');
    const callback = this._onEnd;
    this._onEnd = null;
    callback?.({ reason: 'end', cancelled: false });
  }

  #speakOne(text, token, hooks, attemptNo = 1) {
    return new Promise((resolve) => {
      let done = false;
      let started = false;
      let lipStarted = false;
      let current = null;
      const submittedAt = performance.now();

      const startLip = () => {
        if (lipStarted || token !== this._token) return;
        lipStarted = true;
        this._lip?.start(text, { rate: this.rate });
      };

      const clearTimers = () => {
        clearTimeout(this._watchdog);
        this._watchdog = 0;
        clearTimeout(this._grace);
        this._grace = 0;
      };

      const finish = (outcome) => {
        if (done) return;
        done = true;
        this._resolveOne = null;
        clearTimers();
        if (current) {
          current.onstart = null;
          current.onend = null;
          current.onerror = null;
          current.onboundary = null;
        }
        if (token === this._token) {
          this._lip?.stop();
          this._utterance = null;
        }
        resolve(outcome);
      };
      this._resolveOne = finish;

      // Mesure sur l'emulateur Android : une enonce emise juste apres cancel()
      // est parfois ignoree, 'end' arrive dans la milliseconde sans 'start'.
      // On retente une fois, puis on assume l'etat constate.
      const failFast = (outcome) => {
        if (!started && outcome !== 'not-allowed' && attemptNo < this.maxRetries && token === this._token) {
          this.retryCount += 1;
          clearTimers();
          setTimeout(() => {
            if (done || token !== this._token) return;
            this.#speakOne(text, token, hooks, attemptNo + 1).then(resolve);
          }, this.retryDelayMs);
          return;
        }
        finish(outcome);
      };

      // Filet de securite : certains moteurs n'emettent jamais "end".
      this._watchdog = setTimeout(
        () => failFast('timeout'),
        Math.min(30000, 2000 + text.length * 140),
      );

      // Fichier de securite pour la bouche : sur Android le moteur n'emet pas
      // "start" (mesure : 0 start sur certains enonces, 6,9 s de latence). Si
      // rien ne demarre dans graceMs, on lance la partition estimee, sans
      // pretendre savoir quand la voix a commence.
      this._grace = setTimeout(() => {
        if (done || started) return;
        this.estimateFallbackCount += 1;
        startLip();
      }, this.graceMs);

      const arm = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = this.lang;
        utterance.rate = this.rate;
        utterance.pitch = this.pitch;
        utterance.volume = this.volume;
        if (this.voice) utterance.voice = this.voice;

        utterance.onstart = () => {
          if (token !== this._token) return;
          started = true;
          this.lastStartLatencyMs = performance.now() - submittedAt;
          // Ancrage exact : la partition repart du moment ou la voix demarre.
          lipStarted = false;
          startLip();
          hooks.onStart?.(text);
        };
        utterance.onboundary = (event) => {
          if (token !== this._token) return;
          if (typeof event.charIndex === 'number') this._lip?.boundary(event.charIndex);
          hooks.onBoundary?.(event);
        };
        utterance.onend = () => failFast('end');
        utterance.onerror = (event) => failFast(event?.error || 'error');

        current = utterance;
        this._utterance = utterance;
        try {
          window.speechSynthesis.speak(utterance);
        } catch (error) {
          finish('error');
        }
      };

      arm();
    });
  }
}
