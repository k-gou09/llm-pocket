// Point d'entree : preparation du moteur, service worker, application.
import { ChatApp } from './chat/chat.js';
import { Engine } from './engine/wllama-engine.js';
import { Robot } from './robot/robot.js';
import { AvatarScreen } from './avatar/avatar-screen.js';
import { Bus } from './core/bus.js';
import { onChange, save, settings } from './core/settings.js';
import { modelProfile, modelSizeBytes } from './config.js';

const $ = (id) => document.getElementById(id);

const els = {
  engineDot: $('engineDot'),
  btnMenu: $('btnMenu'),
  btnNew: $('btnNew'),
  btnCloseDrawer: $('btnCloseDrawer'),
  drawer: $('drawer'),
  scrim: $('scrim'),
  convList: $('convList'),
  messages: $('messages'),
  empty: $('empty'),
  chat: $('chat'),
  input: $('input'),
  btnSend: $('btnSend'),
  btnPhoto: $('btnPhoto'),
  iSend: document.querySelector('.i-send'),
  iStop: document.querySelector('.i-stop'),
  attachment: $('attachment'),
  attachmentImg: $('attachmentImg'),
  btnRemoveAttachment: $('btnRemoveAttachment'),
  sheet: $('sheet'),
  btnGallery: $('btnGallery'),
  btnCamera: $('btnCamera'),
  btnCancelSheet: $('btnCancelSheet'),
  fileGallery: $('fileGallery'),
  fileCamera: $('fileCamera'),
  setup: $('setup'),
  setupProgress: $('setupProgress'),
  setupFill: $('setupFill'),
  setupStatus: $('setupStatus'),
  setupText: $('setupText'),
  btnDownload: $('btnDownload'),
  toast: $('toast'),
  app: $('app'),
  // Mode Avatar
  host: $('avatarScreen'),
  stage: $('avatarStage'),
  modeSwitch: $('modeSwitch'),
  btnModeChat: $('btnModeChat'),
  btnModeAvatar: $('btnModeAvatar'),
  avatarScreen: $('avatarScreen'),
  avatarStage: $('avatarStage'),
  statusText: $('avatarStatusText'),
  dictationBadge: $('dictationBadge'),
  dictationLine: $('dictationLine'),
  dictationText: $('dictationText'),
  btnDictation: $('btnDictation'),
  btnStopSpeaking: $('btnStopSpeaking'),
  btnSettingTts: $('btnSettingTts'),
  btnSettingMic: $('btnSettingMic'),
  btnSettingAutoSend: $('btnSettingAutoSend'),
  installRow: $('installRow'),
  btnInstall: $('btnInstall'),
};

let installPrompt = null;

const engine = new Engine();
const robot = new Robot($('robot'));
const setupRobot = new Robot($('setupRobot'));
const bus = new Bus();
const app = new ChatApp({ engine, robot, els, bus });
const screen = new AvatarScreen({ els, bus });

const fmtMo = (bytes) => Math.round(bytes / 1048576) + ' Mo';

function setDot(state, label) {
  els.engineDot.className = 'engine-dot ' + state;
  els.engineDot.title = label;
}

function showSetup({ status, indeterminate = false, button = null } = {}) {
  els.setup.hidden = false;
  els.setupProgress.classList.toggle('indeterminate', indeterminate);
  if (typeof status === 'string') els.setupStatus.textContent = status;
  if (button) {
    els.btnDownload.hidden = false;
    els.btnDownload.textContent = button.label;
    els.btnDownload.onclick = button.onClick;
  } else {
    els.btnDownload.hidden = true;
  }
}

function hideSetup() {
  els.setup.hidden = true;
}

async function downloadModel() {
  els.btnDownload.hidden = true;
  els.setupProgress.classList.remove('indeterminate');
  els.setupFill.style.width = '0%';
  els.setupStatus.textContent = 'Téléchargement du modèle…';
  setupRobot.setState('thinking');
  setDot('busy', 'Téléchargement du modèle');

  try {
    await engine.downloadModel(({ loaded, total }) => {
      const pct = total ? Math.round((loaded / total) * 100) : 0;
      els.setupFill.style.width = pct + '%';
      els.setupStatus.textContent = `Téléchargement du modèle : ${pct} % (${fmtMo(
        loaded
      )} / ${fmtMo(total)})`;
    });
    navigator.storage?.persist?.().catch(() => {});
    await loadEngine();
  } catch (err) {
    console.error('[app] téléchargement impossible', err);
    await setupFailed(err);
  }
}

