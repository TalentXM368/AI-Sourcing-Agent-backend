import OpenAI from 'openai'

export type Industry =
  | 'Technology'
  | 'Healthcare'
  | 'Finance'
  | 'Manufacturing'
  | 'E-commerce'
  | 'Education'
  | 'Other'

// Rule-based keyword weights
const INDUSTRY_KEYWORDS: Record<Industry, Record<string, number>> = {
  Technology: {
    python: 3, javascript: 3, typescript: 3, java: 2, 'c++': 2, 'c#': 2, go: 2, rust: 2, ruby: 2, php: 2, swift: 2, kotlin: 2,
    react: 3, angular: 3, vue: 3, 'next.js': 3, 'node.js': 3, express: 2, django: 2, flask: 2, spring: 2,
    'react native': 3, flutter: 3,
    aws: 3, azure: 3, gcp: 3, 'google cloud': 3,
    docker: 3, kubernetes: 3, k8s: 3, terraform: 3, ansible: 2, jenkins: 2, 'ci/cd': 3,
    'machine learning': 4, 'deep learning': 4, ai: 4, 'artificial intelligence': 4, nlp: 3,
    tensorflow: 4, pytorch: 4, pandas: 2, numpy: 2, scikit: 3, spark: 3, hadoop: 2, kafka: 3,
    'data science': 3, 'data engineering': 3, etl: 2, 'data pipeline': 2, dbt: 2, airflow: 2,
    postgresql: 2, mysql: 2, mongodb: 2, redis: 2, elasticsearch: 2, dynamodb: 2,
    'software engineer': 3, 'software developer': 3, 'full stack': 3, fullstack: 3, frontend: 2, backend: 2,
    saas: 3, api: 2, sdk: 2, git: 2, agile: 2, scrum: 2, microservices: 3, rest: 2, graphql: 3,
    'cloud architecture': 3, 'cloud native': 3, serverless: 3, lambda: 2,
    'system design': 3, 'system architecture': 3, scalability: 2,
    cybersecurity: 3, 'cyber security': 3, penetration: 2, oauth: 2, ssl: 2,
  },
  Healthcare: {
    hipaa: 5, 'patient data': 4, 'electronic health record': 5, ehr: 5, emr: 4,
    'clinical trial': 4, 'clinical data': 4, fda: 3, 'medical device': 4, 'medical imaging': 5,
    dicom: 4, hl7: 4, fhir: 5,
    biotech: 5, biotechnology: 5, pharma: 4, pharmaceutical: 4, genomics: 5, bioinformatics: 4,
    'drug discovery': 4, 'drug development': 4, 'clinical research': 4, pharmacovigilance: 4,
    'health tech': 5, 'healthcare technology': 5, telemedicine: 4, telehealth: 4,
    'life sciences': 4, 'molecular biology': 3, immunology: 3, crispr: 3, 'gene therapy': 3,
    diagnosis: 2, pathology: 3, radiology: 3, oncology: 3, 'public health': 3, epidemiology: 3,
  },
  Finance: {
    banking: 5, 'investment banking': 5, fintech: 5, insurance: 4, insurtech: 4,
    'wealth management': 4, 'asset management': 4, 'private equity': 4, 'venture capital': 4,
    trading: 4, 'algorithmic trading': 5, 'quantitative trading': 5, bloomberg: 4,
    'risk management': 5, compliance: 4, 'regulatory compliance': 4, sec: 3, sox: 3,
    aml: 4, kyc: 4,
    'payment processing': 4, 'payment gateway': 4, stripe: 3, 'digital payment': 3,
    accounting: 3, 'financial reporting': 4, gaap: 3, ifrs: 3, audit: 3,
    blockchain: 3, defi: 3, cryptocurrency: 3, 'smart contract': 3,
    'financial analysis': 4, 'financial modeling': 4, valuation: 3,
  },
  Manufacturing: {
    'six sigma': 5, 'lean manufacturing': 5, 'quality assurance': 4, iso: 4, 'iso 9001': 4,
    kaizen: 4, cad: 4, autocad: 3, solidworks: 4, catia: 3,
    'supply chain': 5, 'supply chain management': 5, scm: 4, logistics: 4, procurement: 4,
    erp: 4, sap: 3, inventory: 3, 'demand planning': 4,
    automotive: 4, aerospace: 4, semiconductor: 4, electronics: 3,
    automation: 3, plc: 3, scada: 3, robotics: 3, 'industrial automation': 4,
    osha: 3, 'workplace safety': 3, sustainability: 2,
  },
  'E-commerce': {
    shopify: 5, woocommerce: 4, magento: 4, bigcommerce: 4,
    'e-commerce': 5, ecommerce: 5, marketplace: 4, dtc: 4, 'direct to consumer': 4,
    'retail tech': 4, 'retail technology': 4,
    'payment processing': 3, checkout: 3, 'shopping cart': 3, stripe: 2, paypal: 2,
    fulfillment: 4, 'order management': 4, 'last mile': 3, 'drop shipping': 3,
    seo: 3, sem: 3, 'affiliate marketing': 3, conversion: 3, 'customer lifetime': 3,
    personalization: 3, 'product catalog': 3,
  },
  Education: {
    edtech: 5, 'e-learning': 5, elearning: 5, 'online learning': 4,
    lms: 5, 'learning management': 5, moodle: 3, canvas: 2,
    curriculum: 3, 'instructional design': 5, 'course design': 4, 'learning design': 4,
    'educational content': 4, assessment: 3, 'learning analytics': 4,
    'corporate training': 4, 'professional development': 3, 'talent development': 3,
    'higher education': 3, k12: 3, 'k-12': 3,
    'adaptive learning': 4, 'personalized learning': 4, 'micro learning': 3, gamification: 2,
  },
  Other: {
    management: 1, leadership: 1, strategy: 1, operations: 1, consulting: 1,
    marketing: 1, sales: 1, hr: 1, 'human resources': 1,
    recruiting: 1, 'talent acquisition': 1, 'project management': 1,
  },
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function classifyByRules(text: string): { industry: Industry; confidence: number } {
  const lower = text.toLowerCase()
  const scores: Record<Industry, number> = {
    Technology: 0, Healthcare: 0, Finance: 0,
    Manufacturing: 0, 'E-commerce': 0, Education: 0, Other: 0,
  }

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    for (const [keyword, weight] of Object.entries(keywords)) {
      const pattern = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i')
      if (pattern.test(lower)) {
        scores[industry as Industry] += weight
      }
    }
  }

  // Find top match
  let best: Industry = 'Other'
  let bestScore = 0
  for (const [industry, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score
      best = industry as Industry
    }
  }

  return { industry: best, confidence: Math.min(bestScore / 15, 1.0) }
}

