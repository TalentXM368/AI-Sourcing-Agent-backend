# Scoring System Documentation

## Overview

The AI Sourcing Agent uses a multi-layered scoring pipeline to rank candidates against job descriptions. Scores are computed at ingest time (when resumes are uploaded) and cached in the `ranked_candidates` table.

---

## Score Components

### 1. Semantic Score (Embeddings)

**What:** Cosine similarity between candidate and job embeddings.
**Range:** 0–100

| Step | Detail |
|------|--------|
| Model | `text-embedding-3-small` (OpenAI) |
| Fallback | Hash-based 384-dim vector (deterministic, not semantic) |
| Storage | PostgreSQL `embeddings` table (vector column) |
| Purpose | Only `full_text` embeddings are used for scoring |
| Formula | `cosineSimilarity(jobVector, candVector) * 100` |

Each candidate/job gets 3 embeddings at creation time:
- `full_text` — full resume/JD text (used for scoring)
- `skills` — just the skills text
- `role` — just the job title

**Note:** Pinecone is defined in `services/pinecone.ts` but NOT used by the Node.js scoring pipeline. All cosine similarity is computed in-memory from PostgreSQL-stored vectors.

---

### 2. Skill Score

**What:** How well candidate skills match JD required skills.
**Range:** 3–98 (band-mapped)

| Match Type | Weight | Example |
|------------|--------|---------|
| Exact | 1.0 | JD says "Python", candidate has "Python" |
| Semantic/Related | 0.6 | JD says "ML", candidate has "Machine Learning" (via relationship graph) |
| Missing | 0 | JD says "Kubernetes", candidate doesn't have it |

**Scoring formula:**
```
exactScore = exactMatches / totalRequiredSkills
semanticScore = (exactMatches + semanticMatches) / totalRequiredSkills
combined = 0.75 * exactScore + 0.25 * semanticScore
```

**Band mapping (sharpens distribution):**

| Condition | Output Score |
|-----------|-------------|
| 100% exact match | 98 |
| ≥80% exact | 88 |
| ≥60% exact | 72 |
| ≥60% semantic | 50 |
| combined > 0 | `max(12, combined * 60)` |
| No JD skills | 50 |

**Skill relationship graph:** 25 groups defined (e.g., `react → {javascript, typescript, next.js, vue, angular}`).

---

### 3. Experience Score

**What:** How close candidate's years of experience match the job's max.
**Range:** 35–96

```
diff = |candidateExp - jobExpMax|

diff ≤ 1  → 96
diff ≤ 2  → 90
diff ≤ 3  → 82
diff ≤ 5  → 68
diff ≤ 7  → 55
else      → max(35, 100 - diff * 6)
```

Returns 50 if either value is missing.

---

### 4. Education Score

**What:** Binary presence check.
**Range:** 50–85

| Condition | Score |
|-----------|-------|
| Has education entries | 85 |
| No education | 50 |

No degree-level matching, no field-of-study matching.

---

### 5. Client Fit Score

**What:** How well the candidate matches client-specific preferences.
**Range:** 0–100
**Only computed when client context exists.**

| Component | Weight | Logic |
|-----------|--------|-------|
| Must-have skills match | 55% | Ratio of must-have keywords found in candidate |
| Tech stack overlap | 25% | Ratio of tech stack items found |
| Tenure fit | 20% | How close candidate's avg tenure is to client's historical avg |
| Nice-to-have bonus | +15% | Ratio of nice-to-have matches (additive) |
| Avoid penalty | -15% each | Each avoid keyword found penalizes 15% |

**Final formula:**
```
fit = mustScore * 0.55 + stackScore * 0.25 + tenureFit * 0.20 + niceBonus
fit -= 0.15 * avoidHits.length
fit = max(0, min(1, fit))
return fit * 100
```

**Client fit penalty:** If `clientFit < 40`, total_score is multiplied by 0.85.

---

### 6. ATS Score

**What:** Applicant Tracking System compatibility check.
**Range:** 0–100
**Computed and stored, but NOT used in total_score weighting.**

| Component | Weight | What It Checks |
|-----------|--------|----------------|
| Keyword density | 30% | JD tokens found in candidate summary |
| Required skills | 25% | JD required skills vs candidate skills (exact + fuzzy) |
| Experience range | 15% | Candidate YOE within [min, max] range |
| Contact completeness | 10% | Email, phone, LinkedIn, GitHub (0–4 fields) |
| Section structure | 10% | Work history, education, skills arrays populated |
| Recency | 5% | How recent the last job is |
| Education presence | 5% | Binary: has education? |

**Keyword matching algorithm:**
1. Exact token match
2. Multi-word: all words present in token set
3. Fuzzy: prefix match
4. Raw text substring (last resort)

---

### 7. LLM Score

**What:** AI-powered holistic evaluation.
**Range:** 0–100
**Evaluated per candidate-job pair.**

| Provider | Model | Status |
|----------|-------|--------|
| Pollinations (primary) | openai | ✅ Free |
| Groq (fallback) | llama-3.3-70b-versatile | ✅ Rate-limited |

