"""Client Context Parser.

Converts raw Zoho CRM client data into a structured client context format
used for candidate-client fit scoring.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional


class ClientContextParser:
    """Parses raw Zoho CRM data into structured client context.
    
    Transforms raw API responses into a normalized schema suitable for
    client fit scoring operations.
    """
    
    # Mapping of Zoho field names to internal field names
    ZOHO_FIELD_MAPPING = {
        "Account_Name": "client_name",
        "Industry": "industry",
        "Company_Size": "company_size",
        "Website": "website",
        "Phone": "phone",
        "Billing_City": "location",
        "Annual_Revenue": "annual_revenue",
        "Number_of_Employees": "num_employees",
        "Description": "description",
    }
    
    # Company size categories mapping
    SIZE_CATEGORIES = {
        "startup": ["startup", "early-stage", "seed", "small", "0-50", "1-50"],
        "scale_up": ["scale-up", "growth", "series", "mid-sized", "51-500", "mid"],
        "enterprise": ["enterprise", "large", "fortune", "500+", "multinational"],
    }
    
    def __init__(self) -> None:
        """Initialize client context parser."""
        self.logger = logging.getLogger(__name__)
    
    def parse_zoho_profile(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Parse single Zoho CRM client profile into structured context.
        
        Args:
            raw_data: Raw client data from Zoho API
            
        Returns:
            Structured client context dict
        """
        if not raw_data:
            self.logger.warning("Empty raw data provided for parsing")
            return self._get_default_context()
        
        context = {
            "client_name": raw_data.get("Account_Name", "Unknown"),
            "client_id": raw_data.get("id"),
            "culture": self._extract_culture_context(raw_data),
            "hiring_preferences": self._extract_hiring_preferences(raw_data),
            "role_context": self._extract_role_context(raw_data),
            "urgency": self._extract_urgency_context(raw_data),
            "historical_patterns": self._extract_historical_patterns(raw_data),
            "source": "zoho_crm",
        }
        
        return context
    
    def parse_batch_profiles(self, raw_data_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Parse multiple Zoho client profiles.
        
        Args:
            raw_data_list: List of raw client data dicts
            
        Returns:
            List of structured client context dicts
        """
        results = []
        for raw_data in raw_data_list:
            try:
                context = self.parse_zoho_profile(raw_data)
                results.append(context)
            except Exception as e:
                self.logger.error(f"Failed to parse client profile: {e}")
        
        return results
    
    def _extract_culture_context(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract company culture context from raw data.
        
        Maps Zoho fields to culture characteristics.
        """
        company_size = str(raw_data.get("Company_Size", "")).lower()
        size_category = self._categorize_company_size(company_size)
        industry = self._extract_industry_context(raw_data)
        
        # Infer work style from company characteristics
        work_style = []
        if size_category == "startup":
            work_style = ["fast-paced", "collaborative", "innovative"]
        elif size_category == "scale_up":
            work_style = ["growth-oriented", "structured", "collaborative"]
        elif size_category == "enterprise":
            work_style = ["structured", "process-driven", "hierarchical"]
        
        return {
            "type": [size_category],
            "work_style": work_style,
            "company_size": company_size,
            "industry": industry,
        }
    
    def _extract_hiring_preferences(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract hiring preferences from raw data.
        
        Infers preferred background based on company characteristics.
        """
        company_size = str(raw_data.get("Company_Size", "")).lower()
        size_category = self._categorize_company_size(company_size)
        
        # Map company type to preferred background
        preferred_background = []
        if size_category == "startup":
            preferred_background = ["startup", "fast-paced"]
        elif size_category == "scale_up":
            preferred_background = ["startup", "scale-up", "growth"]
        elif size_category == "enterprise":
            preferred_background = ["enterprise", "corporate", "scale-up"]
        
        return {
            "preferred_background": preferred_background,
            "experience_level": self._infer_experience_level(raw_data),
            "remote_policy": raw_data.get("Remote_Policy", "unknown"),
        }
    
    def _extract_role_context(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract role-specific context.
        
        Industry, domain keywords, tech stack preferences, etc.
        """
        industry = self._extract_industry_context(raw_data)
        description = raw_data.get("Description", "")
        
        # Extract domain keywords from description
        domain_keywords = self._extract_keywords_from_text(description)
        tech_stack = raw_data.get("Tech_Stack", [])
        if isinstance(tech_stack, str):
            tech_stack = [s.strip() for s in tech_stack.split(",") if s.strip()]
        
        return {
            "industry": industry,
            "domain_keywords": domain_keywords,
            "tech_stack": tech_stack or self._extract_skills_from_text(description),
            "team_size": raw_data.get("Team_Size"),
            "hiring_manager": raw_data.get("Hiring_Manager_Name"),
        }
    
    def _extract_urgency_context(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract hiring urgency information.
        
        Based on fields like hiring timeline, open positions, etc.
        """
        urgency_level = raw_data.get("Hiring_Urgency", "medium").lower()
        if urgency_level not in ("high", "medium", "low"):
            urgency_level = "medium"
        
        return {
            "level": urgency_level,
            "open_positions": raw_data.get("Number_of_Open_Positions", 0),
            "target_start_date": raw_data.get("Target_Start_Date"),
        }
    
    def _extract_historical_patterns(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract historical hiring patterns.
        
        Average experience, common skills, past hire profiles, etc.
        """
        avg_exp = raw_data.get("Avg_Experience_Years")
        common_skills = raw_data.get("Common_Skills_Required", []) or raw_data.get("Tech_Stack", [])
        description = raw_data.get("Description", "")
        
        # Parse if common skills are in string format
        if isinstance(common_skills, str):
            common_skills = [s.strip() for s in common_skills.split(",")]
        if not common_skills:
            common_skills = self._extract_skills_from_text(description)
        if not common_skills:
            common_skills = ["unknown"]
        
        return {
            "avg_experience": float(avg_exp) if avg_exp else self._infer_avg_experience_from_text(description),
            "common_skills": common_skills,
            "typical_education": raw_data.get("Typical_Education_Level") or self._infer_education_from_text(description),
            "past_hire_background": raw_data.get("Past_Hire_Background", []) or [self._categorize_company_size(str(raw_data.get("Company_Size", "")).lower())],
            "successful_candidate_traits": self._extract_traits(raw_data),
        }
    
    def _categorize_company_size(self, size_str: str) -> str:
        """Categorize company size into standard categories.
        
        Args:
            size_str: Company size string from Zoho
            
        Returns:
            One of: "startup", "scale_up", "enterprise"
        """
        size_lower = size_str.lower()
        
        for category, keywords in self.SIZE_CATEGORIES.items():
            for keyword in keywords:
                if keyword in size_lower:
                    return category
        
        return "scale_up"  # Default category
    
    def _infer_experience_level(self, raw_data: Dict[str, Any]) -> str:
        """Infer required experience level from company characteristics."""
        avg_exp = raw_data.get("Avg_Experience_Years")
        company_size = str(raw_data.get("Company_Size", "")).lower()
        
        # Startups often hire junior/mid-level
        if "startup" in company_size or "early" in company_size:
            return "junior-to-mid"
        
        # Enterprise often wants senior
        if "enterprise" in company_size or "large" in company_size:
            return "mid-to-senior"
        
        # Default based on average experience
        if avg_exp:
            try:
                exp_years = float(avg_exp)
                if exp_years < 2:
                    return "junior"
                elif exp_years < 5:
                    return "mid"
                else:
                    return "senior"
            except (ValueError, TypeError):
                pass
        
        return "mid"
    
    def _extract_keywords_from_text(self, text: str) -> List[str]:
        """Extract domain keywords from free-form text.
        
        Simple keyword extraction - can be enhanced with NLP.
        """
        if not text:
            return []
        
        # Common industry/domain keywords
        keywords_dict = {
            "fintech": ["fintech", "finance", "payment", "banking", "trading"],
            "healthcare": ["healthcare", "medical", "pharma", "hospital", "clinic"],
            "ecommerce": ["ecommerce", "retail", "marketplace", "shopping"],
            "saas": ["saas", "cloud", "subscription"],
            "ai_ml": ["ai", "machine learning", "ml", "deep learning", "nlp"],
        }
        
        text_lower = text.lower()
        found_keywords = []
        
        for domain, keywords in keywords_dict.items():
            for keyword in keywords:
                if keyword in text_lower:
                    found_keywords.append(domain)
                    break  # Add domain once
        
        return found_keywords

    def _extract_skills_from_text(self, text: str) -> List[str]:
        """Extract likely skills from free-form text."""
        if not text:
            return []

        skill_keywords = [
            "python", "java", "sql", "aws", "azure", "gcp", "docker", "kubernetes",
            "tensorflow", "pytorch", "machine learning", "deep learning", "nlp", "llm",
            "react", "node.js", "fastapi", "django", "flask", "rest", "api",
            "fintech", "telecom", "healthcare", "ecommerce", "saas",
        ]
        lowered = text.lower()
        skills = [keyword for keyword in skill_keywords if keyword in lowered]
        return sorted(set(skills))

    def _extract_industry_context(self, raw_data: Dict[str, Any]) -> str:
        """Normalize industry into a canonical tag."""
        industry = str(raw_data.get("Industry", "") or "").lower()
        description = str(raw_data.get("Description", "") or "").lower()
        text = f"{industry} {description}"

        industry_map = {
            "fintech": ["fintech", "finance", "bank", "payments", "payment", "trading", "loan", "insurance"],
            "ai_ml": ["ai", "artificial intelligence", "machine learning", "ml", "deep learning", "nlp", "llm", "pytorch", "tensorflow"],
            "telecom": ["telecom", "telecommunications", "network", "5g", "carrier"],
            "healthcare": ["healthcare", "medical", "hospital", "clinical", "pharma", "biotech"],
            "ecommerce": ["ecommerce", "e-commerce", "retail", "marketplace", "shopping"],
            "saas": ["saas", "subscription", "cloud software", "b2b software"],
        }

        for canonical, keywords in industry_map.items():
            if any(keyword in text for keyword in keywords):
                return canonical

        return industry or "unknown"

    def _infer_avg_experience_from_text(self, text: str) -> Optional[float]:
        """Infer expected experience from text when no explicit value exists."""
        if not text:
            return None
        match = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)", text, flags=re.IGNORECASE)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                return None
        return None

    def _infer_education_from_text(self, text: str) -> Optional[str]:
        """Infer typical education from text when not explicitly provided."""
        if not text:
            return None
        lowered = text.lower()
        if any(token in lowered for token in ("phd", "doctorate")):
            return "PhD"
        if any(token in lowered for token in ("m.tech", "mtech", "masters", "m.s.", "ms")):
            return "Master's"
        if any(token in lowered for token in ("b.tech", "btech", "b.e.", "bachelor", "b.s.", "bs")):
            return "Bachelor's"
        return None
    
    def _extract_traits(self, raw_data: Dict[str, Any]) -> List[str]:
        """Extract successful candidate traits from raw data."""
        traits_raw = raw_data.get("Successful_Candidate_Traits", [])
        
        if isinstance(traits_raw, str):
            traits = [t.strip() for t in traits_raw.split(",")]
        elif isinstance(traits_raw, list):
            traits = [str(t).strip() for t in traits_raw]
        else:
            traits = []
        
        return [t for t in traits if t]
    
    def _get_default_context(self) -> Dict[str, Any]:
        """Return default/empty client context.
        
        Used when data is unavailable or parsing fails.
        """
        return {
            "client_name": "Unknown",
            "client_id": None,
            "culture": {
                "type": ["unknown"],
                "work_style": [],
                "company_size": "",
                "industry": "unknown",
            },
            "hiring_preferences": {
                "preferred_background": [],
                "experience_level": "mid",
                "remote_policy": "unknown",
            },
            "role_context": {
                "industry": "unknown",
                "domain_keywords": [],
                "tech_stack": ["unknown"],
                "team_size": None,
                "hiring_manager": None,
            },
            "urgency": {
                "level": "medium",
                "open_positions": 0,
                "target_start_date": None,
            },
            "historical_patterns": {
                "avg_experience": None,
                "common_skills": ["unknown"],
                "typical_education": None,
                "past_hire_background": ["unknown"],
                "successful_candidate_traits": [],
            },
            "source": "default",
        }
    
    def merge_contexts(self, contexts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge multiple client contexts into aggregated context.
        
        Useful when matching against multiple similar clients.
        
        Args:
            contexts: List of parsed client contexts
            
        Returns:
            Merged/aggregated context
        """
        if not contexts:
            return self._get_default_context()
        
        # Start with first context
        merged = json.loads(json.dumps(contexts[0]))
        
        # Aggregate common fields
        if len(contexts) > 1:
            all_skills = []
            all_industries = []
            all_keywords = []
            
            for ctx in contexts:
                all_skills.extend(
                    ctx.get("historical_patterns", {}).get("common_skills", [])
                )
                all_keywords.extend(
                    ctx.get("role_context", {}).get("domain_keywords", [])
                )
                industry = ctx.get("role_context", {}).get("industry", "")
                if industry:
                    all_industries.append(industry)
            
            # Update merged context with aggregated data
            if all_skills:
                merged["historical_patterns"]["common_skills"] = list(set(all_skills))
            if all_keywords:
                merged["role_context"]["domain_keywords"] = list(set(all_keywords))
            if all_industries:
                merged["role_context"]["industry"] = ", ".join(set(all_industries))
        
        return merged
