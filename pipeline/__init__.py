"""Pipeline package for vector and embedding utilities.

Re-exports pipeline modules for cleaner imports.
"""

# Import VectorPipeline with graceful fallback
try:
    from .vector_pipeline import VectorPipeline
except Exception:
    VectorPipeline = None

# Import EmbeddingModel with graceful fallback
try:
    from .embeddings import EmbeddingModel
except Exception:
    EmbeddingModel = None

# Import PineconeManager with graceful fallback
try:
    from .pinecone_manager import PineconeManager
except Exception:
    PineconeManager = None

# Import Zoho client fetcher with graceful fallback
try:
    from .zoho_client_fetcher import ZohoCRMFetcher, get_fetcher
except Exception:
    ZohoCRMFetcher = None
    get_fetcher = None

# Import client fit scorer with graceful fallback
try:
    from .client_fit_scorer import ClientFitScorer
except Exception:
    ClientFitScorer = None

__all__ = [
    'VectorPipeline',
    'EmbeddingModel',
    'PineconeManager',
    'ZohoCRMFetcher',
    'get_fetcher',
    'ClientFitScorer',
]
