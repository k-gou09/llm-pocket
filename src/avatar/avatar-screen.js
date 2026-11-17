// Ecran Avatar : assemblage de l'avatar, de la voix, de la dictee et du
// diagnostic. Ce module ne dessine pas la page : il recoit les elements DOM
// deja presentes dans index.html et se contente de les animer.
//
// Points importants :
// - la voix utilise speechSynthesis : aucun acces au flux audio, la
//   synchronisation labiale est une estimation recalee par les evenements
//   'boundary' quand le moteur les emet ;
  // - la dictee utilise SpeechRecognition du navigateur, donc un service en
  //   ligne : elle est signalee par un badge et peut etre desactivee ;
  // - quand la voix est desactivee, la bouche peut encore s'animer en mode
  //   "silencieux" : on ne fait alors semblant de rien, le mode est affiche.

import { Avatar } from './avatar.js';
import { DebugOverlay } from './debug.js';
import { buildVisemeScript, VisemePlayer } from './speech.js';
import { Dictation } from '../voice/dictation.js';
import { Speaker } from '../voice/tts.js';
import { reducedMotion, renderMode, settings } from '../core/settings.js';

const SILENT_VISEME_MS = 140;
const ERROR_HOLD_MS = 2600;

const STATE_LABELS = {
  idle: 'repos',
  listening: 'ecoute',
  thinking: 'analyse',
  speaking: 'parole',
  error: 'erreur',
};

export class AvatarScreen {
  constructor({ els, bus }) {
    this.els = els;
    this.bus = bus;

    this.avatar = new Avatar(els.stage, { reducedMotion: reducedMotion() });
    this.speaker = new Speaker(this.avatar, { lang: 'fr-FR' });
    this.player = new VisemePlayer(this.avatar);
    this.dictation = new Dictation({ lang: 'fr-FR' });
    this.dictationUsage = false;

    this.mode = settings.mode;
    this.busy = false;
    this.syncPath = 'idle';
    this.fps = 0;
    this.frameSamples = [];
    this.boundaryCount = 0;
    this.wordCount = 0;
    this.lastBoundaryMs = -1;
    this.scriptDurationMs = 0;
    this.speakStartCount = 0;
    this.speakStartedAt = -1;
    this.lastSpeechMs = 0;
    this.blockedCount = 0;
    this.errorHoldUntil = 0;

    this.speaker.onStateChange = (state) => {
      if (state === 'speaking') this.applyState('speaking');
      else if (!this.busy) this.applyState('idle');
    };

    this.dictation.on('state', (state) => {
      this.renderDictationState(state);
      if (state === 'listening' && !this.busy && this.mode === 'avatar' && !this.speaker.speaking) {
        this.applyState('listening');
      } else if (state !== 'listening' && !this.busy && !this.speaker.speaking && !this.player.playing && this.avatar.state === 'listening') {
        // La dictee s'arrete (fin de session, arret ou erreur) : l'avatar ne doit
        // pas rester bloque sur "ecoute" alors que plus personne n'ecoute.
        this.applyState('idle');
      }
    });

    this.dictation.on('result', (result) => {
      this.renderDictationText(result.text);
      this.bus.emit('dictation', result);
    });

    this.dictation.on('error', (error) => {
      // 'requires-activation' n'est pas un refus du navigateur : c'est notre
      // regle. On reste au repos et on demande un geste, sans pretendre que la
      // reconnaissance a echoue.
      if (error.code === 'requires-activation') {
        if (!this.busy) this.applyState('idle');
        this.bus.emit('notice', error.message);
        return;
      }
      this.applyState('error');
      this.bus.emit('notice', error.message || 'Dictee indisponible.');
    });

    this.dictation.on('usage', (info) => {
      this.bus.emit('notice', info.message);
    });

    this.bus.on('engine', (info) => {
      this.busy = Boolean(info?.busy);
      this.avatar.setPaused(document.hidden);
    });

    // Perte du reseau pendant la dictee : on ferme le micro au lieu de laisser
    // un badge "en ligne" alors que la reconnaissance ne peut plus repondre.
    this.onOffline = () => {
      if (this.dictation.state === 'listening') this.dictation.stop();
    };
    globalThis.addEventListener?.('offline', this.onOffline);

    this.debug = new DebugOverlay({
      getStats: () => this.stats(),
      host: els.host,
      active: new URLSearchParams(location.search).get('debug') === '1',
    });

    this.startFrameMeter();

    this.applyMode(this.mode);
  }

  // ---------- etats ----------

