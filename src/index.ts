import { config } from 'dotenv'
import { resolve } from 'path'
import { checkDatabaseConnection } from './db/index.js'
import app from './app.js'

config({ path: resolve(__dirname, '../.env') })

const PORT = process.env.PORT || 3001

async function start() {
  const dbConnected = await checkDatabaseConnection()
  if (!dbConnected) {
    console.error('Failed to connect to database. Exiting.')
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Database: connected`)
  })
}

start()