const GROQ_CLIENT = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null

export async function classifyIndustry(
  text: string,
  skills: string[] = [],
  role?: string
): Promise<{ industry: Industry; confidence: number }> {
  // Try AI classification first
  if (GROQ_CLIENT) {
    try {
      const skillStr = skills.slice(0, 20).join(', ')
      const truncatedText = text.slice(0, 3000)
      const prompt = `Classify this candidate/job into ONE industry domain. Return ONLY valid JSON.

Text: ${truncatedText}
${role ? `Role: ${role}` : ''}
Skills: ${skillStr}

Return: { "industry": "<Technology|Healthcare|Finance|Manufacturing|E-commerce|Education|Other>" }`

      const response = await GROQ_CLIENT.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        max_tokens: 50,
        messages: [
          { role: 'system', content: 'You are an industry classifier. Return ONLY valid JSON with one field "industry".' },
          { role: 'user', content: prompt },
        ],
      })

      const content = response.choices[0]?.message?.content
      if (content) {
        let jsonStr = content.trim()
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
        const parsed = JSON.parse(jsonStr)
        const valid: Industry[] = ['Technology', 'Healthcare', 'Finance', 'Manufacturing', 'E-commerce', 'Education', 'Other']
        if (valid.includes(parsed.industry)) {
          return { industry: parsed.industry, confidence: 0.9 }
        }
      }
    } catch (err: any) {
      // Fall through to rules
      if (err?.status === 429) {
        console.warn('[Industry] Groq rate limited, using rules fallback')
      }
    }
  }

  // Fallback to rule-based classification
  const combined = `${text} ${role || ''} ${skills.join(' ')}`
  return classifyByRules(combined)
}