  applyState(state) {
    // L'etat 'error' doit rester visible le temps de la notice : le mode Chat
    // remet l'avatar au repos dans la meme seconde, sans cela l'erreur ne se
    // voit jamais. On ne bloque que les etats plus courts.
    if (state === 'error') {
      this.errorHoldUntil = performance.now() + ERROR_HOLD_MS;
    } else if (performance.now() < this.errorHoldUntil) {
      return;
    }

    // Un etat "repos" ne doit jamais couper une animation en cours : la bouche est
    // occupee par la voix ou par la partition (LipSync ou VisemePlayer).
    if (state === 'idle' && (this.speaker.speaking || this.speaker.lipActive || this.player.playing)) return;

    this.avatar.setState(state);
    this.els.host.dataset.state = state;
    const statusText = this.els.statusText;
    if (statusText) statusText.textContent = STATE_LABELS[state] || state;
    this.bus.emit('avatarState', state);
  }

  applyEmotion(emotion, duration = 2400) {
    this.avatar.setEmotion(emotion, duration);
    this.bus.emit('avatarEmotion', emotion);
  }

  // ---------- voix ----------

  // Lecture d'une reponse. Si la voix est desactivee, on reste explicite :
  // la bouche est animee par la partition, sans pretendre produire du son.
  speak(text) {
    const clean = String(text ?? '').trim();
    if (!clean) return;

    const script = buildVisemeScript(clean, { rate: this.speaker.rate });
    this.wordCount = clean.split(/\s+/).filter(Boolean).length;
    this.scriptDurationMs = script.length ? script[script.length - 1].at : 0;

    // La reconnaissance en ligne peut empecher la voix de demarrer sur Android :
    // on l'arrete pendant la lecture, puis on la reprend si l'utilisateur l'avait
    // lancee. Rien n'est simule : on mesure seulement ce que le navigateur accepte.
    const resumeDictation = this.mode === 'avatar' && settings.mic
      && this.dictation.state === 'listening';
    if (resumeDictation) this.dictation.stop();

    const runSpeaker = () => {
      this.speaker.speak(clean, {
        onStart: () => {
          this.speakStartedAt = performance.now();
          this.speakStartCount += 1;
        },
        onSentence: () => this.applyState('speaking'),
        onBoundary: () => {
          this.boundaryCount += 1;
          this.lastBoundaryMs = performance.now();
        },
        onEnd: (info) => {
          const reason = info?.reason;
          // Honnetete : un 'end' sans 'start' veut dire que le navigateur n'a pas
          // lance la voix (geste utilisateur requis, ou moteur vocal indisponible).
          if (reason === 'not-allowed') {
            this.blockedCount += 1;
            this.bus.emit('notice', 'Voix refusee par le navigateur : la lecture doit partir d un geste utilisateur.');
          } else if (reason === 'end' && this.speakStartedAt < 0) {
            this.blockedCount += 1;
            this.bus.emit('notice', 'Voix non demarree par le navigateur : animation seule, sans son.');
          } else if (reason === 'end' && this.speakStartedAt >= 0) {
            this.lastSpeechMs = performance.now() - this.speakStartedAt;
          }
          if (reason === 'end') this.applyEmotion('happy', 1600);
          this.syncPath = 'idle';
          if (!this.busy) this.applyState('idle');
          if (resumeDictation) this.dictation.start().catch(() => {});
        },
      });
    };

    if (!settings.tts || !this.speaker.supported) {
      this.syncPath = settings.tts ? 'voix indisponible' : 'silencieux';
      this.applyState('speaking');
      if (settings.lipSync) {
        this.player.play(script, () => {
          if (!this.busy) this.applyState('idle');
          this.syncPath = 'idle';
          if (resumeDictation) this.dictation.start().catch(() => {});
        });
      } else {
        window.setTimeout(() => {
          if (!this.busy) this.applyState('idle');
          this.syncPath = 'idle';
          if (resumeDictation) this.dictation.start().catch(() => {});
        }, SILENT_VISEME_MS);
      }
      return;
    }

    this.speakStartedAt = -1;

    // Mesure sur l'emulateur : la reconnaissance en ligne bloque la voix tant
    // qu'elle tient le micro. On attend qu'elle ait lache, sinon 'end' arrive
    // dans la milliseconde sans que la voix ne demarre.
    if (resumeDictation) window.setTimeout(runSpeaker, 400);
    else runSpeaker();
  }

  stopSpeaking() {
    this.speaker.stop('user');
    this.player.stop();
    this.syncPath = 'idle';
    if (!this.busy) this.applyState('idle');
  }

  // ---------- dictee ----------

