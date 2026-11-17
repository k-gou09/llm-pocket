// Configuration centrale de l'application.
// Deux profils de modele : Qwen3 0.6B par defaut (texte, francais, 4 Go de RAM)
// et un petit modele texte anglais. Le choix se fait par l'URL
// (?model=qwen3|small) puis reste enregistre dans le navigateur.
export const MODEL_PROFILES = {
  qwen3: {
    id: 'qwen3',
    label: 'Qwen3 0.6B',
    model: {
      name: 'Qwen3-0.6B-Q3_K_L.gguf',
      // Modele heberge sur Hugging Face : GitHub Pages ne peut pas servir un
      // fichier de 415 Mo. Le CDN autorise le CORS et l'en-tete CORP.
      url: 'https://huggingface.co/lmstudio-community/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q3_K_L.gguf',
      size: 435343520,
    },
    mmproj: null,
    nCtx: 2048,
    vision: false,
    systemPrompt:
      "Tu es Pocket, un assistant de poche amical, curieux et concis. " +
      "Tu réponds toujours en français, de façon claire et naturelle. " +
      "Tes réponses sont courtes (1 à 4 phrases) sauf si l'utilisateur demande un développement. " +
      "Tu ne montres jamais de raisonnement interne.",
  },
  small: {
    id: 'small',
    label: 'SmolLM2 360M (anglais)',
    model: {
      name: 'SmolLM2-360M-Instruct-Q4_K_M.gguf',
      url: 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf',
      size: 270590880,
    },
    mmproj: null,
    nCtx: 2048,
    vision: false,
    // Ce modele ne parle qu'anglais : la consigne suit sa langue.
    systemPrompt:
      'You are Pocket, a friendly, curious and concise pocket assistant. ' +
      'Always answer in English, clearly and naturally. ' +
      'Keep answers short (1 to 4 sentences) unless the user asks for more detail. ' +
      'Never show internal reasoning.',
  },
};

const PROFILE_KEY = 'llm-pocket.model';

// Profil actif : le parametre d'URL l'emporte et est memorise, sinon on relit
// le dernier choix. Un identifiant inconnu retombe sur le modele principal.
export function modelProfile() {
  try {
    const asked = new URLSearchParams(location.search).get('model');
    if (asked && MODEL_PROFILES[asked]) {
      localStorage.setItem(PROFILE_KEY, asked);
      return MODEL_PROFILES[asked];
    }
    return MODEL_PROFILES[localStorage.getItem(PROFILE_KEY)] || MODEL_PROFILES.qwen3;
  } catch {
    return MODEL_PROFILES.qwen3;
  }
}

export function modelSizeBytes(profile = modelProfile()) {
  return profile.model.size + (profile.mmproj ? profile.mmproj.size : 0);
}

export const CONFIG = {
  maxTokens: 1024,
  temperature: 0.7,
  historyCharBudget: 7000,
};
