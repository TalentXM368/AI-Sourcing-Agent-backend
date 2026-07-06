"""Vector pipeline module for matching resumes to job descriptions.

Provides vector-based matching between resumes and job descriptions.
Uses embeddings to find the best resume-JD matches.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import re
import urllib.error
import urllib.request

try:
    from .embeddings import EmbeddingModel
except Exception:
    from embeddings import EmbeddingModel  # type: ignore

try:
    from .pinecone_manager import PineconeManager
except Exception:
    from pinecone_manager import PineconeManager  # type: ignore

try:
    from .zoho_client_fetcher import ZohoCRMFetcher, get_fetcher as get_zoho_fetcher
    from .client_fit_scorer import ClientFitScorer
    from ..parsers.client_context_parser import ClientContextParser
except Exception:
    try:
        from zoho_client_fetcher import ZohoCRMFetcher, get_fetcher as get_zoho_fetcher
        from client_fit_scorer import ClientFitScorer
        from parsers.client_context_parser import ClientContextParser
    except Exception:
        ZohoCRMFetcher = None
        get_zoho_fetcher = None
        ClientContextParser = None
        ClientFitScorer = None


class VectorPipeline:
    """Vector-based matching pipeline for resumes and job descriptions.
    
    Matches resumes to job descriptions using:
    - Semantic skill matching with skill relationships
    - Experience level matching
    - Text similarity scoring
    - Education level matching
    - Role relevance scoring
    """
    
    # Define skill relationships for semantic matching
    SKILL_RELATIONSHIPS = {
        "machine learning": {"ml", "ai", "artificial intelligence", "deep learning", "neural networks"},
        "deep learning": {"machine learning", "tensorflow", "pytorch", "neural networks"},
        "python": {"django", "flask", "fastapi", "pandas", "numpy", "scipy", "scikit-learn"},
        "java": {"spring", "spring boot"},
        "javascript": {"typescript", "react", "angular", "vue", "nodejs", "node.js"},
        "tensorflow": {"deep learning", "machine learning", "keras"},
        "pytorch": {"deep learning", "machine learning", "torch"},
        "nlp": {"natural language processing", "machine learning"},
        "data science": {"machine learning", "data analysis", "statistics"},
    }
    
    def __init__(
        self,
        pinecone_api_key: str,
        cloud: str = "aws",
        region: str = "us-east-1",
        use_reranking: bool = True,
        scoring_mode: str = "hybrid",
        client_context: Optional[Dict[str, Any]] = None,
        zoho_client_id: Optional[str] = None,
        zoho_api_token: Optional[str] = None,
        use_client_fit_scoring: bool = True,
    ) -> None:
        """Initialize the vector pipeline.
        
        Args:
            pinecone_api_key: Pinecone API key
            cloud: Pinecone cloud provider
            region: Pinecone region
            use_reranking: Whether to use reranking
            scoring_mode: Scoring mode (vector, hybrid, weighted). Default: hybrid
            client_context: Pre-parsed client context dict. If provided, will be used directly.
            zoho_client_id: Zoho CRM client ID to fetch context from. Ignored if client_context provided.
            zoho_api_token: Zoho API token. Defaults to ZOHO_API_TOKEN env var.
            use_client_fit_scoring: Whether to include client fit score in final scoring
        """
        self.pinecone_api_key = pinecone_api_key
        self.cloud = cloud
        self.region = region
        self.use_reranking = use_reranking
        self.scoring_mode = scoring_mode.lower()
        self.use_client_fit_scoring = use_client_fit_scoring
        self.embedding_model = EmbeddingModel(backend="auto")
        self.skill_match_threshold = 0.82
        self.semantic_retrieval_k = 100
        self.llm_rerank_top_n = 50
        self.llm_model = os.getenv("LLM_MATCHER_MODEL", "gpt-4o-mini")
        self.llm_api_key = os.getenv("LLM_API_KEY", "")
        self._embedding_cache: Dict[str, List[float]] = {}
        self.pinecone_manager = PineconeManager(
            api_key=self.pinecone_api_key,
            cloud=self.cloud,
            region=self.region,
            index_name=os.getenv("PINECONE_INDEX_NAME", "resume-matcher"),
        )
        
        # Initialize client fit scoring
        self.client_context = client_context
        self.client_fit_scorer = ClientFitScorer() if ClientFitScorer else None
        
        # Fetch client context if not provided
        if not self.client_context and zoho_client_id and ClientContextParser:
            self.client_context = self._fetch_client_context(zoho_client_id, zoho_api_token)
        
        if self.scoring_mode not in ("vector", "hybrid", "weighted"):
            logging.warning("Invalid scoring_mode '%s', defaulting to 'hybrid'", scoring_mode)
            self.scoring_mode = "hybrid"
        
        logging.info("VectorPipeline initialized with cloud=%s, region=%s, reranking=%s, scoring_mode=%s, client_fit_scoring=%s", 
                    cloud, region, use_reranking, self.scoring_mode, use_client_fit_scoring)
    
    def run_complete_pipeline(
        self,
        resume_file: str,
        jd_file: str,
        output_file: str,
        top_k: int = 10,
    ) -> bool:
        """Run the complete matching pipeline.
        
        Args:
            resume_file: Path to parsed resumes JSON
            jd_file: Path to parsed JDs JSON
            output_file: Path to output matching results (JD-Resume matches)
            top_k: Number of top matches per JD
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Load parsed data
            resumes = self._load_json(resume_file)
            jds = self._load_json(jd_file)
            
            if not resumes or not jds:
                logging.error("Failed to load resume or JD data")
                return False
            
            # Extract resume and JD details
            resume_list = self._extract_resumes(resumes)
            jd_list = self._extract_jds(jds)
            
            if not resume_list or not jd_list:
                logging.error("No valid resumes or JDs found")
                return False
            
            logging.info("Matching %d resumes against %d job descriptions using %s mode", 
                        len(resume_list), len(jd_list), self.scoring_mode)
            
            # Perform matching
            matches = self._match_resumes_to_jds(resume_list, jd_list, top_k, self.client_context)
            
            # Write JD-Resume matching results (without client fit data)
            results = {
                "run_metadata": {
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                    "total_jds": len(jd_list),
                    "total_resumes": len(resume_list),
                    "top_k": top_k,
                    "semantic_retrieval_k": self.semantic_retrieval_k,
                    "llm_rerank_top_n": self.llm_rerank_top_n,
                    "scoring_mode": self.scoring_mode,
                    "use_reranking": self.use_reranking,
                    "llm_reranking_enabled": bool(self.use_reranking and self.llm_api_key),
                    "retrieval_backend": "pinecone" if self.pinecone_manager.remote_available else "local-vector",
                    "client_context_present": False,
                },
                "matches": self._sanitize_matches_for_jd_output(matches),
            }
            
            Path(output_file).parent.mkdir(parents=True, exist_ok=True)
            Path(output_file).write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
            logging.info("Matching results written to %s", output_file)
            
            # If client context is present, also write separate client-JD-Resume matching results
            if self.client_context:
                client_output_file = str(Path(output_file).parent / "client_jd_match.json")
                client_results = {
                    "run_metadata": {
                        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                        "total_jds": len(jd_list),
                        "total_resumes": len(resume_list),
                        "top_k": top_k,
                        "client_id": self.client_context.get("client_id", "unknown"),
                        "client_name": self.client_context.get("client_name", "unknown"),
                        "scoring_mode": self.scoring_mode,
                        "use_reranking": self.use_reranking,
                    },
                    "matches": self._extract_client_jd_matches(matches),
                }
                Path(client_output_file).write_text(json.dumps(client_results, indent=2, ensure_ascii=False), encoding="utf-8")
                logging.info("Client-JD matching results written to %s", client_output_file)
            
            return True
        
        except Exception as e:
            logging.error("Pipeline execution failed: %s", e)
            return False
    
    @staticmethod
    def _load_json(file_path: str) -> Optional[Dict[str, Any]]:
        """Load JSON file."""
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logging.error("Failed to load %s: %s", file_path, e)
            return None
    
    def _fetch_client_context(
        self,
        zoho_client_id: str,
        zoho_api_token: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Fetch and parse client context from Zoho CRM.
        
        Args:
            zoho_client_id: Zoho CRM client/account ID
            zoho_api_token: Zoho API token (optional, uses env var if not provided)
            
        Returns:
            Parsed client context dict or None
        """
        if not ClientContextParser or not ZohoCRMFetcher:
            logging.warning("Client context modules not available")
            return None
        
        try:
            fetcher = ZohoCRMFetcher(zoho_api_token=zoho_api_token)
            if not fetcher.is_configured():
                logging.warning("Zoho credentials not configured, skipping client context fetch")
                return None
            
            raw_data = fetcher.fetch_client_profile(zoho_client_id)
            if not raw_data:
                logging.warning("Failed to fetch client profile from Zoho")
                return None
            
            parser = ClientContextParser()
            context = parser.parse_zoho_profile(raw_data)
            logging.info("Successfully fetched and parsed client context from Zoho for client %s", zoho_client_id)
            return context
        
        except Exception as e:
            logging.error(f"Failed to fetch client context from Zoho: {e}")
            return None
    
    @staticmethod
    def _extract_resumes(data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract resume records from parsed data."""
        if not isinstance(data, dict):
            return []
        
        results = data.get("results", [])
        resumes = []
        
        for result in results:
            if not isinstance(result, dict):
                continue
            
            if result.get("status") != "success":
                continue
            
            resume_data = result.get("data", {})
            projects = resume_data.get("projects") or resume_data.get("project_experience") or []
            if isinstance(projects, dict):
                projects = [str(v) for v in projects.values() if v]
            elif not isinstance(projects, list):
                projects = [str(projects)] if projects else []

            role = resume_data.get("current_role")
            experience_years = resume_data.get("total_experience_years")
            inferred_background = VectorPipeline._infer_resume_background(role, projects, experience_years)
            inferred_industry = VectorPipeline._infer_resume_industry(
                role,
                resume_data.get("skills", []),
                projects,
                resume_data.get("education"),
            )
            inferred_experience_level = VectorPipeline._infer_resume_experience_level(experience_years, role, projects)

            resumes.append({
                "file": result.get("source_file", "unknown"),
                "name": resume_data.get("full_name"),
                "email": resume_data.get("email"),
                "skills": resume_data.get("skills", []),
                "experience_years": experience_years,
                "education": resume_data.get("education"),
                "role": role,
                "projects": projects,
                "background": inferred_background,
                "industry": inferred_industry,
                "experience_level": inferred_experience_level,
                "signal_summary": {
                    "has_skills": bool(resume_data.get("skills")),
                    "has_experience": experience_years is not None,
                    "has_role": bool(role),
                    "project_count": len(projects),
                },
            })
        
        return resumes
    
    @staticmethod
    def _extract_jds(data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract JD records from parsed data."""
        if not isinstance(data, dict):
            return []
        
        results = data.get("results", [])
        jds = []
        
        for result in results:
            if not isinstance(result, dict):
                continue
            
            if result.get("status") != "success":
                continue
            
            jds.append({
                "file": result.get("file_name", "unknown"),
                "title": result.get("title"),
                "company": result.get("company"),
                "skills": result.get("required_skills", []),
                "experience_years": result.get("required_experience_years"),
                "raw_text": result.get("raw_text", ""),
            })
        
        return jds

    @staticmethod
    def _infer_resume_background(role: Optional[str], projects: List[Any], experience_years: Optional[Any]) -> str:
        text = " ".join([str(role or ""), " ".join(str(p) for p in projects if p)])
        lowered = text.lower()
        if any(token in lowered for token in ("startup", "seed", "founder", "hackathon", "prototype", "product")):
            return "startup"
        if any(token in lowered for token in ("enterprise", "corporate", "global", "bank", "regulated", "process")):
            return "enterprise"
        if any(token in lowered for token in ("growth", "scale", "series", "saaS", "platform".lower())):
            return "scale_up"
        if experience_years is not None:
            try:
                years = float(experience_years)
                if years < 2:
                    return "startup"
                if years < 5:
                    return "scale_up"
                return "enterprise"
            except (TypeError, ValueError):
                pass
        return "unknown"

    @staticmethod
    def _infer_resume_industry(role: Optional[str], skills: List[Any], projects: List[Any], education: Optional[str]) -> str:
        text = " ".join([str(role or ""), " ".join(str(s) for s in skills if s), " ".join(str(p) for p in projects if p), str(education or "")])
        lowered = text.lower()
        industry_map = {
            "fintech": ["fintech", "payment", "payments", "bank", "trading", "loan", "insurance"],
            "ai_ml": ["ai", "machine learning", "ml", "deep learning", "nlp", "llm", "pytorch", "tensorflow"],
            "telecom": ["telecom", "telecommunications", "network", "5g"],
            "healthcare": ["healthcare", "medical", "hospital", "clinical", "pharma"],
            "ecommerce": ["ecommerce", "retail", "marketplace", "shopping"],
            "saas": ["saas", "subscription", "cloud", "platform"],
        }
        for canonical, keywords in industry_map.items():
            if any(keyword in lowered for keyword in keywords):
                return canonical
        return "unknown"

    @staticmethod
    def _infer_resume_experience_level(experience_years: Optional[Any], role: Optional[str], projects: List[Any]) -> str:
        if experience_years is not None:
            try:
                years = float(experience_years)
                if years < 2:
                    return "junior"
                if years < 5:
                    return "mid"
                if years < 8:
                    return "mid-to-senior"
                return "senior"
            except (TypeError, ValueError):
                pass

        text = " ".join([str(role or ""), " ".join(str(p) for p in projects if p)])
        lowered = text.lower()
        if any(token in lowered for token in ("intern", "fresher", "graduate")):
            return "junior"
        if any(token in lowered for token in ("lead", "principal", "architect", "staff")):
            return "senior"
        if projects:
            return "mid"
        return "unknown"
    
    def _match_resumes_to_jds(
        self,
        resumes: List[Dict[str, Any]],
        jds: List[Dict[str, Any]],
        top_k: int,
        client_context: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Match resumes to job descriptions using semantic analysis.
        
        Scoring modes:
        - vector: Pure skill overlap and text similarity
        - hybrid: Weighted scoring + hard-skill penalty for required skills
        - weighted: Weighted scoring with experience and education factors
        
        Args:
            client_context: Optional structured client context for client fit scoring
        """
        matches = []

        # Build semantic retrieval index once (Layer 1 base).
        indexed_resumes = self._build_resume_vector_index(resumes)
        
        for jd_idx, jd in enumerate(jds):
            jd_skills = set(self._normalize_skill(s) for s in jd.get("skills", []) if s)
            jd_exp = jd.get("experience_years")
            jd_text = self._build_jd_text(jd)
            retrieval_k = min(max(50, self.semantic_retrieval_k), max(1, len(resumes)))

            # Layer 1: semantic retrieval candidates.
            retrieved_candidates = self._semantic_retrieve_candidates(jd, indexed_resumes, retrieval_k)
            retrieval_lookup = {c["resume_idx"]: c for c in retrieved_candidates}

            scores = []

            # Layer 2: feature-based scoring for retrieved pool only.
            for candidate in retrieved_candidates:
                resume_idx = candidate["resume_idx"]
                resume = resumes[resume_idx]
                resume_skills = set(self._normalize_skill(s) for s in resume.get("skills", []) if s)
                resume_exp = resume.get("experience_years")
                resume_text = self._build_resume_text(resume)
                resume_projects = resume.get("projects", []) if isinstance(resume.get("projects", []), list) else []

                # Skill-level semantic coverage using vectors + relationships.
                skill_analysis = self._score_skill_coverage(jd_skills, resume_skills)
                exact_matches = set(skill_analysis["exact_matches"])
                semantic_matches = set(skill_analysis["semantic_matches"])
                missing_skills = set(skill_analysis["missing_skills"])

                exact_skill_score = float(skill_analysis["exact_skill_score"])
                semantic_skill_score = float(skill_analysis["semantic_skill_score"])
                combined_skill_score = float(skill_analysis["combined_skill_score"])
                skill_vector_similarity = float(skill_analysis["avg_best_skill_similarity"])

                # Compute dedicated embeddings for skills lists (JD vs resume) to avoid
                # using full-text embeddings that can mask missing skills.
                jd_skill_vec = self._embed_list(list(jd_skills), prefix="skills")
                resume_skill_vec = self._embed_list(list(resume_skills), prefix="skills")
                skill_list_vector_similarity = self._cosine_vectors(jd_skill_vec, resume_skill_vec)

                # If resume contains no structured skills while JD expects skills, strongly reduce skill score
                if jd_skills and not resume_skills:
                    combined_skill_score = combined_skill_score * 0.15

                # Experience match score.
                exp_match = self._experience_match_score(jd_exp, resume_exp)

                # Text similarity combines lexical and vector similarity.
                lexical_text_similarity = self._calculate_text_similarity(jd_text, resume_text)
                vector_text_similarity = self._vector_similarity(jd_text, resume_text)
                text_match = (0.4 * lexical_text_similarity) + (0.6 * vector_text_similarity)

                # Project and role fit from structured features.
                project_match = self._project_match_score(jd, resume_projects)
                role_match = self._role_match_score(jd.get("title"), resume.get("role"))

                # Retrieval similarity from Layer 1.
                retrieval_similarity = float(candidate.get("retrieval_similarity", 0.0))
                # Discount retrieval similarity when JD skills do not align with resume skills
                if jd_skills:
                    retrieval_similarity = retrieval_similarity * (0.3 + 0.7 * skill_list_vector_similarity)

                # Feature score core (Layer 2 output).
                # Increased weight to skills; reduce over-reliance on embeddings/text
                # Guard against exp_match being None (missing resume experience):
                # use a conservative default for scoring (small penalty) but keep None
                # to indicate Unknown in the UI.
                exp_for_score = exp_match if exp_match is not None else 0.05
                feature_score = (
                    (0.60 * combined_skill_score)
                    + (0.15 * exp_for_score)
                    + (0.10 * role_match)
                    + (0.075 * project_match)
                    + (0.075 * text_match)
                )

                # Calculate final score based on mode.
                hard_skill_penalty = 0.0
                coverage_penalty = 0.0
                rejected_for_missing_required_skills = False

                if self.scoring_mode == "vector":
                    # Use dedicated skill-list vector similarity here (less masking from full text)
                    score = (0.5 * retrieval_similarity) + (0.2 * skill_list_vector_similarity) + (0.3 * vector_text_similarity)

                elif self.scoring_mode == "weighted":
                    score = (
                        (0.65 * feature_score)
                        + (0.2 * retrieval_similarity)
                        + (0.15 * skill_list_vector_similarity)
                    )

                else:  # hybrid (default)
                    base_score = (0.85 * feature_score) + (0.15 * retrieval_similarity)

                    # Strong penalties for missing critical skills
                    hard_skill_penalty = 0.35 * (1.0 - exact_skill_score)
                    coverage_penalty = 0.25 * (1.0 - semantic_skill_score)

                    # Normalize penalties to avoid double punishment
                    total_penalty = hard_skill_penalty + coverage_penalty
                    max_penalty = 0.45
                    if total_penalty > max_penalty:
                        scale = max_penalty / total_penalty
                        hard_skill_penalty *= scale
                        coverage_penalty *= scale

                    # If JD had required skills and candidate has zero coverage, keep partial credit
                    # rather than collapsing to zero unless the rest of the resume is also weak.
                    if jd_skills and exact_skill_score == 0.0 and semantic_skill_score == 0.0:
                        if feature_score < 0.22 and text_match < 0.15 and project_match < 0.15:
                            rejected_for_missing_required_skills = True
                            score = max(0.15, base_score * 0.45)
                        else:
                            score = max(0.22, base_score * 0.72)
                    else:
                        # Penalize missing skills and incomplete resumes
                        score = base_score - hard_skill_penalty - coverage_penalty
                        score = max(0.20, min(1.0, score))
                
                # Log score calculation
                # Use numeric value for logging if exp_match is None
                exp_for_log = exp_match if exp_match is not None else 0.0
                logging.debug(
                    "Score for %s vs %s: exact_skills=%.2f, semantic_skills=%.2f, skill_vec=%.2f, exp=%.2f, text=%.2f, final=%.4f",
                    resume.get("name"), jd.get("title"),
                    exact_skill_score, semantic_skill_score, skill_vector_similarity, exp_for_log, text_match, score
                )

                # Build a concise breakdown for UI. Keep internal/verbose signals out of UI.
                raw_combined = (0.75 * exact_skill_score) + (0.25 * semantic_skill_score)
                
                # Compute client fit score if enabled and context provided
                client_fit_score = 50.0  # Default neutral
                client_fit_explanation = None
                if self.use_client_fit_scoring and client_context and self.client_fit_scorer:
                    client_fit_score, client_fit_explanation = self.client_fit_scorer.compute_client_fit_score(
                        resume, client_context, jd
                    )

                jd_score_raw = score
                jd_score_pct = self._to_percent(jd_score_raw)

                if self.use_client_fit_scoring and client_context:
                    score = (0.80 * score) + (0.20 * (client_fit_score / 100.0))
                    score = max(0.0, min(1.0, score))
                
                breakdown: Dict[str, Any] = {
                    "semantic_retrieval_similarity": self._to_percent(retrieval_similarity),
                    "combined_skill_score": self._to_percent(combined_skill_score),
                    "combined_skill_raw": self._to_percent(raw_combined),
                    "combined_skill_formula": "0.75*exact + 0.25*semantic (then mapped to bands)",
                    "jd_match_score": jd_score_pct,
                    "overall_match_score": self._to_percent(score),
                    "client_fit_score": client_fit_score,
                    "client_fit_signals": client_fit_explanation.get("signals_used", []) if isinstance(client_fit_explanation, dict) else [],
                }
                if jd_exp is not None:
                    # If experience match returned None, present as Unknown to the UI
                    if exp_match is None:
                        breakdown["experience_match"] = "Unknown"
                    else:
                        breakdown["experience_match"] = self._to_percent(exp_match)

                # store raw experience match for internal calculations (removed before UI)
                internal_experience_marker = exp_match

                scores.append({
                    "resume_idx": resume_idx,
                    "resume_file": resume.get("file"),
                    "resume_name": resume.get("name"),
                    "score": self._to_percent(score),
                    "score_raw": round(score, 4),
                    "jd_score": jd_score_pct,
                    "jd_score_raw": round(jd_score_raw, 4),
                    "score_breakdown": breakdown,
                    "matched_skills": {
                        "exact": sorted(list(exact_matches)),
                        "semantic": sorted(list(semantic_matches)),
                        "semantic_mappings": skill_analysis["semantic_mappings"],
                    },
                    "missing_skills": sorted(list(missing_skills)),
                    "resume_experience_years": resume_exp,
                    "retrieval_rank": int(candidate.get("retrieval_rank", 0)),
                    "rejected": rejected_for_missing_required_skills,
                    "client_fit_score": client_fit_score,
                    "client_fit_explanation": client_fit_explanation,
                    "_experience_match_raw": internal_experience_marker,
                })

            # Layer 3: optional LLM reranking on top-N candidates only.
            rerank_count = min(self.llm_rerank_top_n, max(top_k, 10), len(scores))
            llm_scores = {}
            if self.use_reranking and self.llm_api_key and rerank_count > 0:
                pre_sorted = sorted(scores, key=lambda x: x["score_raw"], reverse=True)
                llm_scores = self._llm_rerank(jd, pre_sorted[:rerank_count])
                for row in scores:
                    llm_row = llm_scores.get(row["resume_idx"])
                    if not llm_row:
                        continue
                    llm_score = float(llm_row.get("score", 0.0))
                    # Put LLM rerank under ai_fit_score for user-facing label
                    row["score_breakdown"]["ai_fit_score"] = self._to_percent(llm_score)
                    row["score_breakdown"]["pre_llm_score"] = self._to_percent(row["score_raw"])

                    # Increase LLM influence so it can adjust ranking strongly
                    pre = float(row.get("score_raw", 0.0))
                    blended = (0.4 * pre) + (0.6 * llm_score)

                    # If the pre-LLM score is very low, cap how much LLM can rescue it.
                    if pre < 0.15:
                        cap = 0.40
                        blended = min(blended, cap)
                        row["score_breakdown"]["ai_fit_score_capped"] = True

                    row["score_raw"] = round(max(0.0, min(1.0, blended)), 4)
                    row["score"] = self._to_percent(row["score_raw"])
                    if llm_row.get("reason"):
                        row["llm_rerank_reason"] = llm_row["reason"]

            # Add confidence and apply final adjustments before sorting
            for s in scores:
                # Penalize resumes missing structured skills when JD expects skills
                completeness_count = 0
                r = resumes[s["resume_idx"]]
                for f in ("skills", "experience_years", "projects", "role"):
                    v = r.get("skills") if f == "skills" else r.get(f)
                    if v:
                        completeness_count += 1
                completeness = completeness_count / 4.0
                combined_skill = (s["score_breakdown"].get("combined_skill_score", 0.0) / 100.0)
                exp_raw = s.get("_experience_match_raw")
                client_fit = (s.get("client_fit_score", 50.0) / 100.0)

                # Confidence calculation: when experience is Unknown, rely more on skill+completeness
                if exp_raw is None:
                    confidence = (0.70 * combined_skill) + (0.20 * completeness) + (0.10 * client_fit)
                else:
                    experience_pct = float(exp_raw)
                    confidence = (0.60 * combined_skill) + (0.15 * experience_pct) + (0.15 * client_fit) + (0.10 * completeness)

                # Apply client fit penalty if applicable
                if self.use_client_fit_scoring and client_context:
                    penalized_score, penalty_reason = self.client_fit_scorer.apply_client_penalty(
                        s["score_raw"], s["client_fit_score"]
                    )
                    if penalty_reason:
                        s["score_raw"] = penalized_score
                        s["score"] = self._to_percent(penalized_score)
                        if "client_fit_explanation" not in s or not s["client_fit_explanation"]:
                            s["client_fit_explanation"] = {"reason": penalty_reason}
                
                # Normalize to 0-100 and add human-friendly band
                conf_pct = round(max(0.0, min(1.0, confidence)) * 100.0, 2)
                s["confidence"] = conf_pct
                if conf_pct >= 70.0:
                    s["confidence_level"] = "High"
                elif conf_pct >= 40.0:
                    s["confidence_level"] = "Medium"
                else:
                    s["confidence_level"] = "Low"

                # If candidate was marked rejected earlier, keep the score low but not zeroed out.
                if s.get("rejected") and s["score_raw"] > 0.0:
                    s["score_raw"] = max(0.15, s["score_raw"] * 0.85)
                    s["score"] = self._to_percent(s["score_raw"])
                    s["overall_match_score"] = self._to_percent(s["score_raw"])

                # Map final percent score to user-facing status using clean bands
                score_pct = float(s.get("score", 0.0))
                if score_pct >= 70.0:
                    s["status"] = "Strong Fit"
                elif score_pct >= 50.0:
                    s["status"] = "Potential Fit"
                elif score_pct >= 30.0:
                    s["status"] = "Weak Fit"
                else:
                    s["status"] = "Not Fit"

                # Ensure experience_match is only present when JD specifies requirement
                if jd_exp is None:
                    if "experience_match" in s["score_breakdown"]:
                        s["score_breakdown"].pop("experience_match", None)

                # remove internal markers before presenting to UI
                if "_experience_match_raw" in s:
                    s.pop("_experience_match_raw", None)

            scores.sort(key=lambda x: x["score_raw"], reverse=True)
            top_matches = scores[:top_k]

            # Sanitize top matches for UI: remove internal/verbose fields
            sanitized_top = []
            for itm in top_matches:
                clean = dict(itm)  # shallow copy
                # remove top-level keys not for UI
                for k in ("score_raw", "retrieval_rank", "pre_llm_score", "ai_fit_score_capped"):
                    clean.pop(k, None)

                # remove verbose breakdown fields
                sb = clean.get("score_breakdown", {})
                for fk in (
                    "feature_score",
                    "exact_skill_match",
                    "semantic_skill_match",
                    "skill_vector_similarity",
                    "role_match",
                    "project_match",
                    "hard_skill_penalty",
                    "coverage_penalty",
                    "pre_llm_score",
                    "ai_fit_score_capped",
                ):
                    sb.pop(fk, None)

                clean["score_breakdown"] = sb
                sanitized_top.append(clean)

            jd_result = {
                "jd_file": jd.get("file"),
                "jd_title": jd.get("title"),
                "jd_company": jd.get("company"),
                "jd_required_skills": sorted(list(jd_skills)),
                "jd_required_experience": jd_exp,
                "total_candidates": len(resumes),
                "semantic_retrieval_candidates": len(retrieved_candidates),
                "scoring_mode": self.scoring_mode,
                "layers": {
                    "layer1_semantic_retrieval": {
                        "enabled": True,
                        "backend": "pinecone" if self.pinecone_manager.remote_available else "local-vector",
                        "retrieval_k": retrieval_k,
                    },
                    "layer2_feature_scoring": {
                        "enabled": True,
                        "features": ["skills", "experience", "projects", "role", "text"],
                    },
                    "layer3_llm_reranking": {
                        "enabled": bool(self.use_reranking and self.llm_api_key),
                        "model": self.llm_model if self.use_reranking and self.llm_api_key else None,
                        "rerank_top_n": rerank_count,
                    },
                },
                "top_matches": top_matches,
            }

            matches.append(jd_result)

        return matches

    def _sanitize_matches_for_jd_output(self, matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove client-fit data from matches for JD-only output."""
        sanitized = []
        for jd_match in matches:
            clean_match = dict(jd_match)
            if "top_matches" in clean_match:
                clean_matches = []
                for candidate in clean_match["top_matches"]:
                    clean_candidate = dict(candidate)
                    # Remove client-fit related fields from JD output
                    for field in ("client_fit_score", "client_fit_explanation"):
                        clean_candidate.pop(field, None)
                    clean_matches.append(clean_candidate)
                clean_match["top_matches"] = clean_matches
            sanitized.append(clean_match)
        return sanitized

    def _extract_client_jd_matches(self, matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Extract client-JD-resume matches for separate client output."""
        client_matches = []
        for jd_match in matches:
            client_match = {
                "jd_file": jd_match.get("jd_file"),
                "jd_title": jd_match.get("jd_title"),
                "jd_company": jd_match.get("jd_company"),
                "jd_required_skills": jd_match.get("jd_required_skills"),
                "jd_required_experience": jd_match.get("jd_required_experience"),
                "total_candidates": jd_match.get("total_candidates"),
                "client_fit_matches": [],
            }
            
            # Extract client fit data for each resume
            if "top_matches" in jd_match:
                for candidate in jd_match["top_matches"]:
                    # Use client_fit_score for status mapping in client output
                    client_fit_pct = float(candidate.get("client_fit_score", 50.0))
                    if client_fit_pct >= 70.0:
                        client_status = "Strong Fit"
                    elif client_fit_pct >= 50.0:
                        client_status = "Potential Fit"
                    elif client_fit_pct >= 30.0:
                        client_status = "Weak Fit"
                    else:
                        client_status = "Not Fit"
                    
                    client_fit_data = {
                        "resume_idx": candidate.get("resume_idx"),
                        "resume_file": candidate.get("resume_file"),
                        "resume_name": candidate.get("resume_name"),
                        "client_fit_score": candidate.get("client_fit_score"),
                        "client_fit_explanation": candidate.get("client_fit_explanation"),
                        "confidence": candidate.get("confidence"),
                        "confidence_level": candidate.get("confidence_level"),
                        "status": client_status,
                    }
                    client_match["client_fit_matches"].append(client_fit_data)
            
            client_matches.append(client_match)
        
        return client_matches

    def _build_resume_vector_index(self, resumes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        indexed = []
        for idx, resume in enumerate(resumes):
            resume_text = self._build_resume_text(resume)
            vector = self._embed_text(resume_text)
            item = {
                "id": f"resume_{idx}",
                "values": vector,
                "metadata": {
                    "resume_idx": idx,
                    "resume_file": resume.get("file"),
                    "resume_name": resume.get("name"),
                },
            }
            indexed.append(item)

        self.pinecone_manager.build_index(indexed)
        return indexed

    def _semantic_retrieve_candidates(
        self,
        jd: Dict[str, Any],
        indexed_resumes: List[Dict[str, Any]],
        retrieval_k: int,
    ) -> List[Dict[str, Any]]:
        jd_text = self._build_jd_text(jd)
        jd_skills = set(self._normalize_skill(s) for s in jd.get("skills", []) if s)

        # Prefer skill-list embedding for retrieval when JD lists skills — avoids full-text masking
        if jd_skills:
            query_vector = self._embed_list(list(jd_skills), prefix="skills")
        else:
            query_vector = self._embed_text(jd_text)
        hits = self.pinecone_manager.query(query_vector, top_k=retrieval_k)

        if not hits:
            # Fallback safety: include all candidates with zero retrieval score.
            return [
                {
                    "resume_idx": int(item.get("metadata", {}).get("resume_idx", i)),
                    "retrieval_similarity": 0.0,
                    "retrieval_rank": i + 1,
                }
                for i, item in enumerate(indexed_resumes)
            ]

        candidates = []
        for rank, hit in enumerate(hits, start=1):
            metadata = hit.get("metadata", {}) or {}
            resume_idx = metadata.get("resume_idx")
            if resume_idx is None:
                hit_id = str(hit.get("id", ""))
                if hit_id.startswith("resume_"):
                    try:
                        resume_idx = int(hit_id.split("_", 1)[1])
                    except Exception:
                        resume_idx = None
            if resume_idx is None:
                continue

            score = float(hit.get("score", 0.0) or 0.0)
            # Pinecone/local cosine is typically [-1,1] or [0,1], clamp to [0,1].
            score = max(0.0, min(1.0, score if score <= 1 else (score + 1.0) / 2.0))
            candidates.append(
                {
                    "resume_idx": int(resume_idx),
                    "retrieval_similarity": score,
                    "retrieval_rank": rank,
                }
            )

        # Ensure no duplicate resume index and stable ordering by rank.
        seen = set()
        unique = []
        for c in candidates:
            idx = c["resume_idx"]
            if idx in seen:
                continue
            seen.add(idx)
            unique.append(c)
        return unique

    def _llm_rerank(self, jd: Dict[str, Any], candidates: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
        """Rerank top candidates using LLM understanding.

        Returns map: resume_idx -> {score: float in [0,1], reason: str}
        """
        if not self.llm_api_key:
            return {}

        jd_payload = {
            "title": jd.get("title"),
            "required_skills": jd.get("skills", []),
            "required_experience_years": jd.get("experience_years"),
            "text": (jd.get("raw_text") or "")[:2000],
        }

        candidate_payload = []
        for c in candidates:
            candidate_payload.append(
                {
                    "resume_idx": c.get("resume_idx"),
                    "resume_name": c.get("resume_name"),
                    "resume_file": c.get("resume_file"),
                    "pre_llm_score": c.get("score"),
                    "matched_skills": c.get("matched_skills", {}),
                    "missing_skills": c.get("missing_skills", []),
                    "experience_years": c.get("resume_experience_years"),
                }
            )

        system_prompt = (
            "You are a precise hiring ranking assistant. For each candidate, produce a structured evaluation"
            " focused on required skills, role-fit, projects, and experience. Return strictly JSON with key 'scores'"
            " containing objects: {resume_idx:int, rerank_score:number(0-100), reason:string, strengths:list, weaknesses:list, decision:string}.")
        user_prompt = json.dumps(
            {
                "jd": jd_payload,
                "candidates": candidate_payload,
                "instruction": "For each candidate, provide a rerank_score (0-100), a concise reason, 3 strengths, 3 weaknesses, and a hiring decision (hire/maybe/reject). Keep output JSON only.",
            },
            ensure_ascii=False,
        )

        body = {
            "model": self.llm_model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        try:
            request = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.llm_api_key}",
                },
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            logging.warning("LLM reranking skipped due to request failure: %s", exc)
            return {}
        except Exception as exc:
            logging.warning("LLM reranking skipped due to unexpected error: %s", exc)
            return {}

        try:
            content = payload["choices"][0]["message"]["content"]
            data = json.loads(content)
            items = data.get("scores", []) if isinstance(data, dict) else []
        except Exception as exc:
            logging.warning("LLM reranking parse failed: %s", exc)
            return {}

        out: Dict[int, Dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            idx = item.get("resume_idx")
            raw = item.get("rerank_score")
            if idx is None or raw is None:
                continue
            try:
                score = float(raw) / 100.0
            except Exception:
                continue
            entry: Dict[str, Any] = {
                "score": max(0.0, min(1.0, score)),
                "reason": str(item.get("reason", "")).strip(),
            }
            if isinstance(item.get("strengths"), list):
                entry["strengths"] = item.get("strengths")
            if isinstance(item.get("weaknesses"), list):
                entry["weaknesses"] = item.get("weaknesses")
            if isinstance(item.get("decision"), str):
                entry["decision"] = item.get("decision")
            out[int(idx)] = entry
        return out
    
    def _find_semantic_skill_matches(self, jd_skills: set, resume_skills: set) -> set:
        """Find semantically related skills between JD and resume.
        
        Uses skill relationships to identify related skills beyond exact matches.
        """
        semantic_matches = set()
        
        for jd_skill in jd_skills:
            # Check if skill exists in resume
            if jd_skill in resume_skills:
                semantic_matches.add(jd_skill)
                continue
            
            # Check related skills
            related_skills = self.SKILL_RELATIONSHIPS.get(jd_skill, set())
            for related_skill in related_skills:
                if related_skill in resume_skills:
                    semantic_matches.add(related_skill)
            
            # Check if any resume skill has this as a related skill
            for resume_skill in resume_skills:
                related = self.SKILL_RELATIONSHIPS.get(resume_skill, set())
                if jd_skill in related:
                    semantic_matches.add(resume_skill)
        
        return semantic_matches

    @staticmethod
    def _normalize_skill(skill: str) -> str:
        normalized = re.sub(r"\s+", " ", (skill or "").strip().lower())
        alias_map = {
            "node.js": "nodejs",
            "artificial intelligence": "ai",
            "natural language processing": "nlp",
            "scikit learn": "scikit-learn",
            "rest api": "rest",
            "restful": "rest",
        }
        return alias_map.get(normalized, normalized)

    def _get_related_skills(self, skill: str) -> set:
        key = self._normalize_skill(skill)
        related = set(self.SKILL_RELATIONSHIPS.get(key, set()))
        return {self._normalize_skill(s) for s in related if s}

    def _embed_text(self, text: str) -> List[float]:
        cache_key = text or ""
        if cache_key in self._embedding_cache:
            return self._embedding_cache[cache_key]
        vector = self.embedding_model.embed(cache_key)
        self._embedding_cache[cache_key] = vector
        return vector

    def _embed_list(self, items: List[str], prefix: str = "list") -> List[float]:
        """Create an aggregated embedding for a list of short items (skills, techs).

        Uses a compact key for caching to avoid recomputing small embeddings.
        """
        if not items:
            return self._embed_text("")
        key = f"{prefix}:{'|'.join(sorted([str(i).strip().lower() for i in items if i]))}"
        return self._embed_text(key)

    def _cosine_vectors(self, v1: List[float], v2: List[float]) -> float:
        return max(0.0, min(1.0, (self.embedding_model.cosine_similarity(v1, v2) + 1.0) / 2.0))

    def _vector_similarity(self, text1: str, text2: str) -> float:
        v1 = self._embed_text(text1)
        v2 = self._embed_text(text2)
        cosine = self.embedding_model.cosine_similarity(v1, v2)
        # Normalize cosine [-1, 1] to [0, 1] for scoring consistency.
        return max(0.0, min(1.0, (cosine + 1.0) / 2.0))

    def _skill_similarity(self, jd_skill: str, resume_skill: str) -> float:
        a = self._normalize_skill(jd_skill)
        b = self._normalize_skill(resume_skill)

        if not a or not b:
            return 0.0
        if a == b:
            return 1.0

        if b in self._get_related_skills(a) or a in self._get_related_skills(b):
            return 0.9

        token_overlap = len(set(a.split()) & set(b.split()))
        vector_sim = self._vector_similarity(a, b)

        if token_overlap > 0:
            vector_sim = max(vector_sim, 0.72)

        return vector_sim

    def _is_semantic_match(self, jd_skill: str, resume_skill: str, similarity: float) -> bool:
        a = self._normalize_skill(jd_skill)
        b = self._normalize_skill(resume_skill)

        if not a or not b or a == b:
            return False

        # High-confidence semantic relation from curated skill graph.
        if b in self._get_related_skills(a) or a in self._get_related_skills(b):
            return True

        # Token-linked fuzzy match (for terms like rest/rest api, node.js/nodejs).
        shared_tokens = set(a.split()) & set(b.split())
        if shared_tokens and similarity >= self.skill_match_threshold:
            return True

        return False

    def _score_skill_coverage(self, jd_skills: set, resume_skills: set) -> Dict[str, Any]:
        # If JD does not list skills, return conservative/neutral values
        if not jd_skills:
            return {
                "exact_matches": [],
                "semantic_matches": [],
                "missing_skills": [],
                "semantic_mappings": [],
                "exact_skill_score": 0.0,
                "semantic_skill_score": 0.0,
                "combined_skill_score": 0.5,
                "avg_best_skill_similarity": 0.0,
            }

        exact_matches = set()
        semantic_matches = set()
        missing_skills = set()
        semantic_mappings = []
        best_similarities = []

        for jd_skill in jd_skills:
            best_resume_skill = None
            best_similarity = 0.0
            best_semantic_resume_skill = None
            best_semantic_similarity = 0.0

            for resume_skill in resume_skills:
                sim = self._skill_similarity(jd_skill, resume_skill)
                if sim > best_similarity:
                    best_similarity = sim
                    best_resume_skill = resume_skill

                if self._is_semantic_match(jd_skill, resume_skill, sim) and sim > best_semantic_similarity:
                    best_semantic_similarity = sim
                    best_semantic_resume_skill = resume_skill

            best_similarities.append(best_similarity)

            if best_resume_skill is None:
                missing_skills.add(jd_skill)
                continue

            if self._normalize_skill(jd_skill) == self._normalize_skill(best_resume_skill):
                exact_matches.add(jd_skill)
                semantic_matches.add(jd_skill)
                continue

            if best_semantic_resume_skill is not None:
                semantic_matches.add(jd_skill)
                semantic_mappings.append(
                    {
                        "jd_skill": jd_skill,
                        "resume_skill": best_semantic_resume_skill,
                        "similarity": round(best_semantic_similarity, 4),
                    }
                )
            else:
                missing_skills.add(jd_skill)

        total = float(len(jd_skills))
        exact_skill_score = len(exact_matches) / total
        semantic_skill_score = (len(exact_matches) + len(semantic_matches - exact_matches)) / total
        # Heavily favor exact matches; semantic matches count but less
        raw_combined = (0.75 * exact_skill_score) + (0.25 * semantic_skill_score)
        avg_best_skill_similarity = sum(best_similarities) / total if best_similarities else 0.0

        # Sharpen mapping: map raw combined into clearer bands
        if exact_skill_score >= 1.0:
            combined_skill_score = 0.98
        elif exact_skill_score >= 0.8:
            combined_skill_score = 0.88
        elif exact_skill_score >= 0.6:
            combined_skill_score = 0.72
        elif semantic_skill_score >= 0.6:
            combined_skill_score = 0.5
        elif raw_combined > 0:
            combined_skill_score = max(0.12, raw_combined * 0.6)
        else:
            combined_skill_score = 0.03

        return {
            "exact_matches": sorted(list(exact_matches)),
            "semantic_matches": sorted(list(semantic_matches - exact_matches)),
            "missing_skills": sorted(list(missing_skills)),
            "semantic_mappings": semantic_mappings,
            "exact_skill_score": exact_skill_score,
            "semantic_skill_score": semantic_skill_score,
            "combined_skill_score": combined_skill_score,
            "avg_best_skill_similarity": avg_best_skill_similarity,
        }

    @staticmethod
    def _build_resume_text(resume: Dict[str, Any]) -> str:
        parts = [
            str(resume.get("name", "")) if resume.get("name") else "",
            str(resume.get("role", "")) if resume.get("role") else "",
            " ".join([str(s) for s in resume.get("skills", []) if s]),
            str(resume.get("education", "")) if resume.get("education") else "",
        ]
        return " ".join([p for p in parts if p]).lower()

    @staticmethod
    def _build_jd_text(jd: Dict[str, Any]) -> str:
        parts = [
            str(jd.get("title", "")) if jd.get("title") else "",
            str(jd.get("raw_text", "")) if jd.get("raw_text") else "",
            " ".join([str(s) for s in jd.get("skills", []) if s]),
        ]
        return " ".join([p for p in parts if p]).lower()

    @staticmethod
    def _experience_match_score(jd_exp: Any, resume_exp: Any) -> float:
        try:
            jd_val = float(jd_exp) if jd_exp is not None else None
        except Exception:
            jd_val = None
        try:
            resume_val = float(resume_exp) if resume_exp is not None else None
        except Exception:
            resume_val = None

        # If JD does not require experience, give modest neutral (but not high)
        if jd_val is None or jd_val <= 0:
            # Prefer candidates with explicit experience; missing experience should not score high
            return 0.3

        # Missing or zero resume experience when JD requires it: mark as Unknown
        if resume_val is None or resume_val <= 0.0:
            return None

        if resume_val >= jd_val:
            return 1.0

        # Partial credit proportional, but floor at small value
        return max(0.0, min(1.0, resume_val / jd_val))

    def _project_match_score(self, jd: Dict[str, Any], projects: List[Any]) -> float:
        if not projects:
            return 0.1

        jd_skills = set(self._normalize_skill(s) for s in jd.get("skills", []) if s)
        techs = set()
        project_text = ""
        for p in projects:
            if isinstance(p, dict):
                techs.update(self._normalize_skill(t) for t in (p.get("technologies") or []) if t)
                project_text += " " + (str(p.get("title") or "") + " " + str(p.get("description") or ""))
            else:
                project_text += " " + str(p)

        techs = {t for t in techs if t}
        if not project_text.strip() and not techs:
            return 0.25

        # Tech overlap gives a clear signal
        if jd_skills and techs:
            inter = jd_skills & techs
            union = jd_skills | techs
            tech_score = len(inter) / len(union) if union else 0.0
        else:
            tech_score = 0.0

        # Domain/project textual match as secondary signal
        jd_text = self._build_jd_text(jd)
        lexical = self._calculate_text_similarity(jd_text, project_text.lower())
        semantic = self._vector_similarity(jd_text, project_text.lower())

        # Combine signals but produce higher variance: strong tech alignment => high score
        if tech_score >= 0.66:
            score = 0.8 + 0.2 * max(semantic, lexical)
        elif tech_score >= 0.33:
            score = 0.45 + 0.35 * max(semantic, lexical)
        else:
            score = 0.05 + 0.25 * max(semantic, lexical)

        return max(0.0, min(1.0, score))

    def _role_match_score(self, jd_title: Any, resume_role: Any) -> float:
        if not jd_title and not resume_role:
            return 0.2
        if not jd_title or not resume_role:
            return 0.05

        jd = str(jd_title).lower()
        rr = str(resume_role).lower()
        lexical = self._calculate_text_similarity(jd, rr)
        semantic = self._vector_similarity(jd, rr)

        # If both signals are weak, return 0 (not a role match)
        if semantic < 0.45 and lexical < 0.35:
            return 0.0

        # Otherwise emphasize semantic similarity but require threshold
        score = (0.25 * lexical) + (0.75 * semantic)
        return max(0.0, min(1.0, score))

    @staticmethod
    def _to_percent(value: float) -> float:
        """Convert ratio values in [0,1] into percentage [0,100]."""
        return round(max(0.0, min(1.0, float(value))) * 100.0, 2)
    
    @staticmethod
    def _calculate_text_similarity(text1: str, text2: str) -> float:
        """Calculate simple text similarity using word overlap."""
        words1 = set(text1.split())
        words2 = set(text2.split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        
        return intersection / union if union > 0 else 0.0
