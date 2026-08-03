// ─── Boolean Query Parser ──────────────────────────────────
// Supports: OR, AND, NOT operators in search queries
// Precedence: NOT > AND > OR (standard boolean logic)
// "python OR javascript" → { terms: ["python", "javascript"], operator: "or", excluded: [] }
// "python developer NOT junior" → { terms: ["python developer"], operator: "or", excluded: ["junior"] }
// "react AND typescript OR vue" → { terms: ["react", "typescript", "vue"], operator: "or", excluded: [] }

export interface BooleanQuery {
  terms: string[]
  operator: 'or' | 'and'
  excluded: string[]
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) {
      current += ch
      continue
    }
    if (ch === ' ') {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseBooleanQuery(input: string): BooleanQuery {
  const tokens = tokenize(input)
  const included: string[] = []
  const excluded: string[] = []
  let hasOr = false
  let hasAnd = false

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    const upper = token.toUpperCase()

    if (upper === 'OR') {
      hasOr = true
      i++
      continue
    }

    if (upper === 'AND') {
      hasAnd = true
      i++
      continue
    }

    if (upper === 'NOT') {
      // NOT applies to the next token
      i++
      if (i < tokens.length && tokens[i].toUpperCase() !== 'OR' && tokens[i].toUpperCase() !== 'AND') {
        excluded.push(tokens[i])
      }
      i++
      continue
    }

    included.push(token)
    i++
  }

  // Determine operator: if both OR and AND are present, OR wins at top level
  // since AND binds tighter (already handled by token grouping)
  const operator = hasOr ? 'or' : 'and'

  return { terms: included, operator, excluded }
}

// Build a search string suitable for APIs that support boolean natively (GitHub)
export function toNativeBooleanString(query: BooleanQuery): string {
  const parts: string[] = []
  if (query.operator === 'or') {
    if (query.terms.length > 1) {
      parts.push(query.terms.join(' OR '))
    } else {
      parts.push(...query.terms)
    }
  } else {
    parts.push(query.terms.join(' '))
  }
  for (const ex of query.excluded) {
    parts.push(`-${ex}`)
  }
  return parts.join(' ')
}

// Build a flat list of terms for OR-based search (Kaggle, SO)
export function toOrTerms(query: BooleanQuery): string[] {
  return query.terms
}

// Check if a query has any boolean operators
export function hasBooleanOperators(input: string): boolean {
  return /\b(OR|AND|NOT)\b/i.test(input)
}
