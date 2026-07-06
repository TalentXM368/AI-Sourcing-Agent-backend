"""FastAPI server for AI Sourcing Agent.

Connects the frontend to the backend parsing and matching pipeline.
Run with: uvicorn backend.server:app --reload --port 8000
"""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.main import (
    LLMConfig,
    OpenAIResumeParser,
    RuleBasedResumeParser,
    ResumeTextExtractor,
    discover_resume_files,
    parse_single_file,
)
from backend.main import VectorPipeline as VectorPipelineCls
from backend.parsers.bulk_jd_parser import extract_text_from_file as extract_jd_text
from backend.parsers.bulk_jd_parser import parse_jd as parse_jd_file

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Load .env so API keys are available
from backend.main import load_env_file
load_env_file(Path(__file__).resolve().with_name(".env"))

app = FastAPI(title="AI Sourcing Agent API", version="1.0.0")

@app.on_event("startup")
async def preload_local_data():
    """Auto-load resumes, JDs and client data from backend folders on startup."""
    try:
        from backend.main import (
            RuleBasedResumeParser, OpenAIResumeParser, LLMConfig,
            discover_resume_files, parse_single_file, ResumeTextExtractor,
            load_client_context,
        )
        from backend.parsers.bulk_jd_parser import extract_text_from_file as extract_jd_text
        from backend.parsers.bulk_jd_parser import parse_jd as parse_jd_file

        loaded = {"resumes": 0, "jds": 0, "client_data": False}

        # Load resumes
        resume_dir = Path(__file__).resolve().parent / "resumes"
        if resume_dir.exists():
            local_parser = RuleBasedResumeParser()
            llm_parser = None
            api_key = os.getenv("LLM_API_KEY")
            if api_key:
                try:
                    llm_parser = OpenAIResumeParser(LLMConfig(api_key=api_key))
                except Exception:
                    pass
            for f in discover_resume_files(resume_dir):
                try:
                    parsed = parse_single_file(f, local_parser, llm_parser)
                    if parsed["status"] == "success":
                        data = dict(parsed["data"])
                        data["_source_file"] = f.name
                        data["id"] = _make_candidate_id()
                        data["created_at"] = ""
                        store["candidates"].append(data)
                        loaded["resumes"] += 1
                except Exception as exc:
                    logger.warning("Auto-load: failed to parse %s: %s", f.name, exc)

        # Load JDs
        jd_dir = Path(__file__).resolve().parent / "jd"
        if jd_dir.exists():
            for f in sorted(jd_dir.iterdir()):
                if f.is_file() and f.suffix.lower() in (".pdf", ".docx", ".txt", ".html", ".htm", ".rtf", ".odt", ".md"):
                    try:
                        text = extract_jd_text(f)
                        if text.strip():
                            parsed = parse_jd_file(f)
                            title = parsed.get("title") or parsed.get("role") or f.stem
                            job = {
                                "id": _make_job_id(),
                                "title": title,
                                "role": title,
                                "company": parsed.get("company"),
                                "location": parsed.get("location"),
                                "required_skills": parsed.get("required_skills", parsed.get("skills", [])),
                                "skills": parsed.get("required_skills", parsed.get("skills", [])),
                                "experience_min": parsed.get("experience_min"),
                                "experience_max": parsed.get("experience_max"),
                                "description": parsed.get("description") or parsed.get("raw_text", ""),
                                "raw_text": parsed.get("raw_text", ""),
                                "status": "open",
                                "created_at": "",
                                "_source_file": f.name,
                            }
                            store["jobs"].append(job)
                            store["decisions"][job["id"]] = {}
                            loaded["jds"] += 1
                    except Exception as exc:
                        logger.warning("Auto-load: failed to parse JD %s: %s", f.name, exc)

        # Load client data
        client_dir = Path(__file__).resolve().parent / "client_data"
        if client_dir.exists():
            bundle = load_client_context(client_dir)
            loaded["client_data"] = bundle is not None

        if loaded["resumes"] or loaded["jds"] or loaded["client_data"]:
            logger.info("Auto-loaded: %d resumes, %d JDs, client_data=%s",
                        loaded["resumes"], loaded["jds"], loaded["client_data"])
        _precompute_all_rankings()
    except Exception as exc:
        logger.warning("Auto-load skipped: %s", exc)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory data store
