import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'
import OpenAI from 'openai'

loadEnv({ path: resolve(__dirname, '../.env') })

async function main() {
  const key = process.env.OPENAI_API_KEY
  if (!key) { console.log('NO OPENAI KEY'); return }
  
  console.log('Key prefix:', key.substring(0, 12) + '...')
  
  const client = new OpenAI({ apiKey: key })
  
  // Test embeddings
  try {
    console.log('Testing embeddings...')
    const res = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'test embedding',
    })
    console.log('Embeddings WORK! Dimensions:', res.data[0].embedding.length)
  } catch (e: any) {
    console.log('Embeddings FAILED:', e.status, e.message?.substring(0, 200))
  }

  // Test chat completion
  try {
    console.log('Testing chat completion...')
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say hi in 3 words' }],
      max_tokens: 10,
    })
    console.log('Chat WORKS:', res.choices[0]?.message?.content)
  } catch (e: any) {
    console.log('Chat FAILED:', e.status, e.message?.substring(0, 200))
  }
}

main().catch(console.error)
