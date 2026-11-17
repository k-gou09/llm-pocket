# LLM Pocket

Assistant de poche **100 % local**, installable comme application (PWA), pensé pour Android.

- **Qwen3 0,6B** (GGUF `Q3_K_L`, 415 Mo), via **wllama 3** (llama.cpp compilé en WebAssembly, multi-thread).
- Petit profil de secours **SmolLM2 360M** (texte, anglais) pour les appareils à 2 Go de mémoire.
- Conversations sauvegardées en local, interface en français, mode Avatar animé.
- Fonctionne **hors ligne** après la préparation initiale. Aucun serveur, aucune donnée envoyée.
- Mode « réflexion » du modèle désactivé.

## Démarrage (développement)

```bash
npm start
```

ou

```bash
node server.mjs
```

Puis ouvrir <http://localhost:8137>.

Le serveur de dev ajoute les en-têtes `COOP`/`COEP` nécessaires à `SharedArrayBuffer`
(multi-thread de wllama). Les modèles ne sont plus servis localement : ils sont
téléchargés depuis Hugging Face au premier lancement.

## Modèles

| Profil | URL | Taille |
| --- | --- | --- |
| `qwen3` (défaut) | `lmstudio-community/Qwen3-0.6B-GGUF`, `Qwen3-0.6B-Q3_K_L.gguf` | 435 343 520 o |
| `small` | `bartowski/SmolLM2-360M-Instruct-GGUF`, `SmolLM2-360M-Instruct-Q4_K_M.gguf` | 270 590 880 o |

Le choix se fait par l'URL (`?model=small`) puis reste enregistré. `qwen3` répond en
français ; `small` répond en anglais et désactive les photos.

## Installer sur Android

1. Ouvrir <https://k-gou09.github.io/llm-pocket/> dans **Chrome Android**.
2. Attendre le premier chargement : le service worker s'installe et recharge la page
   une fois pour activer `crossOriginIsolated` (GitHub Pages ne peut pas envoyer
   `COOP`/`COEP`, le service worker les réinjecte).
3. Menu ⋮ → **Installer l'application**, ou la ligne « Installer l'application »
   dans le tiroir des conversations.
4. Premier lancement : appuyer sur « Télécharger le modèle » (415 Mo).
5. Ensuite, l'application démarre et répond **même en mode avion**.

Chaque appareil télécharge le modèle une seule fois dans son propre stockage (OPFS).
Il n'y a pas encore d'import depuis un fichier local.

### En-têtes HTTP requis

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Le serveur de dev les envoie. Sur GitHub Pages, le service worker les réinjecte sur
les réponses qu'il sert, d'où le rechargement unique au premier lancement.

## Déploiement GitHub Pages

Le workflow `.github/workflows/pages.yml` publie `index.html`, `styles.css`,
`manifest.webmanifest`, `sw.js`, `icons/`, `src/` et `vendor/` dans `dist/`.
Le dossier `model/` et `node_modules/` sont ignorés.

Les chemins de l'application sont relatifs, elle fonctionne donc aussi bien à la
racine qu'en sous-dossier (`/llm-pocket/`).

## Architecture

```
index.html               coquille de l'application (UI)
styles.css               thème sombre, bulles, robot animé
manifest.webmanifest     métadonnées PWA + icônes
sw.js                    cache hors ligne + en-têtes COOP/COEP
server.mjs               serveur de dev (COOP/COEP, MIME)
src/
  main.js                démarrage : SW, isolation, moteur, installation
  config.js              profils de modèles, contexte, prompts
  core/                  bus d'événements, réglages
  chat/chat.js           conversations, envoi, streaming, photos
  engine/wllama-engine.js  chargement du modèle, génération, stop
  avatar/                avatar SVG, écran, partition labiale
  voice/                 synthèse vocale, dictée
  robot/robot.js         robot SVG (états + émotions)
  photos/photos.js       redimensionnement JPEG
  storage/idb.js         conversations (IndexedDB)
  storage/opfs.js        GGUF (Origin Private File System)
vendor/wllama/           wllama 3.13.0 embarqué (JS + WASM + licence)
icons/                   icônes PWA (192, 512, maskable)
```

## Données et vie privée

- Conversations : IndexedDB `llm-pocket`, magasin `conversations`.
- Modèles : OPFS, dossier `models/` (415 Mo).
- Aucune requête réseau après la préparation initiale, sauf la dictée si elle est active.

## Limites connues

- Modèle 0,6B : réponses courtes, erreurs factuelles possibles.
- Contexte de 2048 tokens ; l'historique envoyé est tronqué.
- WebGPU est tenté automatiquement, avec repli CPU si le chargement échoue.
- Le téléchargement du modèle n'est pas reprenable : en cas d'interruption, il recommence.
- `storage.persist()` peut être refusé par Chrome : le modèle reste alors évictable.
- Navigateurs recommandés : Chrome / Edge (SharedArrayBuffer, OPFS, WebAssembly threads).

## Mise à jour

Après modification d'un fichier précaché, incrémenter `CACHE` dans `sw.js`
(`llm-pocket-v11` → `llm-pocket-v12`), sinon l'ancienne version reste servie hors ligne.
