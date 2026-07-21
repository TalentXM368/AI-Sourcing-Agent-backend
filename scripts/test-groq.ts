import OpenAI from 'openai'
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

async function test() {
  const c = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  const r = await c.chat.completions.create({ model: 'llama-3.3-70b-versatile', temperature: 0.1, max_tokens: 50, messages: [{ role: 'user', content: 'Say OK' }] })
  console.log('Groq:', r.choices[0]?.message?.content)
}
test().catch(console.error)
