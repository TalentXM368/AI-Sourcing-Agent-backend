"""Job Description parser module for bulk processing.

Provides local parsing of job descriptions with optional LLM enhancement.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup
from docx import Document
from odf import teletype
from odf.opendocument import load as odf_load
from pypdf import PdfReader
from striprtf.striprtf import rtf_to_text

try:
    from .llm_jd_parser import LLMConfig, OpenAIJDParser
except Exception:  # pragma: no cover
    LLMConfig = None
    OpenAIJDParser = None


def extract_text_from_file(file_path: Path) -> str:
    """Extract text from various file formats."""
    suffix = file_path.suffix.lower()
    
    if suffix == ".pdf":
        reader = PdfReader(str(file_path))
        return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    
    if suffix == ".docx":
        doc = Document(str(file_path))
        return "\n".join(p.text for p in doc.paragraphs).strip()
    
    if suffix == ".odt":
        doc = odf_load(str(file_path))
        return teletype.extractText(doc).strip()
    
    if suffix == ".rtf":
        raw = file_path.read_text(encoding="utf-8", errors="ignore")
        return rtf_to_text(raw).strip()
    
    if suffix in {".html", ".htm"}:
        html = file_path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(html, "html.parser")
        return soup.get_text(separator="\n", strip=True).strip()
    
    # Default: read as text
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return file_path.read_text(encoding=encoding).strip()
        except UnicodeDecodeError:
            continue
    
    return file_path.read_text(errors="ignore").strip()


def parse_jd(file_path: Path, llm_config: Optional[Any] = None) -> Dict[str, Any]:
    """Parse a single job description file.
    
    Args:
        file_path: Path to the JD file
        llm_config: Optional LLM configuration for enhancement
        
    Returns:
        Dictionary with parsed JD data
    """
    text = extract_text_from_file(file_path)
    
    # Basic local parsing
    parsed = {
        "file_name": file_path.name,
        "file_path": str(file_path),
        "raw_text": text,
        "title": _extract_title(text),
        "company": _extract_company(text),
        "job_description": text[:500],  # First 500 chars as summary
        "required_skills": _extract_skills(text),
        "required_experience_years": _extract_experience_years(text),
    }
    
    # LLM enhancement if available
    if llm_config and OpenAIJDParser:
        try:
            llm_parser = OpenAIJDParser(llm_config)
            enhanced = llm_parser.parse(text)
            if enhanced:
                parsed.update(enhanced)
        except Exception as e:
            logging.warning(f"LLM parsing failed for {file_path.name}: {e}")
    
    return parsed


def process_directory(
    input_dir: Path,
    recursive: bool = True,
    use_llm: bool = False,
    llm_config: Optional[Any] = None,
    llm_mode: str = "primary",
    max_workers: int = 1,
    **kwargs
) -> List[Dict[str, Any]]:
    """Process all JD files in a directory.
    
    Args:
        input_dir: Directory containing JD files
        recursive: Whether to search subdirectories
        use_llm: Whether to use LLM for parsing
        llm_config: LLM configuration
        llm_mode: LLM mode (primary, secondary, etc.)
        max_workers: Max parallel workers
        
    Returns:
        List of parsed JD dictionaries
    """
    # Find all supported files
    supported_extensions = {".pdf", ".docx", ".txt", ".doc", ".odt", ".rtf", ".html", ".htm"}
    
    if not input_dir.exists():
        logging.error(f"Input directory does not exist: {input_dir}")
        return []
    
    if recursive:
        files = [f for f in input_dir.rglob("*") 
                if f.is_file() and f.suffix.lower() in supported_extensions]
    else:
        files = [f for f in input_dir.glob("*") 
                if f.is_file() and f.suffix.lower() in supported_extensions]
    
    if not files:
        logging.warning(f"No JD files found in {input_dir}")
        return []
    
    logging.info(f"Found {len(files)} JD files to process")
    
    results = []
    for file_path in files:
        try:
            logging.info(f"Processing: {file_path.name}")
            parsed = parse_jd(file_path, llm_config if use_llm else None)
            parsed["status"] = "success"
            results.append(parsed)
        except Exception as e:
            logging.error(f"Failed to parse {file_path.name}: {e}")
            results.append({
                "file_name": file_path.name,
                "file_path": str(file_path),
                "status": "failed",
                "error": str(e),
            })
    
    return results


def _extract_title(text: str) -> Optional[str]:
    """Extract job title from text."""
    # Look for common patterns
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    
    for line in lines[:10]:
        if re.search(r"(job\s+title|position|role)", line, re.IGNORECASE):
            match = re.search(r":\s*(.+?)(?:\n|$)", line)
            if match:
                return match.group(1).strip()
    
    # Use first meaningful line
    if lines:
        return lines[0][:100]
    
    return None


def _extract_company(text: str) -> Optional[str]:
    """Extract company name from text."""
    # Look for common patterns
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    
    for line in lines[:15]:
        if re.search(r"(company|organization|employer)", line, re.IGNORECASE):
            match = re.search(r":\s*(.+?)(?:\n|$)", line)
            if match:
                return match.group(1).strip()
    
    return None


def _extract_skills(text: str) -> List[str]:
    """Extract required skills from text."""
    common_skills = {
        "python", "java", "javascript", "typescript", "csharp", "c#", "c++",
        "react", "angular", "vue", "nodejs", "node.js", "express",
        "django", "flask", "fastapi", "spring", "spring boot",
        "sql", "mysql", "postgresql", "mongodb", "redis",
        "docker", "kubernetes", "aws", "azure", "gcp",
        "git", "ci/cd", "jenkins", "gitlab", "github",
        "html", "css", "sass", "webpack",
        "rest", "graphql", "soap",
        "tensorflow", "pytorch", "scikit-learn", "pandas", "numpy",
        "agile", "scrum", "jira",
    }
    
    text_lower = text.lower()
    found_skills = set()
    
    for skill in common_skills:
        if re.search(rf"\b{re.escape(skill)}\b", text_lower):
            found_skills.add(skill)
    
    return sorted(list(found_skills))


def _extract_experience_years(text: str) -> Optional[int]:
    """Extract required years of experience from text."""
    # Look for patterns like "5 years", "5+ years", "5-7 years"
    match = re.search(r"(\d+)\s*\+?\s*(?:-\s*\d+)?\s*years?", text, re.IGNORECASE)
    if match:
        return int(match.group(1))
    
    return None
