import { parseResumeRegex } from '../src/parsers/resume-parser.js'

const tests = [
  { input: 'B H A W A N A S H A R M A\nbhawanasharma01bs@gmail.com\nSenior Developer', expected: 'BHAWANASHARMA' },
  { input: 'Marco.pdf\nSenior SAP ABAP Developer', expected: 'Marco' },
  { input: 'CONTACT\nJohn Smith\njohn@gmail.com', expected: 'John Smith' },
  { input: 'Rahul Sharma\nrahul@gmail.com\nSenior Software Engineer', expected: 'Rahul Sharma' },
]

for (const t of tests) {
  const result = parseResumeRegex(t.input)
  const pass = result.name === t.expected
  console.log(`${pass ? 'PASS' : 'FAIL'}: "${result.name}" (expected "${t.expected}")`)
}
process.exit(0)
