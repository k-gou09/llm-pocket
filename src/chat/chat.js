// Logique de l'application : conversations, messages, photos, robot.
import { CONFIG, modelProfile } from '../config.js';
import * as idb from '../storage/idb.js';
import { preparePhoto } from '../photos/photos.js';

const CURRENT_KEY = 'llm-pocket.currentConv';
const CHAT_STATES = ['idle', 'listening', 'thinking', 'speaking'];

const AVATAR_SVG = `
<svg viewBox="0 0 40 40" role="presentation" focusable="false">
  <line x1="20" y1="9" x2="20" y2="5" stroke="#34455a" stroke-width="2" stroke-linecap="round"/>
  <circle cx="20" cy="4" r="2" fill="#6ee7b7"/>
  <rect x="4" y="9" width="32" height="26" rx="10" fill="#23303e" stroke="#34455a" stroke-width="1.8"/>
  <rect x="8" y="13" width="24" height="18" rx="7" fill="#0a1118"/>
  <circle cx="15.5" cy="22" r="2.8" fill="#6ee7b7"/>
  <circle cx="24.5" cy="22" r="2.8" fill="#6ee7b7"/>
</svg>`;

const TRASH_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false">
  <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/>
</svg>`;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function deriveTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Photo';
  return clean.length > 42 ? clean.slice(0, 42).trimEnd() + '…' : clean;
}

function formatWhen(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export class ChatApp {
  constructor({ engine, robot, els, bus = null }) {
    this.engine = engine;
    this.robot = robot;
    this.els = els;
    this.bus = bus;
    this.conversations = [];
    this.current = null;
    this.busy = false;
    this.engineReady = false;
    this.vision = true;
    this.pendingPhoto = null;
    this.toastTimer = null;
  }

  // Le robot reste la source visuelle du mode Chat. Le bus permet au mode
  // Avatar de suivre les memes etats sans dupliquer la logique de l'app.
  emitState(state) {
    // Le robot du mode Chat ne connait pas l'etat 'error' : on ne lui passe
    // que les etats qu'il sait rendre, l'evenement complet va au bus.
    if (this.robot && CHAT_STATES.includes(state)) this.robot.setState(state);
    this.bus?.emit('state', { state, mode: 'chat' });
  }

  emitEmotion(emotion, duration = 0) {
    this.robot?.setEmotion(emotion, duration);
    this.bus?.emit('emotion', { emotion, duration, mode: 'chat' });
  }

  async init() {
    this.#bind();
    try {
      this.conversations = await idb.listConversations();
    } catch (err) {
      console.error('[chat] IndexedDB indisponible', err);
      this.conversations = [];
    }

    const lastId = localStorage.getItem(CURRENT_KEY);
    const conv =
      this.conversations.find((c) => c.id === lastId) ??
      this.conversations[0] ??
      this.#blankConversation();
    this.#openConversation(conv);
    this.#updateSendButton();
  }

  setEngineReady(ready) {
    this.engineReady = ready;
    this.els.input.disabled = !ready;
    this.els.input.placeholder = ready ? 'Message…' : 'Chargement du moteur…';
    this.els.btnPhoto.disabled = !ready || !this.vision;
    this.#updateSendButton();
  }

  // Certains profils de modele n'ont pas de projecteur vision : la photo reste
  // alors desactivee au lieu d'envoyer une image que le modele ne comprend pas.
  setVision(enabled) {
    this.vision = Boolean(enabled);
    this.els.btnPhoto.disabled = !this.engineReady || !this.vision;
    if (!this.vision) {
      this.pendingPhoto = null;
      this.#updateAttachment();
    }
  }

  showToast(message) {
    const el = this.els.toast;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 4500);
  }

  focusInput() {
    this.els.input.focus();
  }

  // Permet au mode Avatar (dictee) d'envoyer un texte sans passer par le
  // clavier : l'appelant ne fait que fournir le texte reconnu.
  sendText(text) {
    const clean = String(text ?? '').trim();
    if (!clean || this.busy) return;
    this.els.input.value = clean;
    this.#autosize();
    this.send();
  }

  newConversation() {
    if (this.busy) this.engine.stop();
    this.pendingPhoto = null;
    this.#updateAttachment();
    this.#closeDrawer();
    this.#openConversation(this.#blankConversation());
    this.els.input.focus();
  }

  async deleteConversation(conv) {
    const label = conv.title || 'cette conversation';
    if (!confirm(`Supprimer « ${label} » ?`)) return;
    try {
      await idb.deleteConversation(conv.id);
    } catch (err) {
      console.error('[chat] suppression impossible', err);
      this.showToast('Suppression impossible.');
      return;
    }
    this.conversations = this.conversations.filter((c) => c.id !== conv.id);
    if (this.current?.id === conv.id) {
      this.#openConversation(this.conversations[0] ?? this.#blankConversation());
    } else {
      this.#renderConversationList();
    }
  }

  // ---------- envoi ----------

  async send() {
    if (this.busy || !this.engineReady || !this.current) return;
    const els = this.els;
    const text = els.input.value.trim();
    const photo = this.pendingPhoto;
    if (!text && !photo) return;

    const conv = this.current;
    const finalText = text || 'Décris cette photo.';
    if (!conv.messages.length) conv.title = deriveTitle(finalText);

    const userMsg = {
      id: uid(),
      role: 'user',
      text: finalText,
      imageThumb: photo?.thumbDataUrl ?? null,
      ts: Date.now(),
    };
    conv.messages.push(userMsg);

    els.input.value = '';
    this.#autosize();
    this.pendingPhoto = null;
    this.#updateAttachment();
    this.#appendUserMessage(userMsg);
    els.empty.hidden = true;
    this.#persist(conv);
    this.#scrollToBottom();

    const engineMessages = this.#buildEngineMessages(conv, photo);
    const { wrap, bubble, textNode } = this.#createAssistantBubble();

    this.#setBusy(true);
    this.emitState('thinking');
    this.emitEmotion('neutral', 0);
    let textStarted = false;

    try {
      const { text: reply, timings } = await this.engine.generate(engineMessages, {
        onDelta: (delta) => {
          if (!textStarted) {
            textStarted = true;
            bubble.innerHTML = '';
            bubble.appendChild(textNode);
            bubble.dataset.done = 'false';
            this.emitState('speaking');
          }
          textNode.appendData(delta);
          this.#scrollToBottom();
        },
      });

      const clean = reply.trim();
      bubble.dataset.done = 'true';
      if (clean) {
        bubble.textContent = clean;
        conv.messages.push({ id: uid(), role: 'assistant', text: clean, ts: Date.now() });
        await this.#persist(conv);
        this.bus?.emit('reply', { text: clean });
      } else {
        bubble.textContent = '…';
      }
      this.emitState('idle');
      this.emitEmotion('happy');
      if (timings?.predicted_per_second) {
        console.info(`[chat] ${timings.predicted_per_second.toFixed(1)} tok/s`);
      }
    } catch (err) {
      const aborted = err?.name === 'WllamaAbortError' || /abort/i.test(err?.message ?? '');
      if (aborted) {
        const partial = textNode.textContent.trim();
        if (partial) {
          bubble.dataset.done = 'true';
          conv.messages.push({ id: uid(), role: 'assistant', text: partial, ts: Date.now() });
          await this.#persist(conv);
        } else {
          wrap.remove();
        }
        this.emitState('idle');
        this.emitEmotion('neutral', 0);
      } else {
        console.error('[chat] génération impossible', err);
        bubble.dataset.done = 'true';
        bubble.classList.add('error');
        bubble.textContent =
          "Désolé, je n'ai pas réussi à répondre. Réessaie dans un instant.";
        const message = String(err?.message ?? err);
        // L'avatar doit afficher l'etat 'error' : le robot du mode Chat ne sait
        // pas le rendre, donc on le passe seulement au bus puis on le remet au repos.
        this.bus?.emit('state', { state: 'error', mode: 'chat' });
        this.emitState('idle');
        this.emitEmotion('sad');
        this.showToast(
          /context|kv|token/i.test(message)
            ? 'Conversation trop longue : ouvre une nouvelle conversation.'
            : 'Erreur du moteur : ' + message
        );
      }
    } finally {
      this.#setBusy(false);
      this.#scrollToBottom();
    }
  }

  // ---------- rendu ----------

  #blankConversation() {
    const now = Date.now();
    return {
      id: uid(),
      title: 'Nouvelle conversation',
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  #openConversation(conv) {
    this.current = conv;
    this.#renderMessages();
    this.#renderConversationList();
    if (this.conversations.some((c) => c.id === conv.id)) {
      localStorage.setItem(CURRENT_KEY, conv.id);
    }
    this.#scrollToBottom();
  }

  #renderMessages() {
    const { messages, empty } = this.els;
    messages.innerHTML = '';
    if (!this.current) {
      empty.hidden = false;
      return;
    }
    for (const msg of this.current.messages) {
      if (msg.role === 'user') this.#appendUserMessage(msg);
      else this.#appendAssistantMessage(msg);
    }
    empty.hidden = this.current.messages.length > 0;
  }

  #appendUserMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (msg.imageThumb) {
      const img = document.createElement('img');
      img.src = msg.imageThumb;
      img.alt = 'Photo jointe';
      bubble.appendChild(img);
    }
    if (msg.text) bubble.appendChild(document.createTextNode(msg.text));
    wrap.appendChild(bubble);
    this.els.messages.appendChild(wrap);
    return bubble;
  }

  #appendAssistantMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const row = document.createElement('div');
    row.className = 'assistant-row';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = AVATAR_SVG;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.text;
    bubble.dataset.done = 'true';
    row.append(avatar, bubble);
    wrap.appendChild(row);
    this.els.messages.appendChild(wrap);
    return bubble;
  }

  #createAssistantBubble() {
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const row = document.createElement('div');
    row.className = 'assistant-row';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = AVATAR_SVG;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.dataset.done = 'false';
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    const textNode = document.createTextNode('');
    row.append(avatar, bubble);
    wrap.appendChild(row);
    this.els.messages.appendChild(wrap);
    this.#scrollToBottom();
    return { wrap, bubble, textNode };
  }

  #renderConversationList() {
    const list = this.els.convList;
    list.innerHTML = '';
    const items = [...this.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!items.length) {
      const note = document.createElement('div');
      note.className = 'drawer-foot';
      note.textContent = 'Aucune conversation pour le moment.';
      list.appendChild(note);
      return;
    }

    for (const conv of items) {
      const item = document.createElement('div');
      item.className = 'conv-item' + (this.current?.id === conv.id ? ' active' : '');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      const text = document.createElement('div');
      text.className = 'conv-text';
      const title = document.createElement('div');
      title.className = 'conv-title';
      title.textContent = conv.title || 'Conversation';
      const sub = document.createElement('div');
      sub.className = 'conv-sub';
      const count = conv.messages?.length ?? 0;
      sub.textContent = `${formatWhen(conv.updatedAt)} · ${count} message${count > 1 ? 's' : ''}`;
      text.append(title, sub);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'conv-del';
      del.setAttribute('aria-label', 'Supprimer la conversation');
      del.innerHTML = TRASH_SVG;
      del.addEventListener('click', (event) => {
        event.stopPropagation();
        this.deleteConversation(conv);
      });

      item.append(text, del);
      item.addEventListener('click', () => this.openConversationById(conv.id));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.openConversationById(conv.id);
        }
      });
      list.appendChild(item);
    }
  }

  openConversationById(id) {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return;
    if (this.busy) this.engine.stop();
    this.#closeDrawer();
    this.#openConversation(conv);
  }

  // ---------- historique moteur ----------

  #buildEngineMessages(conv, photo) {
    const budget = CONFIG.historyCharBudget;
    const history = [];
    let used = 0;

    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const msg = conv.messages[i];
      const content = msg.text ?? '';
      if (history.length > 0 && used + content.length > budget) break;
      used += content.length;
      history.unshift({ role: msg.role, content });
    }

    const last = history[history.length - 1];
    if (photo && last?.role === 'user') {
      last.content = [
        { type: 'image', data: photo.buffer },
        { type: 'text', text: last.content || 'Décris cette photo.' },
      ];
    }

    return [{ role: 'system', content: modelProfile().systemPrompt }, ...history];
  }

  // ---------- persistance ----------

  async #persist(conv) {
    conv.updatedAt = Date.now();
    try {
      await idb.putConversation(conv);
    } catch (err) {
      console.error('[chat] sauvegarde impossible', err);
      this.showToast('Sauvegarde impossible : stockage plein ?');
      return;
    }
    const index = this.conversations.findIndex((c) => c.id === conv.id);
    if (index >= 0) this.conversations[index] = conv;
    else this.conversations.push(conv);
    if (this.current?.id === conv.id) localStorage.setItem(CURRENT_KEY, conv.id);
    this.#renderConversationList();
  }

  // ---------- interface ----------

  #bind() {
    const els = this.els;

    els.btnSend.addEventListener('click', () => {
      if (this.busy) this.engine.stop();
      else this.send();
    });

    els.input.addEventListener('input', () => {
      this.#autosize();
      if (!this.busy) this.emitState('listening');
    });
    els.input.addEventListener('focus', () => {
      if (!this.busy) this.emitState('listening');
    });
    els.input.addEventListener('blur', () => {
      if (!this.busy) this.emitState('idle');
    });
    els.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (this.busy) return;
        this.send();
      }
    });

    els.btnMenu.addEventListener('click', () => this.#openDrawer());
    els.btnCloseDrawer.addEventListener('click', () => this.#closeDrawer());
    els.scrim.addEventListener('click', () => this.#closeDrawer());
    els.btnNew.addEventListener('click', () => this.newConversation());

    els.btnPhoto.addEventListener('click', () => this.#openSheet());
    els.btnGallery.addEventListener('click', () => {
      this.#closeSheet();
      els.fileGallery.click();
    });
    els.btnCamera.addEventListener('click', () => {
      this.#closeSheet();
      els.fileCamera.click();
    });
    els.btnCancelSheet.addEventListener('click', () => this.#closeSheet());
    els.sheet.addEventListener('click', (event) => {
      if (event.target === els.sheet) this.#closeSheet();
    });

    els.fileGallery.addEventListener('change', () => this.#onFilePicked(els.fileGallery));
    els.fileCamera.addEventListener('change', () => this.#onFilePicked(els.fileCamera));
    els.btnRemoveAttachment.addEventListener('click', () => {
      this.pendingPhoto = null;
      this.#updateAttachment();
    });

    els.empty.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.action === 'photo') {
        this.#openSheet();
        return;
      }
      if (chip.dataset.fill) {
        els.input.value = chip.dataset.fill;
        this.#autosize();
        els.input.focus();
      }
    });
  }

  async #onFilePicked(input) {
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    try {
      const photo = await preparePhoto(file);
      this.pendingPhoto = photo;
      this.#updateAttachment();
      this.emitEmotion('surprised', 900);
    } catch (err) {
      console.error('[chat] photo illisible', err);
      this.showToast('Impossible de lire cette image.');
    }
  }

  #updateAttachment() {
    const { attachment, attachmentImg } = this.els;
    if (this.pendingPhoto) {
      attachmentImg.src = this.pendingPhoto.thumbDataUrl;
      attachment.hidden = false;
    } else {
      attachment.hidden = true;
      attachmentImg.removeAttribute('src');
    }
  }

  #updateSendButton() {
    const { btnSend, iSend, iStop } = this.els;
    btnSend.disabled = this.busy ? false : !this.engineReady;
    btnSend.classList.toggle('busy', this.busy);
    iSend.hidden = this.busy;
    iStop.hidden = !this.busy;
    btnSend.setAttribute('aria-label', this.busy ? 'Arrêter la réponse' : 'Envoyer');
  }

  #setBusy(busy) {
    this.busy = busy;
    this.bus?.emit('engine', { busy });
    this.#updateSendButton();
  }

  #autosize() {
    const el = this.els.input;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
  }

  #scrollToBottom() {
    const { chat } = this.els;
    requestAnimationFrame(() => {
      chat.scrollTop = chat.scrollHeight;
    });
  }

  #openDrawer() {
    this.els.drawer.classList.add('open');
    this.els.scrim.hidden = false;
  }

  #closeDrawer() {
    this.els.drawer.classList.remove('open');
    this.els.scrim.hidden = true;
  }

  #openSheet() {
    this.els.sheet.hidden = false;
  }

  #closeSheet() {
    this.els.sheet.hidden = true;
  }
}
