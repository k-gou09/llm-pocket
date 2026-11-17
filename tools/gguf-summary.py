"""Affiche les metadonnees utiles d'un GGUF et ecrit le chat template dans tools/chat-template.txt."""
import json
import sys

from gguf import GGUFReader

path = sys.argv[1] if len(sys.argv) > 1 else "model/Qwen3.5-0.8B-Q4_K_M.gguf"
r = GGUFReader(path)

keys = [
    "general.architecture",
    "general.name",
    "qwen35.block_count",
    "qwen35.context_length",
    "qwen35.embedding_length",
    "qwen35.attention.head_count",
    "qwen35.attention.head_count_kv",
    "qwen35.full_attention_interval",
    "qwen35.ssm.inner_size",
    "tokenizer.ggml.model",
    "tokenizer.ggml.eos_token_id",
    "tokenizer.ggml.add_bos_token",
]

out = {}
for k in keys:
    f = r.fields.get(k)
    if f is None:
        continue
    try:
        v = f.contents()
        if hasattr(v, "tolist"):
            v = v.tolist()
        out[k] = v
    except Exception as e:  # noqa: BLE001
        out[k] = f"<erreur: {e}>"

print(json.dumps(out, indent=1))

tpl = r.fields.get("tokenizer.chat_template")
if tpl is not None:
    text = tpl.contents()
    if not isinstance(text, str):
        text = str(text)
    with open("tools/chat-template.txt", "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"\nChat template ({len(text)} caracteres) ecrit dans tools/chat-template.txt")