# ---------------------------------------------------------------------------

store: dict = {
    "candidates": [],
    "jobs": [],
    "decisions": {},
    "next_candidate_id": 1,
    "next_job_id": 1,
    "ranked_candidates": {},  # job_id -> list[RankedCandidate] (pre-computed)
}

def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"

def _make_candidate_id() -> str:
    idx = store["next_candidate_id"]
    store["next_candidate_id"] = idx + 1
    return f"c_{uuid.uuid4().hex[:8]}"

def _make_job_id() -> str:
    idx = store["next_job_id"]
    store["next_job_id"] = idx + 1
    return f"job_{uuid.uuid4().hex[:8]}"

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class JobInput(BaseModel):
    role: str
    company: Optional[str] = None
    location: Optional[str] = None
    required_skills: List[str]
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    description: Optional[str] = None

class DecisionInput(BaseModel):
    candidate_id: str
    decision: str  # "accepted" | "rejected"

class UploadResult(BaseModel):
    uploaded: int
    failed: int
    errors: List[str]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_llm_parser() -> Optional[OpenAIResumeParser]:
    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        return None
    api_base = os.getenv("LLM_API_BASE")
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    try:
        return OpenAIResumeParser(LLMConfig(api_key=api_key, model=model, api_base=api_base))
    except Exception as exc:
        logger.warning("LLM parser init failed: %s", exc)
        return None

def _candidate_to_frontend(c: dict) -> dict:
    skills = [{"name": s} for s in (c.get("skills") or [])]
    companies_raw = c.get("companies") or []
    if isinstance(companies_raw, list):
        companies = [{"name": co} if isinstance(co, str) else co for co in companies_raw]
    else:
        companies = []
    edu_raw = c.get("education")
    education = []
    if edu_raw:
        if isinstance(edu_raw, str):
            education = [{"school": edu_raw}]
        elif isinstance(edu_raw, list):
            education = [{"school": e} if isinstance(e, str) else e for e in edu_raw]
        elif isinstance(edu_raw, dict):
            education = [edu_raw]
    return {
        "id": c["id"],
        "name": c.get("full_name") or c.get("name") or "Unknown",
        "email": c.get("email"),
        "headline": c.get("current_role") or c.get("headline"),
        "experience_years": c.get("total_experience_years") or c.get("experience_years") or 0,
        "skills": skills,
        "companies": companies,
        "education": education,
        "resume_path": c.get("resume_path"),
        "created_at": c.get("created_at", ""),
    }

def _job_to_frontend(j: dict) -> dict:
    return {
        "id": j["id"],
        "role": j.get("title") or j.get("role", ""),
        "company": j.get("company"),
        "location": j.get("location"),
        "required_skills": j.get("required_skills", j.get("skills", [])),
        "experience_min": j.get("experience_min"),
        "experience_max": j.get("experience_max"),
        "description": j.get("raw_text") or j.get("description"),
        "status": j.get("status", "open"),
        "created_at": j.get("created_at", ""),
        "rankings_ready": j["id"] in store.get("ranked_candidates", {}),
    }

def _build_pipeline_input(parsed_candidates: List[dict]) -> dict:
    results = []
    for c in parsed_candidates:
        data = dict(c)
        data.pop("id", None)
        data.pop("created_at", None)
        data.pop("resume_path", None)
        results.append({
            "status": "success",
            "source_file": data.pop("_source_file", "upload"),
            "data": data,
        })
    return {"results": results}

def _build_jd_pipeline_input(job: dict) -> dict:
    return {
        "results": [{
            "file_name": job.get("_source_file", "manual"),
            "title": job.get("title") or job.get("role", ""),
            "company": job.get("company"),
            "required_skills": job.get("required_skills", job.get("skills", [])),
            "required_experience_years": job.get("experience_min"),
            "raw_text": job.get("raw_text") or job.get("description", ""),
            "status": "success",
        }]
    }

