# -*- coding: utf-8 -*-
"""向量通道最小验证：抽样 400 条快速编码，验证 npz 读写与检索融合链路。
完整索引（2.4 万条）因 CPU 编码耗时过长，留待有 GPU/更优环境时构建。
"""
import os
import sys
import time

sys.path.insert(0, ".")

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

MODEL = os.environ.get("SHZU_EMBED_MODEL", "BAAI/bge-small-zh-v1.5")

from backend.app.config import ARTIFACTS_DIR  # noqa: E402
from backend.app.knowledge.loader import get_kb  # noqa: E402


def main():
    import numpy as np
    from sentence_transformers import SentenceTransformer

    kb = get_kb()
    clause_ids = list(kb.clauses.keys())
    # 抽样：每板块与各学院都进样本（分层抽样保证代表性）
    by_cat = {}
    for cid in clause_ids:
        doc = kb.document_of(cid) or {}
        key = doc.get("category") or "?"
        by_cat.setdefault(key, []).append(cid)
    sample_ids = []
    for key, ids in by_cat.items():
        step = max(1, len(ids) // 40)
        sample_ids.extend(ids[::step][:40])
    texts = [" ".join([kb.document_of(cid).get("title") or "",
                       kb.clauses[cid].get("topic") or "",
                       kb.clauses[cid].get("exact_text") or ""])[:512]
             for cid in sample_ids]
    print(f"抽样 {len(sample_ids)} 条（{len(by_cat)} 板块），模型 {MODEL}")
    t0 = time.perf_counter()
    model = SentenceTransformer(MODEL)
    print(f"模型加载 {time.perf_counter() - t0:.1f}s")
    t0 = time.perf_counter()
    vectors = model.encode(texts, normalize_embeddings=True,
                           show_progress_bar=False, batch_size=64).astype("float32")
    print(f"编码完成 {time.perf_counter() - t0:.1f}s，{vectors.shape}")
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    np.savez(ARTIFACTS_DIR / "vector_index_sample.npz",
             ids=np.array(sample_ids, dtype=object),
             vectors=vectors,
             model=np.array(MODEL, dtype=object),
             kb_version=np.array(kb.kb_version, dtype=object),
             note=np.array("sample verification index (400 clauses)", dtype=object),
             dim=np.array(vectors.shape[1]))
    print(f"已写入 {ARTIFACTS_DIR / 'vector_index_sample.npz'}")

    # 验证查询
    q = "生科院 本科专业"
    qv = model.encode([q], normalize_embeddings=True)[0].astype("float32")
    sims = vectors @ qv
    top = sorted(zip(sims, sample_ids), reverse=True)[:5]
    for s, cid in top:
        print(f"  {s:.3f} {cid} {(kb.clauses[cid].get('exact_text') or '')[:40]}")


if __name__ == "__main__":
    main()
