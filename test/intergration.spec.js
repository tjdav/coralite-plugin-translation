import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHTML } from 'coralite'
import translationPlugin from '../lib/index.js'

describe('Integration Test', () => {
  const cacheDir = join(process.cwd(), '.test-translations')

  let fetchCallCount = 0
  let fetchCalls = []
  let originalFetch

  beforeEach(async () => {
    await mkdir(cacheDir, { recursive: true })

    // Setup fetch mock
    originalFetch = global.fetch
    fetchCallCount = 0
    fetchCalls = []

    // @ts-ignore
    global.fetch = async (url, options) => {
      fetchCallCount++
      fetchCalls.push({
        url,
        options
      })

      const body = JSON.parse(options.body)
      const systemMessage = body.messages.find(m => m.role === 'system').content
      const userMessage = body.messages.find(m => m.role === 'user').content

      let responseContent = ''

      // Determine if it's a code block or standard text based on the system prompt
      if (systemMessage.includes('expert technical translator')) {
        // Code mock translation
        // Extract chunks and replace comments
        responseContent = userMessage.replace(/<chunk id="(\d+)">([\s\S]*?)<\/chunk>/g, (match, id, content) => {
          let translated = content.replace(/\/\/ Translate this comment/, '// Translate this comment (Translated to DE)')
          return `<chunk id="${id}">${translated}</chunk>`
        })
      } else {
        // Standard text mock translation
        responseContent = userMessage.replace(/<chunk id="(\d+)">([\s\S]*?)<\/chunk>/g, (match, id, content) => {
          let translated = content
          if (content.includes('Hello World')) {
            translated = content.replace('Hello World', 'Hallo Welt')
          }
          if (content.includes('Click here')) {
            translated = translated.replace('Click here', 'Klicken Sie hier')
          }
          if (content.includes('aria-label="Label"')) {
            translated = translated.replace('aria-label="Label"', 'aria-label="Label (DE)"')
          }
          return `<chunk id="${id}">${translated}</chunk>`
        })
      }

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: responseContent
              }
            }
          ]
        })
      }
    }
  })

  afterEach(async () => {
    global.fetch = originalFetch
    await rm(cacheDir, {
      recursive: true,
      force: true
    })
  })

  function createMockCoraliteContext (pagesDir) {
    return {
      options: { pages: pagesDir },
      pages: { list: ['/index.html', '/about.html'] },
      transform (ast) {
        // Simplified serializer for test assertions
        function serialize (node) {
          if (node.type === 'text') return node.data
          if (node.type === 'comment') return `<!--${node.data}-->`
          if (node.type === 'tag' || node.type === 'root') {
            const inner = (node.children || []).map(serialize).join('')
            if (node.type === 'root') return inner

            const attrs = Object.entries(node.attribs || {})
              .map(([k, v]) => ` ${k}="${v}"`)
              .join('')
            return `<${node.name}${attrs}>${inner}</${node.name}>`
          }
          return ''
        }
        return serialize(ast)
      }
    }
  }

  test('Full translation lifecycle', async () => {
    const pagesDir = join(process.cwd(), 'pages')
    const context = createMockCoraliteContext(pagesDir)

    // Create the plugin with mock api so it won't crash even if fetch wasn't mocked properly
    const plugin = translationPlugin({
      sourceLanguage: 'en',
      targetLanguages: ['de'],
      api: { key: 'mock-key' },
      cacheDir
    })

    // Mock the hook context
    const hookContext = {
      ...context,
      options: context.options,
      pages: context.pages,
      transform: context.transform
    }

    const htmlContentIndex = `
      <html>
        <body>
          <h1>Hello World</h1>
          <a href="/about.html" aria-label="Label">Click here</a>
          <pre><code>// Translate this comment\nconst x = 1;</code></pre>
        </body>
      </html>
    `

    const htmlContentAbout = `
      <html>
        <body>
          <h1>About Us</h1>
          <p>We are a great company.</p>
        </body>
      </html>
    `

    const pathIndex = { pathname: join(pagesDir, 'index.html') }
    const pathAbout = { pathname: join(pagesDir, 'about.html') }

    // === 1. First Pass (No Cache) ===
    const generatedPagesIndex = await plugin.onAfterPageRender.call(hookContext, {
      path: pathIndex,
      html: htmlContentIndex,
      duration: 100
    })

    assert.strictEqual(generatedPagesIndex.length, 1, 'Should generate one translated page for index')
    const translatedHtmlIndex = generatedPagesIndex[0].html

    assert.ok(translatedHtmlIndex.includes('<h1>Hallo Welt</h1>'), 'Standard text should be translated')
    assert.ok(translatedHtmlIndex.includes('Klicken Sie hier'), 'Link text should be translated')
    assert.ok(translatedHtmlIndex.includes('aria-label="Label (DE)"'), 'Attribute should be translated')
    assert.ok(translatedHtmlIndex.includes('// Translate this comment (Translated to DE)'), 'Code comment should be translated')
    assert.ok(translatedHtmlIndex.includes('href="/de/about.html"'), 'Relative link should be localized')

    // Process second page (about.html)
    const generatedPagesAbout = await plugin.onAfterPageRender.call(hookContext, {
      path: pathAbout,
      html: htmlContentAbout,
      duration: 100
    })

    assert.strictEqual(generatedPagesAbout.length, 1, 'Should generate one translated page for about')

    // Verify fetch was called 3 times total (2 for index (text+code), 1 for about)
    assert.strictEqual(fetchCallCount, 3, 'Fetch should be called 3 times total')

    // === 2. Second Pass (Cached) ===
    fetchCallCount = 0 // Reset fetch count

    const cachedPages = await plugin.onAfterPageRender.call(hookContext, {
      path: pathIndex,
      html: htmlContentIndex, // Same content
      duration: 100
    })

    assert.strictEqual(cachedPages.length, 1, 'Should still generate one page from cache')
    assert.strictEqual(fetchCallCount, 0, 'Fetch should NOT be called on second pass due to cache')

    const cachedHtml = cachedPages[0].html
    assert.ok(cachedHtml.includes('<h1>Hallo Welt</h1>'))

    // === 3. Cleanup (Unused Hashes) ===
    // Verify initial cache has keys from both pages
    const i18nFile = join(cacheDir, 'i18n.json')
    const fs = await import('node:fs/promises')
    const initialCacheContent = await fs.readFile(i18nFile, 'utf-8')
    const initialCacheData = JSON.parse(initialCacheContent)

    // Should have multiple hashes (3 for index, 2 for about)
    const initialKeyCount = Object.keys(initialCacheData).length
    assert.ok(initialKeyCount > 2, 'Initial cache should contain multiple hashes from both pages')

    // Simulate removing index.html from the usage list by deleting the page
    await plugin.onPageDelete.call(hookContext, { path: pathIndex })

    // Trigger build complete with all pages built
    await plugin.onBuildComplete.call(hookContext, {
      results: [{}, {}] // Length matches context.pages.list.length (2)
    })

    // Let's verify the file system cache to ensure cleanup happened.
    // The usage tracker would have cleared the index.html page's hashes on delete.
    // However, hashes for about.html should still remain since it wasn't deleted.
    const finalCacheContent = await fs.readFile(i18nFile, 'utf-8')
    const finalCacheData = JSON.parse(finalCacheContent)

    const finalKeyCount = Object.keys(finalCacheData).length
    assert.ok(finalKeyCount > 0, 'Cache should not be completely empty (about.html hashes should remain)')
    assert.ok(finalKeyCount < initialKeyCount, 'Cache should have fewer keys after cleanup (index.html hashes removed)')
  })
})