async function loadEngine() {
  els.setupProgress.classList.add('indeterminate');
  els.setupStatus.textContent = "Chargement du moteur d'IA…";
  els.btnDownload.hidden = true;
  setupRobot.setState('thinking');
  setDot('busy', 'Chargement du moteur');

  try {
    const info = await engine.load();
    setDot('ok', 'Moteur prêt');
    app.setVision(engine.profile.vision);
    app.setEngineReady(true);
    hideSetup();
    setupRobot.reset();
    robot.setEmotion('happy');
    console.info('[app] moteur prêt', info);
    if (!engine.profile.vision) {
      app.showToast('Petit modèle texte : les photos sont désactivées.');
    } else if (!info.has_image_input) {
      app.showToast("Vision indisponible sur cet appareil : les photos seront ignorées.");
    }
  } catch (err) {
    console.error('[app] chargement impossible', err);
    await setupFailed(err);
  }
}

async function setupFailed(err) {
  setDot('err', 'Erreur du moteur');
  robot.setEmotion('sad');
  setupRobot.setEmotion('sad');
  const stored = await engine.isModelStored().catch(() => false);
  showSetup({
    status: 'Erreur : ' + (err?.message ?? err),
    indeterminate: false,
    button: stored
      ? { label: 'Réessayer le chargement', onClick: loadEngine }
      : { label: 'Réessayer le téléchargement', onClick: downloadModel },
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  // Le mode discret du service worker suit celui de la page : '?debug=1' sur l'URL
  // de l'app enregistre './sw.js?debug=1', ce qui donne une ligne par requete.
  const debug = new URL(location.href).searchParams.get('debug') === '1';
  try {
    await navigator.serviceWorker.register(debug ? './sw.js?debug=1' : './sw.js');
    console.info('[app] service worker actif');
  } catch (err) {
    console.warn('[app] service worker indisponible', err);
    return false;
  }

  // GitHub Pages ne peut pas envoyer COOP/COEP. Le service worker les reinjecte,
  // mais la premiere page chargee n'est pas encore isolee : un seul rechargement
  // apres sa prise de controle active le multi-thread de wllama.
  if (self.crossOriginIsolated) return false;
  const KEY = 'llm-pocket.isolation-reload';
  if (sessionStorage.getItem(KEY)) return false;
  sessionStorage.setItem(KEY, '1');
  await navigator.serviceWorker.ready.catch(() => null);
  if (navigator.serviceWorker.controller) {
    location.reload();
    return true;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  return false;
}

// Bouton d'installation : Chrome Android propose 'beforeinstallprompt' quand l'app
// est servie en HTTPS et que le manifeste est complet. Sans cet evenement (iOS,
// deja installee), la ligne reste masquee.
function setupInstall() {
  if (!els.installRow || !els.btnInstall) return;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    els.installRow.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    els.installRow.hidden = true;
    app.showToast('Application installée.');
  });

  els.btnInstall.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    if (choice?.outcome === 'accepted') els.installRow.hidden = true;
  });
}

// ---------- modes ----------

function setMode(mode, options = {}) {
  const next = mode === 'avatar' ? 'avatar' : 'chat';
  els.app.dataset.mode = next;
  els.chat.hidden = next !== 'chat';
  els.avatarScreen.hidden = next !== 'avatar';
  els.btnModeChat.classList.toggle('is-active', next === 'chat');
  els.btnModeAvatar.classList.toggle('is-active', next === 'avatar');
  els.btnModeChat.setAttribute('aria-selected', next === 'chat' ? 'true' : 'false');
  els.btnModeAvatar.setAttribute('aria-selected', next === 'avatar' ? 'true' : 'false');
  screen.applyMode(next, options);
  if (next === 'chat') robot.reset();
  if (settings.mode !== next) {
    // save declenche onChange : on evite la boucle en comparant deja ici.
    const previous = settings.mode;
    if (previous !== next) save({ mode: next });
  }
}

