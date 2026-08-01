import type { HealthCheckResult } from './database.check.js';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
];

const OPTIONAL_ENV_VARS = [
  'QDRANT_URL',
  'QDRANT_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'COHERE_API_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'PDL_API_KEY',
];

export function checkEnvironment(): HealthCheckResult {
  const start = performance.now();
  const missing: string[] = [];
  const present: string[] = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    if (process.env[envVar]) {
      present.push(envVar);
    } else {
      missing.push(envVar);
    }
  }

  const optionalPresent = OPTIONAL_ENV_VARS.filter(v => process.env[v]);
  const latencyMs = performance.now() - start;

  if (missing.length > 0) {
    return {
      name: 'environment',
      status: 'unhealthy',
      latencyMs,
      message: `Missing required env vars: ${missing.join(', ')}`,
      details: { missing, present, optionalPresent },
    };
  }

  return {
    name: 'environment',
    status: 'healthy',
    latencyMs,
    message: `All required env vars present (${present.length} required, ${optionalPresent.length} optional)`,
    details: { present, optionalPresent },
  };
}