def _pipeline_match_to_ranked(
    pipeline_match: dict,
    candidate_id: str,
    candidate_frontend: dict,
    job_id: str,
    decision: str,
    required_skills: Optional[List[str]] = None,
) -> dict:
    sb = pipeline_match.get("score_breakdown", {})
    score = {
        "similarity": max(0, min(1, (sb.get("semantic_retrieval_similarity", 0) or 0) / 100)),
        "skill_overlap": max(0, min(1, (sb.get("combined_skill_score", 0) or 0) / 100)),
        "experience_match": max(0, min(1, (sb.get("experience_match", 0) or 0) / 100)) if isinstance(sb.get("experience_match"), (int, float)) else 0.5,
        "total": max(0, min(1, (sb.get("overall_match_score", 0) or 0) / 100)),
    }

    missing_skills = pipeline_match.get("missing_skills", [])
    required_skills = required_skills or []

    fraud_flags = []
    if required_skills and len(missing_skills) > len(required_skills) * 0.7:
        fraud_flags.append({
            "code": "missing_skills",
            "severity": "low",
            "message": f"Missing {len(missing_skills)} required skills",
        })

    return {
        **candidate_frontend,
        "job_id": job_id,
        "decision": decision,
        "score": score,
        "fraud_flags": fraud_flags,
        "explanation": pipeline_match.get("llm_rerank_reason")
            or f"Score: {pipeline_match.get('score', 0)}% — "
               f"skills: {sb.get('combined_skill_score', 0)}%, "
               f"experience: {sb.get('experience_match', 'N/A')}",
    }

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/api/upload-resumes")
async def upload_resumes(files: List[UploadFile] = File(...)):
    local_parser = RuleBasedResumeParser()
    llm_parser = _build_llm_parser()
    uploaded_count = 0
    failed_count = 0
    errors = []

    for upload in files:
        try:
            content = await upload.read()
            suffix = Path(upload.filename or "file.txt").suffix.lower() or ".txt"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(content)
                tmp_path = Path(tmp.name)

            text = ResumeTextExtractor.extract_text(tmp_path)
            os.unlink(str(tmp_path))

            if not text.strip():
                failed_count += 1
                errors.append(f"{upload.filename}: empty file")
                continue

            parsed = local_parser.parse_resume(text)
            if llm_parser is not None:
                try:
                    llm_data = llm_parser.parse_resume(text)
                    from backend.main import merge_resume_records
                    parsed = merge_resume_records(parsed, llm_data)
                except Exception as exc:
                    logger.warning("LLM fallback failed for %s: %s", upload.filename, exc)

            parsed["_source_file"] = upload.filename or "upload"
            parsed["id"] = _make_candidate_id()
            parsed["created_at"] = ""
            store["candidates"].append(parsed)
            uploaded_count += 1

        except Exception as exc:
            failed_count += 1
            errors.append(f"{upload.filename}: {exc}")

    return {"uploaded": uploaded_count, "failed": failed_count, "errors": errors}

@app.get("/api/candidates")
async def list_candidates():
    return [_candidate_to_frontend(c) for c in store["candidates"]]

@app.post("/api/jobs")
async def create_job(data: JobInput):
    job = {
        "id": _make_job_id(),
        "title": data.role,
        "role": data.role,
        "company": data.company,
        "location": data.location,
        "required_skills": data.required_skills,
        "skills": data.required_skills,
        "experience_min": data.experience_min,
        "experience_max": data.experience_max,
        "description": data.description,
        "raw_text": data.description or "",
        "status": "open",
        "created_at": "",
        "_source_file": "manual",
    }
    store["jobs"].append(job)
    store["decisions"][job["id"]] = {}
    return _job_to_frontend(job)