  async startDictation() {
    if (!settings.mic) return;
    if (!Dictation.supported) {
      this.bus.emit('notice', 'Reconnaissance vocale indisponible dans ce navigateur.');
      return;
    }
    // La reconnaissance du navigateur passe par un service en ligne : hors
    // ligne, on n'ouvre pas le micro pour rien.
    if (!navigator.onLine) {
      this.bus.emit('notice', 'Dictee indisponible hors ligne : la reconnaissance passe par le reseau.');
      this.applyState('idle');
      return;
    }
    await this.dictation.start();
  }

  stopDictation() {
    this.dictation.stop();
  }

  // ---------- mode ----------

  // options.fromUser=true : le mode vient d'un clic dans l'application. Au
  // demarrage a froid, on ne lance pas la dictee : ouvrir le micro sans geste
  // volontaire surprendrait, et le reseau peut manquer.
  applyMode(mode, options = {}) {
    this.mode = mode === 'avatar' ? 'avatar' : 'chat';
    this.els.host.classList.toggle('avatar-mode', this.mode === 'avatar');
    if (this.mode !== 'avatar') this.stopDictation();

    const dictationBadge = this.els.dictationBadge;
    dictationBadge.hidden = this.mode !== 'avatar' || !settings.mic || !Dictation.supported;
    this.els.dictationLine.hidden = this.mode !== 'avatar' || !settings.mic || !Dictation.supported;

    if (this.mode === 'avatar' && settings.mic && Dictation.supported) {
      // Mesure sur Android : sans geste utilisateur, le navigateur refuse l'acces au
      // micro. On ne lance donc la dictee que pendant un clic ou une touche ; sinon on
      // attend le bouton micro, sans pretendre que la reconnaissance a echoue.
      if (options.fromUser && navigator.onLine && globalThis.navigator?.userActivation?.isActive) {
        this.startDictation();
      } else {
        this.applyState('idle');
      }
    } else if (this.mode === 'avatar') this.applyState('idle');
  }

  // ---------- mesures ----------

  stats() {
    return {
      state: this.avatar.state,
      emotion: this.avatar.emotion,
      viseme: this.avatar.viseme,
      amplitude: Number(this.avatar.el.style.getPropertyValue('--jaw') || 0),
      syncPath: this.speaker.speaking ? this.speaker.sync : this.syncPath,
      lipActive: this.speaker.lipActive,
      boundaryCount: this.boundaryCount,
      wordCount: this.wordCount,
      lastBoundaryMs: this.lastBoundaryMs >= 0 ? Math.round(performance.now() - this.lastBoundaryMs) : -1,
      scriptDurationMs: this.scriptDurationMs,
      dictation: this.dictation.state,
      dictationOnline: Dictation.supported,
      speechStartCount: this.speakStartCount,
      speechBlockedCount: this.blockedCount,
      lastSpeechMs: Math.round(this.lastSpeechMs),
      startLatencyMs: Math.round(this.speaker.lastStartLatencyMs),
      estimateFallbackCount: this.speaker.estimateFallbackCount,
      retryCount: this.speaker.retryCount,
      engineBusy: this.busy,
      fps: this.fps,
      renderMode: renderMode(this.busy),
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    };
  }

  startFrameMeter() {
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      this.frameSamples.push(now - last);
      last = now;
      if (this.frameSamples.length > 30) this.frameSamples.shift();
      const avg = this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;
      this.fps = avg > 0 ? Math.round(1000 / avg) : 0;
      this.frameTimer = requestAnimationFrame(loop);
    };
    this.frameTimer = requestAnimationFrame(loop);
  }

  // ---------- rendu DOM ----------

  renderDictationText(text) {
    const line = this.els.dictationText;
    line.textContent = text || '';
    this.els.dictationLine.classList.toggle('has-text', Boolean(text));
  }

  renderDictationState(state) {
    this.els.dictationLine.dataset.dictationState = state;
    const badge = this.els.dictationBadge;
    badge.classList.toggle('listening', state === 'listening');
    badge.classList.toggle('unsupported', state === 'unsupported');
    badge.classList.toggle('error', state === 'error');
  }

  runDemo() {
    const demoText =
      "Bonjour, je suis Pocket. Dans ce mode, mes yeux suivent la conversation, " +
      "ma bouche bouge pendant que je parle, et tu peux me dicter tes questions.";
    this.applyMode('avatar');
    this.applyState('thinking');
    window.setTimeout(() => this.speak(demoText), 900);
  }

  destroy() {
    cancelAnimationFrame(this.frameTimer);
    globalThis.removeEventListener?.('offline', this.onOffline);
    this.dictation.destroy();
    this.speaker.stop('destroy');
    this.player.stop();
    this.avatar.destroy();
    this.debug.destroy();
  }
}
