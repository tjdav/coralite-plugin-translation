import { createPlugin, parseHTML } from 'coralite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, dirname, basename } from 'node:path'
import { validateOptions, collectTextNodes, DEFAULT_ALLOWED_ATTRIBUTES } from './utils.js'
import { repairLanguageFields } from './service.js'
import { createTranslationQueue } from './queue.js'


/**
 * @typedef {Object} OpenAIOptions - OpenAI configuration object.
 * @property {string} [baseURL='https://api.openai.com/v1'] - Your OpenAI API key.
 * @property {string} [key=''] - Your OpenAI API key.
 * @property {string} [model='gpt-3.5-turbo'] - OpenAI model to use.
 */

/**
 * Creates the translation plugin.
 * Configures automatic translation of pages using OpenAI's API.
 * Supports caching, chunking, and language exclusions.
 *
 * @param {Object} options - The plugin configuration.
 * @param {string} options.sourceLanguage - Source language code (e.g., 'en').
 * @param {string[]} options.targetLanguages - List of target language codes.
 * @param {OpenAIOptions} options.api - OpenAI configuration object.
 * @param {string[]} [options.exclude] - Array of path patterns to exclude from translation.
 * @param {string} [options.cacheDir='.coralite/cache'] - Directory to store translation cache.
 * @param {number} [options.chunkSize=10] - Number of text nodes to process per API request.
 * @param {number} [options.retries=3] - Number of retry attempts for failed API calls.
 * @param {Object} [options.attributes] - Map of allowed attributes to translate.
 */
