# Client Data Directory

This directory is used for uploading and managing client-specific data for the AI Sourcing Agent.

## Overview

The client context integration system uses this folder to:
- Store custom client JSON context files
- Load example client profiles
- Accept client profile documents (PDFs, TXT files, etc.)

Simply place files directly in this folder - no subdirectories needed (similar to `jd/` and `resumes/` folders).

## File Types

- **JSON files** (`.json`): Client context profiles with hiring preferences, culture, industry info
- **Document files** (`.pdf`, `.txt`, `.doc`): Client company handbooks, culture guides, hiring documents
- **Example files**: Sample client contexts for reference

## Loading Client Data

### Option 1: Automatic Zoho CRM Integration (Recommended)

If your organization uses Zoho CRM, configure the following environment variables:

```bash
# .env or system environment
ZOHO_API_TOKEN=your_zoho_api_token_here
ZOHO_ORG_ID=your_zoho_org_id_here
```

Then initialize the pipeline with Zoho integration:

```python
from backend.pipeline import VectorPipeline

pipeline = VectorPipeline(
    pinecone_api_key="your_key",
    zoho_client_id="zoho_account_id",  # Zoho CRM Account ID
    use_client_fit_scoring=True,
)

# The pipeline will automatically fetch client context from Zoho
matches = pipeline.run_complete_pipeline(...)
```

### Option 2: Manual Client Context File

Create a JSON file with client context structure and place it directly in this folder:

```json
{
  "client_name": "Acme Corp",
  "client_id": "acme_corp_001",
  "culture": {
    "type": ["startup"],
    "work_style": ["fast-paced", "collaborative"],
    "company_size": "early-stage",
    "industry": "FinTech"
  },
  "hiring_preferences": {
    "preferred_background": ["startup", "scale-up"],
    "experience_level": "mid-to-senior",
    "remote_policy": "hybrid"
  },
  "role_context": {
    "industry": "FinTech",
    "domain_keywords": ["payments", "blockchain"],
    "tech_stack": ["Python", "React", "PostgreSQL"],
    "team_size": 15,
    "hiring_manager": "John Doe"
  },
  "urgency": {
    "level": "high",
    "open_positions": 3,
    "target_start_date": "2024-06-01"
  },
  "historical_patterns": {
    "avg_experience": 5,
    "common_skills": ["Python", "React", "PostgreSQL", "Docker"],
    "typical_education": "Bachelor's in CS",
    "past_hire_background": ["startup", "scale-up"],
    "successful_candidate_traits": ["Adaptable", "Problem-solver", "Self-motivated"]
  }
}
```

Load it in your code:

```python
import json
from backend.pipeline import VectorPipeline

with open("backend/client_data/custom_contexts/acme_corp.json") as f:
    client_context = json.load(f)

pipeline = VectorPipeline(
    pinecone_api_key="your_key",
    client_context=client_context,  # Pass the loaded context
    use_client_fit_scoring=True,
)
```

### Option 3: Load from File

Simply place JSON files directly in this folder and reference them:

```python
import json
from pathlib import Path

# Load any JSON file from client_data folder
context_file = Path("backend/client_data/acme_corp.json")
with open(context_file) as f:
    client_context = json.load(f)

pipeline = VectorPipeline(
    pinecone_api_key="your_key",
    client_context=client_context,
    use_client_fit_scoring=True,
)
```

## Quick Start

1. **View examples**: Check `fintech_startup.json`, `enterprise_tech.json`, or `ai_scaleup.json` in this folder
2. **Create your own**: Copy an example and customize for your client
3. **Place file here**: Drop JSON files directly in this folder (no subdirectories)
4. **Use in pipeline**: Load via `json.load()` and pass to `VectorPipeline`

## Client Context Schema

### Top-level Fields

| Field | Type | Description |
|-------|------|-------------|
| `client_name` | string | Client/company name |
| `client_id` | string | Unique identifier for the client |
| `culture` | object | Company culture characteristics |
| `hiring_preferences` | object | Client's hiring preferences |
| `role_context` | object | Role and technical context |
| `urgency` | object | Hiring urgency and timeline |
| `historical_patterns` | object | Historical hiring patterns |
| `source` | string | Source of context data (zoho_crm, custom, manual) |

