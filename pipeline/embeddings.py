"""Embeddings module for creating vector embeddings from text.

Provides a production-safe embedding wrapper with:
- Optional sentence-transformer backend when available
- Deterministic hashed-vector fallback with no external dependencies
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from typing import List


class EmbeddingModel:
    """Create embeddings from text for similarity scoring.

    Backends:
    - sentence-transformer: Uses sentence-transformers if installed.
    - hash: Deterministic in-process vectorizer (always available).
    """

    def __init__(
        self,
        backend: str = "auto",
        model_name: str = "all-MiniLM-L6-v2",
        dimensions: int = 384,
    ) -> None:
        self.dimensions = max(64, int(dimensions))
        self.backend = "hash"
        self._model = None

        prefer_transformer = backend in ("auto", "sentence-transformer")
        if prefer_transformer:
            try:
                from sentence_transformers import SentenceTransformer  # type: ignore

                self._model = SentenceTransformer(model_name)
                self.backend = "sentence-transformer"
                logging.info("EmbeddingModel backend=sentence-transformer model=%s", model_name)
                return
            except Exception as exc:
                if backend == "sentence-transformer":
                    logging.warning(
                        "sentence-transformer backend requested but unavailable (%s); falling back to hash embeddings",
                        exc,
                    )
                else:
                    logging.info("sentence-transformer not available; using hash embeddings")

        logging.info("EmbeddingModel backend=hash dimensions=%d", self.dimensions)

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        return re.findall(r"[a-z0-9+#.]+", (text or "").lower())

    def _hash_embed(self, text: str) -> List[float]:
        vec = [0.0] * self.dimensions
        tokens = self._tokenize(text)

        if not tokens:
            return vec

        for token in tokens:
            idx = int(hashlib.blake2b(token.encode("utf-8"), digest_size=8).hexdigest(), 16) % self.dimensions
            vec[idx] += 1.0

            # Char trigram features improve fuzzy matching for related terms.
            if len(token) >= 3:
                for i in range(len(token) - 2):
                    tri = token[i : i + 3]
                    tri_idx = int(hashlib.blake2b(tri.encode("utf-8"), digest_size=8).hexdigest(), 16) % self.dimensions
                    vec[tri_idx] += 0.35

        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    def embed(self, text: str) -> List[float]:
        """Embed one text into a dense vector."""
        if self.backend == "sentence-transformer" and self._model is not None:
            try:
                out = self._model.encode([text or ""], normalize_embeddings=True)
                return [float(v) for v in out[0]]
            except Exception as exc:
                logging.warning("sentence-transformer embedding failed (%s); switching to hash backend", exc)
                self.backend = "hash"
                self._model = None

        return self._hash_embed(text)

    @staticmethod
    def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
        """Cosine similarity for two vectors."""
        if not vec1 or not vec2:
            return 0.0

        dim = min(len(vec1), len(vec2))
        dot = sum(vec1[i] * vec2[i] for i in range(dim))
        n1 = math.sqrt(sum(v * v for v in vec1[:dim]))
        n2 = math.sqrt(sum(v * v for v in vec2[:dim]))
        if n1 == 0 or n2 == 0:
            return 0.0
        return dot / (n1 * n2)