**Prompt evaluates 7 dimensions:**
1. Skills match
2. Experience level
3. Domain relevance
4. Career trajectory
5. Education relevance
6. Location fit
7. Red flags (gaps, job hopping, mismatched seniority)

**Returns:**
```json
{
  "score": 0-100,
  "verdict": "one short sentence",
  "reasoning": "2-4 sentences"
}
```

**Rate limiting:** Minimum 5s between LLM calls.

---

### 8. Data Quality Score

**What:** Per-candidate completeness check (stored on candidate, not per-job).
**Range:** 0–100

| Field | Points | Pass Criteria |
|-------|--------|---------------|
| name | 5 | Length 2–60, has letters, not "unknown"/"n/a"/"test" |
| email | 10 | Present, length > 5 |
| phone | 10 | Present, length ≥ 7 |
| linkedin_url | 10 | Present, length > 10 |
| headline | 10 | Present, length > 3 |
| location | 5 | Present, length > 2 |
| summary | 10 | Present, length > 20 |
| skills | 10 | Array with ≥ 3 items |
| work_history | 15 | Array with ≥ 1 entry (non-"Unknown" title + company) |
| education | 10 | Array with ≥ 1 entry (school length > 3, not "Unknown") |
| resume_url | 5 | Present, length > 10 |

---

## Total Score Formula

The `total_score` is a weighted composite. **8 different formulas** are used depending on which data is available:

### Without Client Context

| Available Data | Formula |
|---------------|---------|
| Semantic + LLM | `semantic×0.25 + skill×0.25 + experience×0.10 + llm×0.40` |
| Semantic only | `semantic×0.45 + skill×0.40 + experience×0.15` |
| LLM only | `skill×0.40 + experience×0.15 + llm×0.45` |
| Neither | `skill×0.60 + experience×0.25 + education×0.15` |

### With Client Context

| Available Data | Formula |
|---------------|---------|
| Semantic + LLM | `semantic×0.20 + skill×0.20 + exp×0.10 + edu×0.05 + clientFit×0.10 + llm×0.35` |
| Semantic only | `semantic×0.30 + skill×0.30 + exp×0.15 + edu×0.10 + clientFit×0.15` |
| LLM only | `skill×0.30 + exp×0.15 + edu×0.10 + clientFit×0.10 + llm×0.35` |
| Neither | `skill×0.45 + exp×0.20 + edu×0.15 + clientFit×0.20` |

**Final clamp:** `Math.round(Math.min(100, Math.max(0, total)))`

---

## Scoring Pipeline

```
Resume Uploaded / Synced from Cloudinary
  │
  ▼
AI Parse (LLM-first, regex fallback if weak)
  │
  ▼
Generate 3 Embeddings (full_text, skills, role)
  │  Model: text-embedding-3-small
  │  Store in PostgreSQL `embeddings` table
  ▼
matchCandidateToAllJobs()
  │
  ├── Phase 1 (instant, all jobs):
  │     For each (candidate, job) pair:
  │     1. Semantic Score  = cosine_similarity × 100
  │     2. Skill Score     = computeSkillScore()
  │     3. Experience Score = computeExperienceScore()
  │     4. Education Score = computeEducationScore()
  │     5. Client Fit      = computeClientFitScore() [if client exists]
  │     6. ATS Score       = computeAtsScore() [stored, NOT in total]
  │     7. total_score     = weighted sum (one of 8 formulas)
  │     Store in `ranked_candidates`
  │
  └── Phase 2 (background, per job):
        8. LLM Score = evaluateCandidateWithLLM()
           Re-runs scoreCandidateForJob() with useLLM=true
           Replaces total_score with LLM-inclusive formula
```

---

## Ranked Candidates Table

| Column | Type | Description |
|--------|------|-------------|
| semantic_score | Float | Cosine similarity × 100 |
| skill_score | Float | Skill match score |
| experience_score | Float | Experience match score |
| education_score | Float | Education presence score |
| client_fit_score | Float | Client preference fit (default 50) |
| total_score | Float | Weighted composite (sorted DESC) |
| exact_skills | String[] | Skills with exact match |
| semantic_skills | String[] | Skills with related match |
| missing_skills | String[] | Required skills not found |
| llm_score | Float | LLM evaluation score (0 if unevaluated) |
| llm_verdict | String | LLM one-sentence verdict |
| llm_reasoning | String | LLM detailed reasoning |
| ats_score | Int | ATS compatibility (not in total) |
| decision | String | "pending" / "accepted" / "rejected" |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /jobs/:id/ranked` | GET | Ranked candidates (ordered by total_score DESC) |
| `POST /jobs/:id/score` | POST | Manual re-scoring trigger |
| `POST /jobs/:id/decisions` | POST | Accept/reject a candidate |
| `POST /upload/reparse/:id` | POST | Re-parse + re-score single candidate |
| `POST /upload/reparse-all` | POST | Bulk re-parse + re-score |
| `POST /upload/reparse-groq` | POST | Re-parse with Groq only |