export function translation (options) {
  validateOptions(options)

  const queue = createTranslationQueue()
  const cacheDir = options.cacheDir || join(process.cwd(), '.coralite', 'cache')
  // New cache file for fragments: i18n.json
  const cacheFile = join(cacheDir, 'i18n.json')
  const exclude = options.exclude || []
  const chunkSize = options.chunkSize || 10
  const retries = options.retries || 3
  const allowedAttributes = {
    ...DEFAULT_ALLOWED_ATTRIBUTES,
    ...options.attributes
  }
  const api = {
    baseURL: 'https://api.openai.com/v1',
    key: '',
    model: 'gpt-3.5-turbo'
  }

  if (typeof options.api === 'object') {
    if (options.api.baseURL) {
      let href = new URL(options.api.baseURL).href

      if (href[0] === '/') {
        href = href.substring(0, href.length - 1)
      }

      api.baseURL = href
    }

    if (options.api.key) {
      api.key = options.api.key
    }

    if (options.api.model) {
      api.model = options.api.model
    }
  }

  // Cache structure: { "source string": { "fr": "translated", "es": "..." } }
  let fragmentCache = {}
  let cacheLoaded = false

  // Load cache on initialization
  async function loadCache () {
    try {
      const content = await readFile(cacheFile, 'utf-8')
      fragmentCache = JSON.parse(content)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Failed to load translation cache:', error.message)
      }
      fragmentCache = {}
    }
    cacheLoaded = true
  }

  // Save cache
  async function saveCache () {
    try {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(cacheFile, JSON.stringify(fragmentCache, null, 2))
    } catch (error) {
      console.warn('Failed to save translation cache:', error.message)
    }
  }

  return createPlugin({
    name: 'translation',
    async onAfterPageRender ({ path, html, duration }) {
      if (!cacheLoaded) {
        await loadCache()
      }

      const relativePath = relative(this.options.pages, path.pathname)

      // Check if path contains any target language prefix to avoid infinite loops
      for (const lang of options.targetLanguages) {
        if (lang === options.sourceLanguage) continue
        if (relativePath.startsWith(lang + '/') || relativePath === lang) {
          return
        }
      }

      if (exclude.some(pattern => path.pathname.includes(pattern))) {
        return
      }

      const generatedPages = []

      // Iterate over target languages
      for (const targetLang of options.targetLanguages) {
        if (targetLang === options.sourceLanguage) continue

        // Parse content to get a fresh DOM
        const parsed = parseHTML(html)
        const nodes = []
        collectTextNodes(parsed.root, nodes, ['script', 'style'], allowedAttributes)

        if (nodes.length > 0) {
          // Identify missing translations
          const tasks = []
          const nodeTaskMap = [] // Maps node index to task index (or -1 if cached)

          for (let i = 0; i < nodes.length; i++) {
            const nodeItem = nodes[i]
            const sourceText = nodeItem.text

            // Check fragment cache
            if (fragmentCache[sourceText] && fragmentCache[sourceText][targetLang]) {
              nodeTaskMap[i] = { cached: fragmentCache[sourceText][targetLang] }
            } else {
              tasks.push({
                text: sourceText,
                originalIndex: i
              })
              nodeTaskMap[i] = { taskIndex: tasks.length - 1 }
            }
          }

          let newTranslationsMap = {}

          if (tasks.length > 0) {
            // Use generator to process batches for missing items
            const generator = repairLanguageFields(
              targetLang,
              tasks,
              `You are a translator. Translate the following text values to ${targetLang}. Use '---' as a separator between each translation.`,
              retries,
              chunkSize,
              api
            )

            // Consume generator
            try {
              let currentTaskOffset = 0
              for await (const { progress, results } of queue.add(() => generator)) {
                process.stdout.write(`\r[Translation] ${relativePath} -> ${targetLang}: Chunk ${progress.chunkIndex}/${progress.totalChunks} (${progress.current}/${progress.total})`)

                if (results) {
                  for (let r = 0; r < results.length; r++) {
                    const task = tasks[currentTaskOffset + r]
                    if (results[r] !== null) {
                      newTranslationsMap[task.originalIndex] = results[r]

                      // Update fragment cache immediately in memory
                      if (!fragmentCache[task.text]) fragmentCache[task.text] = {}
                      fragmentCache[task.text][targetLang] = results[r]
                    }
                  }
                  currentTaskOffset += results.length
                }

                // Persist cache after processing all chunks for this page/lang
                await saveCache()
              }

              process.stdout.write('\n')
            } catch (err) {
              console.error(`\nTranslation error for ${relativePath} -> ${targetLang}:`, err.message)
              continue
            }
          }

          // Apply translations to DOM
          let success = true
          // Iterate backwards to support partial text replacements without index shifting issues
          for (let i = nodes.length - 1; i >= 0; i--) {
            const map = nodeTaskMap[i]
            let translatedText = null

            if (map.cached) {
              translatedText = map.cached
            } else if (map.taskIndex !== undefined) {
              translatedText = newTranslationsMap[i]
            }

            if (translatedText) {
              const nodeItem = nodes[i]
              if (nodeItem.type === 'text') {
                if (nodeItem.range) {
                  const { start, end } = nodeItem.range
                  const original = nodeItem.node.data
                  // Apply partial replacement
                  nodeItem.node.data = original.slice(0, start) + translatedText + original.slice(end)
                } else {
                  nodeItem.node.data = translatedText
                }
              } else if (nodeItem.type === 'attribute') {
                nodeItem.node.attribs[nodeItem.name] = translatedText
              }
            } else {
              // If it was a task but failed to translate
              if (map.taskIndex !== undefined) {
                success = false
                console.warn(`Translation missing for node ${i} in ${relativePath} to ${targetLang}`)
              }
            }
          }

          if (success) {
            const translatedHtml = this.transform(parsed.root)
            const newPathname = join(this.options.pages, targetLang, relativePath)
            const newDirname = dirname(newPathname)
            const newFilename = basename(newPathname)

            generatedPages.push({
              path: {
                pathname: newPathname,
                dirname: newDirname,
                filename: newFilename
              },
              html: translatedHtml,
              duration: 0
            })
          } else {
            console.warn(`\nPartial translation failure for ${relativePath} to ${targetLang}. Skipping page generation.`)
          }
        } else {
          // No text, copy as is
          const newPathname = join(this.options.pages, targetLang, relativePath)
          const newDirname = dirname(newPathname)
          const newFilename = basename(newPathname)

          generatedPages.push({
            path: {
              pathname: newPathname,
              dirname: newDirname,
              filename: newFilename
            },
            html,
            duration: 0
          })
        }
      }

      return generatedPages
    }
  })
}


export default translation
