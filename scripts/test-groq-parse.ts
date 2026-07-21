import OpenAI from 'openai'
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

async function test() {
  const c = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  const prompt = `Parse this resume into JSON. Return ONLY valid JSON:
John Doe
Software Engineer at Google
Skills: JavaScript, Python, React
Education: B.Tech Computer Science, IIT Delhi, 2020`
  try {
    const r = await c.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })
    console.log('Groq parse OK:', r.choices[0]?.message?.content?.slice(0, 200))
  } catch (err: any) {
    console.error('Groq parse error:', err.status, err.message?.slice(0, 100))
  }
}
test()
