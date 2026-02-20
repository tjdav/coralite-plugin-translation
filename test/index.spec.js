import { test, after, before } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { Coralite } from 'coralite'
import { translation } from '../lib/index.js'

const tempDir = join(process.cwd(), 'temp-translation-test')
const pagesDir = join(tempDir, 'pages')
const templatesDir = join(tempDir, 'templates')
const cacheDir = join(tempDir, '.coralite/cache')

// Mock fetch
const originalFetch = global.fetch
let fetchCallCount = 0

before(async () => {
  await mkdir(pagesDir, { recursive: true })
  await mkdir(templatesDir, { recursive: true })

  await writeFile(join(pagesDir, 'index.html'), '<html><body><p>Hello World</p><img alt="An image" src="img.jpg"><input type="button" value="Submit"></body></html>')

  global.fetch = async (url, options) => {
    fetchCallCount++
    if (url.includes('api.openai.com')) {
      const body = JSON.parse(options.body)
      const content = body.messages[1].content // user message

      const parts = content.split('\n\n---\n\n')
      parts[0] = parts[0].split('\n').slice(1).join('\n')

      const translatedParts = parts.map(p => `Translated: ${p.trim()}`)
      const responseContent = translatedParts.join('---')

      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: responseContent
            }
          }]
        })
      }
    }
    return originalFetch(url, options)
  }
})

after(async () => {
  global.fetch = originalFetch
  await rm(tempDir, {
    recursive: true,
    force: true
  })
})

test('Translation plugin with fragment caching', async (t) => {
  const coralite = new Coralite({
    pages: pagesDir,
    templates: templatesDir,
    plugins: [
      translation({
        sourceLanguage: 'en',
        targetLanguages: ['en', 'fr'],
        api: { key: 'fake-key' },
        cacheDir: cacheDir,
        chunkSize: 5,
        attributes: { 'input[type=button]:value': true }
      })
    ]
  })

  await coralite.initialise()

  // First run
  fetchCallCount = 0
  let results = await coralite.build()

  assert.strictEqual(results.length, 2)
  const translated = results.find(r => r.path.pathname.endsWith('fr/index.html'))

  assert.match(translated.html, /Translated: Hello World/)
  assert.match(translated.html, /alt="Translated: An image"/)
  assert.match(translated.html, /value="Translated: Submit"/, 'Input value should be translated via selector')

  assert.ok(fetchCallCount > 0, 'Should call API on first run')
  const initialFetchCount = fetchCallCount

  // Check cache file
  const cacheContent = await readFile(join(cacheDir, 'i18n.json'), 'utf-8')
  const cache = JSON.parse(cacheContent)
  assert.ok(cache['Hello World'], 'Fragment should be cached')
  assert.strictEqual(cache['Hello World']['fr'], 'Translated: Hello World')

  // Second run - should use cache
  fetchCallCount = 0
  results = await coralite.build()

  assert.strictEqual(fetchCallCount, 0, 'Should NOT call API on second run (cached)')

  const translated2 = results.find(r => r.path.pathname.endsWith('fr/index.html'))
  assert.match(translated2.html, /Translated: Hello World/)
})
