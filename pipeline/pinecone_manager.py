"""Pinecone manager module for vector retrieval operations.

Supports two modes:
- Remote Pinecone index when credentials and dependency are available.
- Local in-memory vector index fallback for resilient production behavior.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional


class PineconeManager:
    """Manager for semantic retrieval over vectors."""

    def __init__(
        self,
        api_key: str,
        cloud: str = "aws",
        region: str = "us-east-1",
        index_name: str = "resume-matcher",
    ) -> None:
        self.api_key = api_key or ""
        self.cloud = cloud
        self.region = region
        self.index_name = index_name

        self._local_index: List[Dict[str, Any]] = []
        self._remote_index: Optional[Any] = None
        self._remote_available = False

        if self.api_key:
            self._try_init_remote()
        else:
            logging.info("PineconeManager using local retrieval fallback (no API key)")

    @property
    def remote_available(self) -> bool:
        return self._remote_available

    def _try_init_remote(self) -> None:
        try:
            from pinecone import Pinecone, ServerlessSpec  # type: ignore

            pc = Pinecone(api_key=self.api_key)
            existing_indexes = {idx.get("name") for idx in pc.list_indexes()}

            if self.index_name not in existing_indexes:
                pc.create_index(
                    name=self.index_name,
                    dimension=384,
                    metric="cosine",
                    spec=ServerlessSpec(cloud=self.cloud, region=self.region),
                )

            self._remote_index = pc.Index(self.index_name)
            self._remote_available = True
            logging.info("PineconeManager connected to remote index '%s'", self.index_name)
        except Exception as exc:
            self._remote_index = None
            self._remote_available = False
            logging.warning("Pinecone unavailable (%s); using local retrieval fallback", exc)

    @staticmethod
    def _cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
        if not vec1 or not vec2:
            return 0.0

        dim = min(len(vec1), len(vec2))
        dot = sum(vec1[i] * vec2[i] for i in range(dim))
        n1 = math.sqrt(sum(v * v for v in vec1[:dim]))
        n2 = math.sqrt(sum(v * v for v in vec2[:dim]))

        if n1 == 0.0 or n2 == 0.0:
            return 0.0
        return dot / (n1 * n2)

    def build_index(self, vectors: List[Dict[str, Any]]) -> None:
        """Build local index and optionally mirror vectors to remote Pinecone."""
        self._local_index = [v for v in vectors if isinstance(v, dict) and v.get("id") and v.get("values")]

        if not self._remote_available or self._remote_index is None:
            return

        try:
            self._remote_index.upsert(vectors=self._local_index)
        except Exception as exc:
            logging.warning("Pinecone upsert failed (%s); continuing with local retrieval", exc)

    def query(self, query_vector: List[float], top_k: int = 100) -> List[Dict[str, Any]]:
        """Query semantic neighbors by vector similarity."""
        k = max(1, int(top_k))

        if self._remote_available and self._remote_index is not None:
            try:
                response = self._remote_index.query(
                    vector=query_vector,
                    top_k=k,
                    include_metadata=True,
                )
                matches = []
                for item in getattr(response, "matches", []) or []:
                    matches.append(
                        {
                            "id": getattr(item, "id", None),
                            "score": float(getattr(item, "score", 0.0) or 0.0),
                            "metadata": getattr(item, "metadata", {}) or {},
                        }
                    )
                return matches
            except Exception as exc:
                logging.warning("Pinecone query failed (%s); switching to local retrieval", exc)

        scored = []
        for item in self._local_index:
            vec = item.get("values", [])
            score = self._cosine_similarity(query_vector, vec)
            scored.append(
                {
                    "id": item.get("id"),
                    "score": score,
                    "metadata": item.get("metadata", {}),
                }
            )

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:k]
