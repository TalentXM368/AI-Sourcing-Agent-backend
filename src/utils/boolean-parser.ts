// ─── Boolean Query Parser ──────────────────────────────────
// Supports: OR, AND, NOT operators in search queries
// Example: "python OR javascript" → { or: ["python", "javascript"] }
// Example: "python developer NOT junior" → { and: ["python developer"], not: ["junior"] }
// Example: "react AND typescript OR vue" → { or: ["react AND typescript", "vue"] }

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
  let operator: 'or' | 'and' = 'or'

  let i = 0
  let pendingNot = false
  let pendingAnd = false

  while (i < tokens.length) {
    const token = tokens[i]
    const upper = token.toUpperCase()

    if (upper === 'OR') {
      operator = 'or'
      i++
      continue
    }

    if (upper === 'AND') {
      operator = 'and'
      pendingAnd = true
      i++
      continue
    }

    if (upper === 'NOT') {
      pendingNot = true
      i++
      continue
    }

    if (pendingNot) {
      excluded.push(token)
      pendingNot = false
    } else if (pendingAnd) {
      included.push(token)
      pendingAnd = false
    } else {
      included.push(token)
    }
    i++
  }

  // Merge adjacent non-operator tokens into single terms
  // "python developer" stays as one term if not separated by operators
  if (included.length > 0 && operator === 'and' && tokens.every(t => t.toUpperCase() !== 'OR')) {
    return { terms: [included.join(' ')], operator: 'and', excluded }
  }

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