function renderSettings() {
  els.btnSettingTts.setAttribute('aria-checked', settings.tts ? 'true' : 'false');
  els.btnSettingTts.textContent = settings.tts ? 'activée' : 'désactivée';
  els.btnSettingMic.setAttribute('aria-checked', settings.mic ? 'true' : 'false');
  els.btnSettingMic.textContent = settings.mic ? 'activé' : 'désactivé';
  els.btnSettingAutoSend.setAttribute('aria-checked', settings.autoSend ? 'true' : 'false');
  els.btnSettingAutoSend.textContent = settings.autoSend ? 'activé' : 'désactivé';
  els.btnDictation.disabled = !settings.mic;
  els.btnDictation.classList.toggle('is-active', settings.mic && screen.dictation.state === 'listening');
  els.btnDictation.setAttribute('aria-pressed', screen.dictation.state === 'listening' ? 'true' : 'false');
}

function bindMode() {
  els.btnModeChat.addEventListener('click', () => setMode('chat', { fromUser: true }));
  els.btnModeAvatar.addEventListener('click', () => setMode('avatar', { fromUser: true }));

  els.btnSettingTts.addEventListener('click', () => {
    save({ tts: !settings.tts });
    if (!settings.tts) screen.stopSpeaking();
    renderSettings();
  });

  els.btnSettingMic.addEventListener('click', () => {
    save({ mic: !settings.mic });
    if (!settings.mic) screen.stopDictation();
    renderSettings();
  });

  els.btnSettingAutoSend.addEventListener('click', () => {
    save({ autoSend: !settings.autoSend });
    renderSettings();
  });

  els.btnDictation.addEventListener('click', () => {
    if (!settings.mic) return;
    if (screen.dictation.state === 'listening') screen.stopDictation();
    else screen.startDictation();
    renderSettings();
  });

  els.btnStopSpeaking.addEventListener('click', () => {
    screen.stopSpeaking();
    els.btnStopSpeaking.disabled = true;
  });

  bus.on('avatarState', (state) => {
    els.btnStopSpeaking.disabled = state !== 'speaking';
    renderSettings();
  });

  bus.on('dictation', (result) => {
    if (!result.isFinal) return;
    const text = String(result.text ?? '').trim();
    if (!text) return;
    const current = els.input.value.trim();
    els.input.value = current ? `${current} ${text}` : text;
    if (settings.autoSend && settings.mode === 'avatar' && !app.busy) {
      app.sendText(els.input.value);
    }
  });

  bus.on('reply', ({ text }) => {
    if (settings.mode === 'avatar') screen.speak(text);
  });

  bus.on('state', ({ state, mode }) => {
    if (mode === 'chat' && settings.mode === 'avatar') screen.applyState(state);
  });

  bus.on('emotion', ({ emotion, duration, mode }) => {
    if (mode === 'chat' && settings.mode === 'avatar') screen.applyEmotion(emotion, duration);
  });

  bus.on('notice', (message) => app.showToast(message));
}

async function start() {
  showSetup({ status: 'Préparation…', indeterminate: true });
  if (await registerServiceWorker()) return;
  setupInstall();
  navigator.storage?.persist?.().catch(() => {});

  try {
    await app.init();
  } catch (err) {
    console.error('[app] stockage indisponible', err);
    app.showToast('Stockage local indisponible dans ce navigateur.');
  }

  app.setEngineReady(false);
  setupRobot.setState('idle');
  bindMode();
  setMode(settings.mode);
  renderSettings();
  onChange(renderSettings);

  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') screen.runDemo();

  const stored = await engine.isModelStored().catch(() => false);
  if (!stored) {
    const profile = modelProfile();
    const sizeMo = fmtMo(modelSizeBytes(profile));
    showSetup({
      status:
        `${profile.label} : le modèle doit être téléchargé une seule fois (environ ${sizeMo}). ` +
        'Ensuite, tout fonctionne hors ligne.',
      indeterminate: false,
      button: { label: `Télécharger le modèle (≈ ${sizeMo})`, onClick: downloadModel },
    });
    setupRobot.setEmotion('surprised');
    return;
  }

  showSetup({ status: "Chargement du moteur d'IA…", indeterminate: true });
  await loadEngine();
}

// Sonde pour les tests automatiques (adb + CDP) : meme forme que la maquette.
window.__pocket = {
  settings,
  bus,
  app,
  screen,
  avatar: screen.avatar,
  speaker: screen.speaker,
  dictation: screen.dictation,
  player: screen.player,
  applyState: (state) => screen.applyState(state),
  setMode: (mode) => setMode(mode),
  speakText: (text) => screen.speak(text),
  stopAll: () => {
    screen.stopSpeaking();
    screen.stopDictation();
  },
};

start();