@app.get("/api/jobs")
async def list_jobs():
    result = []
    for j in store["jobs"]:
        jf = _job_to_frontend(j)
        jid = j["id"]
        candidate_count = 0
        if store["candidates"]:
            try:
                decision_count = len(store["decisions"].get(jid, {}))
                candidate_count = max(len(store["candidates"]) // 2, decision_count)
            except Exception:
                candidate_count = 0
        jf["candidate_count"] = candidate_count
        result.append(jf)
    return result

@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    for j in store["jobs"]:
        if j["id"] == job_id:
            return _job_to_frontend(j)
    raise HTTPException(status_code=404, detail="Job not found")

def _run_pipeline_for_job(job: dict) -> list:
    """Run the full matching pipeline for one job against all candidates.
    Returns raw pipeline matches list or empty list on failure.
    """
    if not store["candidates"]:
        return []

    pinecone_api_key = os.getenv("PINECONE_API_KEY", "")
    try:
        pipeline = VectorPipelineCls(
            pinecone_api_key=pinecone_api_key,
            cloud=os.getenv("PINECONE_CLOUD", "aws"),
            region=os.getenv("PINECONE_REGION", "us-east-1"),
            use_reranking=bool(os.getenv("LLM_API_KEY")),
            scoring_mode="hybrid",
        )
        from backend.pipeline.embeddings import EmbeddingModel
        pipeline.embedding_model = EmbeddingModel(backend="hash")

        resume_input = _build_pipeline_input(store["candidates"])
        jd_input = _build_jd_pipeline_input(job)

        with tempfile.TemporaryDirectory() as tmpdir:
            resume_file = Path(tmpdir) / "resumes.json"
            jd_file = Path(tmpdir) / "jds.json"
            output_file = Path(tmpdir) / "output.json"
            resume_file.write_text(json.dumps(resume_input), encoding="utf-8")
            jd_file.write_text(json.dumps(jd_input), encoding="utf-8")
            success = pipeline.run_complete_pipeline(
                resume_file=str(resume_file),
                jd_file=str(jd_file),
                output_file=str(output_file),
                top_k=max(50, len(store["candidates"])),
            )
            if success and output_file.exists():
                raw_output = json.loads(output_file.read_text(encoding="utf-8"))
                return raw_output.get("matches", [])
    except Exception as exc:
        logger.error("Matching pipeline failed: %s", exc)
    return []


def _format_ranked_candidates(job: dict, matches: list) -> list:
    """Convert raw pipeline matches into frontend-ranked candidate list."""
    job_id = job["id"]
    decisions_map = store["decisions"].get(job_id, {})
    ranked = []
    seen_ids = set()
    for jd_match in matches:
        for pm in jd_match.get("top_matches", []):
            candidate_obj = None
            if pm.get("resume_idx") is not None and pm["resume_idx"] < len(store["candidates"]):
                candidate_obj = store["candidates"][pm["resume_idx"]]
            if not candidate_obj:
                for c in store["candidates"]:
                    if c.get("full_name") == pm.get("resume_name"):
                        candidate_obj = c
                        break
            if not candidate_obj:
                continue
            cid = candidate_obj["id"]
            if cid in seen_ids:
                continue
            seen_ids.add(cid)
            cf = _candidate_to_frontend(candidate_obj)
            decision = decisions_map.get(cid, "pending")
            ranked.append(_pipeline_match_to_ranked(pm, cid, cf, job_id, decision, job.get("required_skills", job.get("skills", []))))
    ranked.sort(key=lambda r: r["score"]["total"], reverse=True)
    return ranked


def _precompute_all_rankings():
    """Run matching pipeline for every job and cache results."""
    if not store["candidates"] or not store["jobs"]:
        logger.info("Pre-compute: no candidates or jobs to rank")
        return
    logger.info("Pre-computing rankings for %d jobs against %d candidates…", len(store["jobs"]), len(store["candidates"]))
    for job in store["jobs"]:
        jid = job["id"]
        raw = _run_pipeline_for_job(job)
        store["ranked_candidates"][jid] = _format_ranked_candidates(job, raw)
        logger.info("Pre-computed: job %s (%s) — %d candidates ranked", jid, job.get("title"), len(store["ranked_candidates"][jid]))
    logger.info("Pre-compute finished for %d jobs", len(store["jobs"]))


@app.post("/api/jobs/{job_id}/match")
async def match_candidates(job_id: str):
    job = None
    for j in store["jobs"]:
        if j["id"] == job_id:
            job = j
            break

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job_id in store["ranked_candidates"]:
        logger.info("Serving cached rankings for job %s (%d candidates)", job_id, len(store["ranked_candidates"][job_id]))
        return {"candidates": store["ranked_candidates"][job_id]}

    logger.info("Cache miss for job %s, running pipeline…", job_id)
    raw = _run_pipeline_for_job(job)
    ranked = _format_ranked_candidates(job, raw)
    store["ranked_candidates"][job_id] = ranked
    return {"candidates": ranked}

@app.post("/api/jobs/{job_id}/decisions")
async def set_decision(job_id: str, data: DecisionInput):
    if job_id not in store["decisions"]:
        store["decisions"][job_id] = {}
    store["decisions"][job_id][data.candidate_id] = data.decision
    return {"success": True}

@app.post("/api/load-local")
async def load_local_data():
    from backend.main import (
        RuleBasedResumeParser,
        OpenAIResumeParser,
        LLMConfig,
        discover_resume_files,
        parse_single_file,
        ResumeTextExtractor,
        WORKSPACE_ROOT,
        DEFAULT_INPUT_DIR,
        DEFAULT_CLIENT_DATA_DIR,
        load_client_context,
    )
    from backend.parsers.bulk_jd_parser import extract_text_from_file as extract_jd_text
    from backend.parsers.bulk_jd_parser import parse_jd as parse_jd_file

    results = {"resumes": 0, "jds": 0, "client_data": False}

    # --- Load resumes ---
    resume_dir = Path(__file__).resolve().parent / "resumes"
    if resume_dir.exists():
        local_parser = RuleBasedResumeParser()
        llm_parser = None
        api_key = os.getenv("LLM_API_KEY")
        if api_key:
            try:
                llm_parser = OpenAIResumeParser(LLMConfig(api_key=api_key))
            except Exception:
                pass
        files = discover_resume_files(resume_dir)
        for f in files:
            try:
                parsed = parse_single_file(f, local_parser, llm_parser)
                if parsed["status"] == "success":
                    data = dict(parsed["data"])
                    data["_source_file"] = f.name
                    data["id"] = _make_candidate_id()
                    data["created_at"] = ""
                    store["candidates"].append(data)
                    results["resumes"] += 1
            except Exception as exc:
                logger.warning("Failed to parse %s: %s", f.name, exc)

    # --- Load JDs ---
    jd_dir = Path(__file__).resolve().parent / "jd"
    if jd_dir.exists():
        for f in sorted(jd_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in (".pdf", ".docx", ".txt", ".html", ".htm", ".rtf", ".odt", ".md"):
                try:
                    text = extract_jd_text(f)
                    if text.strip():
                        parsed = parse_jd_file(f)
                        title = parsed.get("title") or parsed.get("role") or f.stem
                        job = {
                            "id": _make_job_id(),
                            "title": title,
                            "role": title,
                            "company": parsed.get("company"),
                            "location": parsed.get("location"),
                            "required_skills": parsed.get("required_skills", parsed.get("skills", [])),
                            "skills": parsed.get("required_skills", parsed.get("skills", [])),
                            "experience_min": parsed.get("experience_min"),
                            "experience_max": parsed.get("experience_max"),
                            "description": parsed.get("description") or parsed.get("raw_text", ""),
                            "raw_text": parsed.get("raw_text", ""),
                            "status": "open",
                            "created_at": "",
                            "_source_file": f.name,
                        }
                        store["jobs"].append(job)
                        store["decisions"][job["id"]] = {}
                        results["jds"] += 1
                except Exception as exc:
                    logger.warning("Failed to parse JD %s: %s", f.name, exc)

    # --- Load client context ---
    client_dir = Path(__file__).resolve().parent / "client_data"
    if client_dir.exists():
        bundle = load_client_context(client_dir)
        results["client_data"] = bundle is not None

    # Pre-compute rankings so frontend gets instant results
    _precompute_all_rankings()

    return {
        "status": "ok",
        "loaded": results,
        "total_candidates": len(store["candidates"]),
        "total_jobs": len(store["jobs"]),
    }

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "candidates": len(store["candidates"]),
        "jobs": len(store["jobs"]),
        "rankings_ready": len(store["ranked_candidates"]),
        "rankings_total": len(store["jobs"]),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.server:app", host="0.0.0.0", port=8000, reload=True)