### Culture Object

```json
{
  "type": ["startup|scale_up|enterprise"],  // Company type(s)
  "work_style": ["fast-paced", "collaborative", ...],
  "company_size": "number-range or description",
  "industry": "industry name"
}
```

### Hiring Preferences Object

```json
{
  "preferred_background": ["startup", "enterprise", "scale-up"],
  "experience_level": "junior|junior-to-mid|mid|mid-to-senior|senior",
  "remote_policy": "remote|hybrid|onsite"
}
```

### Role Context Object

```json
{
  "industry": "industry name",
  "domain_keywords": ["keyword1", "keyword2"],
  "tech_stack": ["Tech1", "Tech2"],
  "team_size": 5,
  "hiring_manager": "Manager Name"
}
```

### Urgency Object

```json
{
  "level": "high|medium|low",
  "open_positions": 2,
  "target_start_date": "YYYY-MM-DD"
}
```

### Historical Patterns Object

```json
{
  "avg_experience": 5,  // Years
  "common_skills": ["Skill1", "Skill2"],
  "typical_education": "Education Level",
  "past_hire_background": ["startup", "enterprise"],
  "successful_candidate_traits": ["Trait1", "Trait2"]
}
```

## Supported File Formats

- **JSON** (`.json`) - Structured client context (recommended)
- **PDF** (`.pdf`) - Client documents
- **Text** (`.txt`) - Client documents

## Environment Variables

```bash
# Zoho CRM Integration
ZOHO_API_TOKEN=your_bearer_token
ZOHO_ORG_ID=your_org_id

# Optional: Customize client fit scoring
CLIENT_FIT_PENALTY_THRESHOLD=40  # Default
CLIENT_FIT_PENALTY_MULTIPLIER=0.85  # Default
```

## Client Fit Scoring

When client context is provided, the pipeline computes a **Client Fit Score** (0-100) for each candidate based on:

1. **Background Fit (30%)** - Does candidate's background match client culture?
2. **Industry Fit (25%)** - Does candidate have relevant industry experience?
3. **Skill Fit (30%)** - How well do candidate skills match historical patterns?
4. **Experience Fit (15%)** - Does experience level align with client expectations?

### Example Output

```json
{
  "resume_idx": 0,
  "score": 75.5,
  "client_fit_score": 82.0,
  "client_fit_explanation": {
    "score": 82.0,
    "reason": "Excellent fit for Acme Corp's culture and requirements",
    "components": {
      "background_fit": { "score": 90.0, "details": "..." },
      "industry_fit": { "score": 75.0, "details": "..." },
      "skill_fit": { "score": 85.0, "details": "..." },
      "experience_fit": { "score": 78.0, "details": "..." }
    }
  }
}
```

## Best Practices

1. **Keep contexts up-to-date** - Update client context when hiring preferences change
2. **Use consistent skill names** - Match skill naming across different clients
3. **Provide historical data** - Include `common_skills` and `historical_patterns` for better scoring
4. **Test with small batches** - Validate context accuracy with sample resumes before full runs
5. **Monitor penalty applications** - Review which candidates trigger penalties to refine thresholds

## Troubleshooting

### Client context not being used

- Verify `use_client_fit_scoring=True` in pipeline initialization
- Check that client context dict is not None/empty
- Verify `ClientFitScorer` module is available

### Zoho integration not working

- Verify `ZOHO_API_TOKEN` and `ZOHO_ORG_ID` are set correctly
- Test Zoho API credentials independently
- Check logs for Zoho API errors
- Ensure client ID exists in Zoho CRM

### Unexpected penalties applied

- Review `apply_client_penalty()` threshold (default: 40.0)
- Check client fit score breakdown to identify low-scoring components
- Adjust client context to be more inclusive if needed

## Support

For issues or questions about client context integration:
1. Review the client context schema
2. Check example JSON files in `examples/`
3. Consult the main AI Sourcing Agent documentation
