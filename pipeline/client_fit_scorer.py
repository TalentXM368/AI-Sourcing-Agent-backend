"""Client Fit Scorer.

Computes candidate-client fit score based on structured client context.
Evaluates how well a candidate's profile matches the client's culture,
hiring preferences, and role requirements.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple


class ClientFitScorer:
    """Computes client-specific fit scores for candidates.
    
    Evaluates:
    - Candidate background fit with client preferences
    - Industry/domain experience alignment
    - Skill alignment with historical patterns
    - Experience level match
    """

    INDUSTRY_KEYWORDS = {
        "fintech": ["fintech", "finance", "bank", "banking", "payment", "payments", "trading", "loan", "insurance"],
        "ai_ml": ["ai", "artificial intelligence", "machine learning", "ml", "deep learning", "nlp", "llm", "pytorch", "tensorflow"],
        "telecom": ["telecom", "telecommunications", "network", "5g", "carrier"],
        "healthcare": ["healthcare", "medical", "hospital", "clinical", "pharma", "biotech"],
        "ecommerce": ["ecommerce", "e-commerce", "retail", "marketplace", "shopping"],
        "saas": ["saas", "subscription", "cloud", "platform", "b2b software"],
    }

    BACKGROUND_KEYWORDS = {
        "startup": ["startup", "seed", "early-stage", "founder", "launch", "built", "prototype", "hackathon", "fast-paced"],
        "scale_up": ["scale-up", "growth", "series a", "series b", "scaling", "hypergrowth", "mid-sized"],
        "enterprise": ["enterprise", "corporate", "global", "large-scale", "regulated", "process-driven", "fortune"],
    }
    
    def __init__(self) -> None:
        """Initialize client fit scorer."""
        self.logger = logging.getLogger(__name__)
        self.skill_match_threshold = 0.75
        self.neutral_score = 50.0
    
    def compute_client_fit_score(
        self,
        resume: Dict[str, Any],
        client_context: Optional[Dict[str, Any]],
        jd_context: Optional[Dict[str, Any]] = None,
    ) -> Tuple[float, Dict[str, Any]]:
        """Compute client-specific fit score for a candidate.

        Missing signals are ignored rather than treated as zero. When client
        context is sparse, JD data is used as a fallback for skills, industry,
        and experience targets.
        """
        effective_context = self._build_effective_context(client_context, jd_context)
        candidate = self._extract_candidate_profile(resume)

        components = {
            "background_fit": self._score_background_fit(candidate, effective_context),
            "industry_fit": self._score_industry_fit(candidate, effective_context),
            "skill_fit": self._score_skill_fit(candidate, effective_context),
            "experience_fit": self._score_experience_fit(candidate, effective_context),
        }

        weighted_total = 0.0
        weight_sum = 0.0
        signals_used: List[str] = []
        for name, component in components.items():
            if not component.get("available", True):
                continue
            weight = float(component.get("weight", 0.0))
            weighted_total += weight * float(component.get("score", self.neutral_score))
            weight_sum += weight
            signals_used.append(name)

        if weight_sum == 0.0:
            final_score = self.neutral_score
        else:
            final_score = weighted_total / weight_sum

        final_score = max(0.0, min(100.0, final_score))
        explanation = {
            "score": round(final_score, 2),
            "reason": self._generate_reason(final_score, candidate, effective_context, signals_used),
            "signals_used": signals_used,
            "fallback_used": effective_context.get("fallback_used", []),
            "components": components,
        }

        self.logger.debug(
            "Client fit score computed: resume=%s client=%s score=%.2f signals=%s fallback=%s",
            candidate.get("name") or candidate.get("role") or "unknown",
            effective_context.get("client_name", "unknown"),
            final_score,
            signals_used,
            effective_context.get("fallback_used", []),
        )

        return final_score, explanation
    
    def _score_background_fit(
        self,
        candidate: Dict[str, Any],
        client_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Score how well candidate's background matches client preferences."""
        preferred_backgrounds = self._normalize_list(
            client_context.get("hiring_preferences", {}).get("preferred_background", [])
        )
        candidate_background = self._normalize_background(
            candidate.get("background")
            or candidate.get("role")
            or candidate.get("industry")
            or ""
        )

        if not preferred_backgrounds:
            preferred_backgrounds = self._normalize_list(
                client_context.get("jd_fallback", {}).get("preferred_background", [])
            )

        if not preferred_backgrounds:
            return {
                "score": self.neutral_score,
                "details": "No preferred background defined",
                "available": False,
                "weight": 0.30,
            }

        if candidate_background == "unknown":
            return {
                "score": self.neutral_score,
                "details": f"Candidate background could not be inferred; compared against {', '.join(preferred_backgrounds)}",
                "available": True,
                "weight": 0.30,
            }

        exact_match = candidate_background in preferred_backgrounds
        related_pairs = {
            ("startup", "scale_up"),
            ("scale_up", "startup"),
            ("enterprise", "scale_up"),
            ("scale_up", "enterprise"),
        }

        if exact_match:
            score = 92.0
            details = f"Candidate background {candidate_background} matches preferred background"
        elif any((candidate_background, pref) in related_pairs for pref in preferred_backgrounds):
            score = 74.0
            details = f"Candidate background {candidate_background} is adjacent to preferred backgrounds: {', '.join(preferred_backgrounds)}"
        else:
            score = 42.0
            details = f"Candidate background {candidate_background} differs from preferred backgrounds: {', '.join(preferred_backgrounds)}"

        return {
            "score": score,
            "details": details,
            "available": True,
            "weight": 0.30,
            "candidate_background": candidate_background,
            "preferred_backgrounds": preferred_backgrounds,
        }
    
    def _score_industry_fit(
        self,
        candidate: Dict[str, Any],
        client_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Score candidate's industry/domain experience match."""
        industry = self._normalize_industry(
            client_context.get("role_context", {}).get("industry", "")
        )
        domain_keywords = self._normalize_list(
            client_context.get("role_context", {}).get("domain_keywords", [])
        )
        candidate_industry = self._normalize_industry(
            candidate.get("industry")
            or candidate.get("role")
            or ""
        )
        candidate_text = self._build_candidate_text(candidate).lower()

        if industry == "unknown" and not domain_keywords:
            fallback_industry = self._normalize_industry(
                client_context.get("jd_fallback", {}).get("industry", "")
            )
            industry = fallback_industry
            domain_keywords = self._normalize_list(
                client_context.get("jd_fallback", {}).get("domain_keywords", [])
            )

        if industry == "unknown" and not domain_keywords:
            return {
                "score": self.neutral_score,
                "details": "No industry/domain specified",
                "available": False,
                "weight": 0.25,
            }

        matched_signals: List[str] = []
        related_pairs = {
            ("fintech", "saas"),
            ("saas", "fintech"),
            ("ai_ml", "saas"),
            ("ai_ml", "ecommerce"),
            ("telecom", "enterprise"),
            ("healthcare", "enterprise"),
        }

        if industry != "unknown":
            if candidate_industry == industry:
                base_score = 95.0
                matched_signals.append(f"industry:{industry}")
            elif (candidate_industry, industry) in related_pairs:
                base_score = 65.0
                matched_signals.append(f"related:{candidate_industry}->{industry}")
            elif industry in candidate_text or candidate_industry == "unknown" and any(keyword in candidate_text for keyword in domain_keywords):
                base_score = 52.0
                matched_signals.append(f"text:{industry}")
            else:
                base_score = 24.0
        else:
            base_score = self.neutral_score

        keyword_score = 0.0
        if domain_keywords:
            keyword_matches = [kw for kw in domain_keywords if kw in candidate_text]
            keyword_ratio = len(keyword_matches) / max(1, len(domain_keywords))
            keyword_score = keyword_ratio * 40.0
            matched_signals.extend(f"keyword:{kw}" for kw in keyword_matches)

        if industry == "unknown" and not domain_keywords:
            return {
                "score": self.neutral_score,
                "details": "No comparable industry signals",
                "available": False,
                "weight": 0.25,
            }

        score = min(100.0, base_score + keyword_score)
        return {
            "score": score,
            "details": f"Matched: {', '.join(matched_signals) if matched_signals else 'None'}, Expected: {industry}, Keywords: {', '.join(domain_keywords) if domain_keywords else 'None'}",
            "available": True,
            "weight": 0.25,
            "candidate_industry": candidate_industry,
            "expected_industry": industry,
            "matched_signals": matched_signals,
        }
    
    def _score_skill_fit(
        self,
        candidate: Dict[str, Any],
        client_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Score how well candidate's skills match historical/client patterns."""
        common_skills = self._normalize_list(
            client_context.get("historical_patterns", {}).get("common_skills", [])
        )
        if not common_skills:
            common_skills = self._normalize_list(
                client_context.get("jd_fallback", {}).get("skills", [])
            )

        resume_skills = self._normalize_list(candidate.get("skills", []))
        if not common_skills:
            return {
                "score": self.neutral_score,
                "details": "No common skills pattern defined",
                "available": False,
                "weight": 0.30,
            }

        if not resume_skills:
            return {
                "score": 50.0,
                "details": "Candidate has no structured skills; using neutral skill fit",
                "available": True,
                "weight": 0.30,
            }

        matched_skills = sorted(set(resume_skills) & set(common_skills))
        matched_skill_ratio = len(matched_skills) / max(1, len(common_skills))
        extra_signal_bonus = 0.0
        if any(skill in resume_skills for skill in ("python", "sql", "machine learning", "deep learning", "aws", "azure", "gcp")):
            extra_signal_bonus += 10.0
        if any(skill in resume_skills for skill in ("react", "django", "fastapi", "flask", "node.js")):
            extra_signal_bonus += 5.0

        score = min(100.0, (matched_skill_ratio * 85.0) + extra_signal_bonus)
        return {
            "score": score,
            "details": f"Matched skills: {', '.join(matched_skills) if matched_skills else 'None'}, Expected: {', '.join(common_skills)}",
            "available": True,
            "weight": 0.30,
            "matched_skills": matched_skills,
            "expected_skills": common_skills,
        }
    
    def _score_experience_fit(
        self,
        candidate: Dict[str, Any],
        client_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Score experience level and years alignment."""
        avg_exp_years = client_context.get("historical_patterns", {}).get("avg_experience")
        required_level = client_context.get("hiring_preferences", {}).get("experience_level", "mid")
        if avg_exp_years is None:
            avg_exp_years = client_context.get("jd_fallback", {}).get("experience_years")
            if avg_exp_years is not None:
                required_level = self._level_from_years(avg_exp_years)

        candidate_exp = candidate.get("experience_years")
        candidate_level = candidate.get("experience_level", "unknown")

        if candidate_exp is None and avg_exp_years is None:
            return {
                "score": self.neutral_score,
                "details": "Cannot determine experience alignment",
                "available": False,
                "weight": 0.15,
            }

        if candidate_exp is None:
            level_score = self._level_alignment_score(candidate_level, required_level)
            return {
                "score": level_score,
                "details": f"Candidate experience missing; level alignment used: {candidate_level} vs {required_level}",
                "available": True,
                "weight": 0.15,
            }

        try:
            cand_exp = float(candidate_exp)
        except (ValueError, TypeError):
            cand_exp = None

        if cand_exp is None and avg_exp_years is None:
            return {
                "score": self.neutral_score,
                "details": "Cannot determine experience alignment",
                "available": False,
                "weight": 0.15,
            }

        if cand_exp is None:
            level_score = self._level_alignment_score(candidate_level, required_level)
            return {
                "score": level_score,
                "details": f"Experience years unavailable; level alignment used: {candidate_level} vs {required_level}",
                "available": True,
                "weight": 0.15,
            }

        if avg_exp_years is None:
            return {
                "score": self._level_alignment_score(candidate_level, required_level),
                "details": f"Client experience unavailable; level alignment used: {candidate_level} vs {required_level}",
                "available": True,
                "weight": 0.15,
            }

        try:
            avg_exp = float(avg_exp_years)
            diff = abs(cand_exp - avg_exp)
            if diff <= 1.0:
                score = 96.0
            elif diff <= 3.0:
                score = 82.0
            elif diff <= 5.0:
                score = 68.0
            else:
                score = max(35.0, 100.0 - (diff * 6.0))
        except (ValueError, TypeError):
            score = self.neutral_score

        score = min(100.0, score * self._level_alignment_multiplier(required_level, candidate_level))
        return {
            "score": score,
            "details": f"Candidate: {cand_exp} years, Target: {avg_exp_years} years, Required level: {required_level}",
            "available": True,
            "weight": 0.15,
        }
    
    def _build_candidate_text(self, resume: Dict[str, Any]) -> str:
        """Build searchable text from candidate profile for keyword matching."""
        parts = []
        
        # Include all relevant fields
        for field in ("role", "skills", "education", "projects", "industry", "background"):
            value = resume.get(field)
            if value:
                if isinstance(value, list):
                    parts.append(" ".join(str(v) for v in value))
                else:
                    parts.append(str(value))
        
        return " ".join(parts)
    
    def _generate_reason(
        self,
        score: float,
        candidate: Dict[str, Any],
        client_context: Dict[str, Any],
        signals_used: List[str],
    ) -> str:
        """Generate human-readable explanation for the score."""
        client_name = client_context.get("client_name", "Client")
        matched_parts: List[str] = []
        missing_parts: List[str] = []

        if "skill_fit" in signals_used:
            matched_parts.append("skills")
        if "industry_fit" in signals_used:
            matched_parts.append("industry")
        if "background_fit" in signals_used:
            matched_parts.append("background")
        if "experience_fit" in signals_used:
            matched_parts.append("experience")

        if score >= 80:
            prefix = "Strong fit"
        elif score >= 60:
            prefix = "Good fit"
        elif score >= 40:
            prefix = "Moderate fit"
        else:
            prefix = "Limited fit"

        if not matched_parts:
            return f"{prefix} for {client_name}, based on neutral evidence only"

        if not missing_parts:
            return f"{prefix} for {client_name}: matched {', '.join(matched_parts)}"

        return f"{prefix} for {client_name}: matched {', '.join(matched_parts)}, gaps in {', '.join(missing_parts)}"
    
    def apply_client_penalty(
        self,
        final_score: float,
        client_fit_score: float,
        penalty_threshold: float = 35.0,
        penalty_multiplier: float = 0.92,
    ) -> Tuple[float, Optional[str]]:
        """Apply penalty to final score if client fit is below threshold.
        
        Args:
            final_score: Current final score (0-100)
            client_fit_score: Client fit score (0-100)
            penalty_threshold: If client_fit < threshold, apply penalty
            penalty_multiplier: Multiply score by this factor (e.g., 0.85)
            
        Returns:
            Tuple of (adjusted_score, penalty_reason or None)
        """
        if client_fit_score < penalty_threshold:
            penalized = max(final_score * penalty_multiplier, final_score - 0.05)
            reason = (
                f"Client fit score ({client_fit_score:.1f}) below threshold "
                f"({penalty_threshold:.1f}), applied {(1-penalty_multiplier)*100:.0f}% penalty"
            )
            return penalized, reason
        
        return final_score, None

    def _build_effective_context(
        self,
        client_context: Optional[Dict[str, Any]],
        jd_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Backfill sparse client context using JD data as a backup."""
        base = client_context.copy() if isinstance(client_context, dict) else {}
        jd_context = jd_context or {}
        fallback_used: List[str] = []

        base.setdefault("hiring_preferences", {})
        base.setdefault("role_context", {})
        base.setdefault("historical_patterns", {})
        base["jd_fallback"] = {
            "skills": jd_context.get("skills", []),
            "industry": self._normalize_industry(jd_context.get("title", "") or jd_context.get("raw_text", "")),
            "domain_keywords": self._extract_keywords_from_text(jd_context.get("raw_text", "") or jd_context.get("title", "")),
            "experience_years": jd_context.get("experience_years"),
            "preferred_background": self._infer_jd_background(jd_context),
        }

        if not base["hiring_preferences"].get("preferred_background"):
            base["hiring_preferences"]["preferred_background"] = base["jd_fallback"]["preferred_background"]
            fallback_used.append("preferred_background")
        if not base["role_context"].get("industry"):
            base["role_context"]["industry"] = base["jd_fallback"]["industry"]
            fallback_used.append("industry")
        if not base["historical_patterns"].get("common_skills"):
            base["historical_patterns"]["common_skills"] = base["jd_fallback"]["skills"]
            fallback_used.append("common_skills")
        if base["historical_patterns"].get("avg_experience") is None and jd_context.get("experience_years") is not None:
            base["historical_patterns"]["avg_experience"] = jd_context.get("experience_years")
            fallback_used.append("avg_experience")
        if base["hiring_preferences"].get("experience_level", "mid") in (None, "", "mid") and jd_context.get("experience_years") is not None:
            base["hiring_preferences"]["experience_level"] = self._level_from_years(jd_context.get("experience_years"))
            fallback_used.append("experience_level")

        base["fallback_used"] = sorted(set(fallback_used))
        return base

    def _extract_candidate_profile(self, resume: Dict[str, Any]) -> Dict[str, Any]:
        """Build a normalized candidate profile from resume fields."""
        return {
            "name": resume.get("name"),
            "role": resume.get("role"),
            "skills": resume.get("skills", []),
            "experience_years": resume.get("experience_years"),
            "education": resume.get("education"),
            "projects": resume.get("projects", []),
            "industry": resume.get("industry", "unknown"),
            "background": resume.get("background") or self._infer_resume_background(resume),
            "experience_level": resume.get("experience_level", "unknown"),
        }

    def _normalize_list(self, values: Any) -> List[str]:
        if values is None:
            return []
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list):
            return [str(values).strip().lower()] if str(values).strip() else []
        return [str(v).strip().lower() for v in values if str(v).strip() and str(v).strip().lower() != "unknown"]

    def _normalize_background(self, value: Any) -> str:
        text = str(value or "").lower()
        if any(keyword in text for keyword in self.BACKGROUND_KEYWORDS["startup"]):
            return "startup"
        if any(keyword in text for keyword in self.BACKGROUND_KEYWORDS["enterprise"]):
            return "enterprise"
        if any(keyword in text for keyword in self.BACKGROUND_KEYWORDS["scale_up"]):
            return "scale_up"
        return "unknown"

    def _normalize_industry(self, value: Any) -> str:
        text = str(value or "").lower()
        for canonical, keywords in self.INDUSTRY_KEYWORDS.items():
            if any(keyword in text for keyword in keywords):
                return canonical
        return text or "unknown"

    def _extract_keywords_from_text(self, text: str) -> List[str]:
        """Extract normalized industry/domain keywords from free-form text."""
        if not text:
            return []

        lowered = text.lower()
        keywords = []
        for canonical, aliases in self.INDUSTRY_KEYWORDS.items():
            if any(alias in lowered for alias in aliases):
                keywords.append(canonical)

        return sorted(set(keywords))

    def _infer_resume_background(self, resume: Dict[str, Any]) -> str:
        """Infer candidate background from resume fields."""
        text = " ".join([
            str(resume.get("background", "")),
            str(resume.get("role", "")),
            str(resume.get("industry", "")),
            " ".join(str(p) for p in resume.get("projects", []) if p),
        ]).lower()
        if any(keyword in text for keyword in self.BACKGROUND_KEYWORDS["startup"]):
            return "startup"
        if any(keyword in text for keyword in self.BACKGROUND_KEYWORDS["enterprise"]):
            return "enterprise"
        if any(keyword in text for keyword in self.BACKGROUND_KEYWORDS["scale_up"]):
            return "scale_up"
        return "unknown"

    def _infer_jd_background(self, jd_context: Dict[str, Any]) -> List[str]:
        text = f"{jd_context.get('title', '')} {jd_context.get('raw_text', '')}".lower()
        if any(token in text for token in ("startup", "fast-paced", "agile", "growth")):
            return ["startup"]
        if any(token in text for token in ("enterprise", "process", "regulated", "corporate")):
            return ["enterprise"]
        if any(token in text for token in ("scale", "series", "mid-sized")):
            return ["scale_up"]
        return []

    def _level_from_years(self, years: Any) -> str:
        try:
            value = float(years)
        except (TypeError, ValueError):
            return "mid"
        if value < 2:
            return "junior"
        if value < 5:
            return "mid"
        if value < 8:
            return "mid-to-senior"
        return "senior"

    def _level_alignment_score(self, candidate_level: str, required_level: str) -> float:
        candidate_level = (candidate_level or "unknown").lower()
        required_level = (required_level or "mid").lower()
        if candidate_level == "unknown":
            return 50.0
        if candidate_level == required_level:
            return 90.0
        compatible_pairs = {
            ("junior", "mid"),
            ("mid", "junior"),
            ("mid", "mid-to-senior"),
            ("mid-to-senior", "mid"),
            ("mid-to-senior", "senior"),
            ("senior", "mid-to-senior"),
        }
        if (candidate_level, required_level) in compatible_pairs:
            return 74.0
        return 46.0

    def _level_alignment_multiplier(self, required_level: str, candidate_level: str) -> float:
        score = self._level_alignment_score(candidate_level, required_level)
        return max(0.75, min(1.0, score / 100.0 + 0.1))
