# -*- coding: utf-8 -*-
"""构建条款向量索引（BGE-M3，经 HF_ENDPOINT=https://hf-mirror.com）。

产出 data/artifacts/vector_index.npz：{ids, vectors, model, kb_version, dim}。
检索侧 get_vector_channel() 加载失败自动退回 BM25（关键词检索不受影响）。

用法：
  HF_ENDPOINT=https://hf-mirror.com .venv\\Scripts\\python.exe scripts\\build_vector_index.py
  可用 SHZU_EMBED_MODEL 换用更小的模型（如 BAAI/bge-small-zh-v1.5）。
"""
import os
import sys
import time

sys.path.insert(0, ".")

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
MODEL = os.environ.get("SHZU_EMBED_MODEL", "BAAI/bge-m3")

from backend.app.config import ARTIFACTS_DIR  # noqa: E402
from backend.app.knowledge.loader import get_kb  # noqa: E402

MAX_TEXT = 512  # bge-m3 每条编码上限（长条款截断，excerpt 检索按前段）


def main():
    import numpy as np
    from sentence_transformers import SentenceTransformer

    kb = get_kb()
    clause_ids = list(kb.clauses.keys())
    texts = []
    for cid in clause_ids:
        c = kb.clauses[cid]
        texts.append(" ".join([c.get("topic") or "", c.get("exact_text") or ""])[:MAX_TEXT])
    print(f"条款 {len(texts)} 条，模型 {MODEL}，编码中…")
    t0 = time.perf_counter()
    model = SentenceTransformer(MODEL)
    print(f"模型加载 {(time.perf_counter() - t0):.1f}s")
    t0 = time.perf_counter()
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False,
                           batch_size=32).astype("float32")
    print(f"编码完成 {(time.perf_counter() - t0):.1f}s，维度 {vectors.shape}")
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    np.savez(ARTIFACTS_DIR / "vector_index.npz",
             ids=np.array(clause_ids),          # unicode 数组：np.load 无需 pickle
             vectors=vectors,
             model=np.array(MODEL),
             kb_version=np.array(kb.kb_version),
             dim=np.array(vectors.shape[1]))
    print(f"已写入 {ARTIFACTS_DIR / 'vector_index.npz'}")


if __name__ == "__main__":
    main()
