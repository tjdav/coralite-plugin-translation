import { createPlugin, parseHTML } from 'coralite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, dirname, basename } from 'node:path'
import { validateOptions, computeHash } from './utils.js'
import { processBlockBatch } from './service.js'
import { createTranslationQueue } from './queue.js'
import {
  findTranslatableBlocks,
  serializeNode,
  prepareTranslationPayload,
  reconstructBlock
} from './block-utils.js'


/**
 * @typedef {Object} OpenAIOptions - OpenAI configuration object.
 * @property {string} [baseURL='https://api.openai.com/v1'] - The OpenAI API key.
 * @property {string} [key=''] - The OpenAI API key.
 * @property {string} [model='gpt-3.5-turbo'] - OpenAI model to use.
 * @property {number} [temperature] - Sampling temperature to use.
 * @property {number} [top_p] - Nucleus sampling probability.
 * @property {number} [frequency_penalty] - Frequency penalty.
 * @property {number} [presence_penalty] - Presence penalty.
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
 * @param {number} [options.maxTokensMultiplier=1000] - Multiplier for max_tokens calculation based on chunks.
 * @param {number} [options.retries=3] - Number of retry attempts for failed API calls.
 * @param {Object} [options.attributes] - Map of allowed attributes to translate.
 */
export function translation (options) {
  validateOptions(options)

  const queue = createTranslationQueue()
  const cacheDir = options.cacheDir || join(process.cwd(), '.coralite', 'cache')
  const cacheFile = join(cacheDir, 'i18n.json')
  const exclude = options.exclude || []
  const chunkSize = options.chunkSize || 10
  const maxTokensMultiplier = options.maxTokensMultiplier || 1000
  const retries = options.retries || 3

  const api = {
    baseURL: 'https://api.openai.com/v1',
    key: '',
    model: 'gpt-3.5-turbo',
    maxTokensMultiplier
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

    if (options.api.temperature !== undefined) {
      api.temperature = options.api.temperature
    }

    if (options.api.top_p !== undefined){
      api.top_p = options.api.top_p
    }

    if (options.api.frequency_penalty !== undefined){
      api.frequency_penalty = options.api.frequency_penalty
    }

    if (options.api.presence_penalty !== undefined) {
      api.presence_penalty = options.api.presence_penalty
    }
  }

  // Cache structure: { "md5hash": { "fr": "translated", "es": "..." } }
  let fragmentCache = {}
  let cacheLoaded = false

  // Load cache on initialization
  async function loadCache () {
    try {
      const content = await readFile(cacheFile, 'utf-8')
      fragmentCache = JSON.parse(content)
    } catch (error) {
      // console.warn('Failed to load translation cache:', error.message)
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

  // Generator for block processing
  async function* processBlockTasks (lang, tasks, systemPrompt, retries, chunkSize, apiOptions) {
    if (!tasks || tasks.length === 0) return []

    const totalChunks = Math.ceil(tasks.length / chunkSize)

    for (let i = 0; i < tasks.length; i += chunkSize) {
      const chunk = tasks.slice(i, i + chunkSize)
      const chunkIndex = Math.floor(i / chunkSize) + 1

      // Prepare payload
      const { payload, mapping } = prepareTranslationPayload(chunk.map(t => t.block))

      if (!payload.trim()) {
        yield {
          progress: {
            total: tasks.length,
            current: Math.min(i + chunkSize, tasks.length),
            chunkIndex,
            totalChunks
          },
          results: new Map() // Empty results
        }
        continue
      }

      let results = new Map()
      try {
        const parsed = await processBlockBatch(lang, payload, mapping, systemPrompt, retries, apiOptions)

        mapping.forEach(m => {
          const translated = parsed.get(m.index)
          if (translated) {
            results.set(m.block, translated)
          }
        })

      } catch (error) {
        console.error(`Chunk failed for ${lang} at index ${i}.`, error)
      }

      yield {
        progress: {
          total: tasks.length,
          current: Math.min(i + chunkSize, tasks.length),
          chunkIndex,
          totalChunks
        },
        results
      }
    }
  }

  function isCodeBlock (block) {
    if (block.name === 'code') return true
    if (block.name === 'pre') {
      // Check if it has a code child
      return block.children && block.children.some(c => c.name === 'code')
    }
    return false
  }

  return createPlugin({
    name: 'translation',
    async onAfterPageRender ({ path, html, duration }) {
      if (!cacheLoaded) {
        await loadCache()
      }

      const relativePath = relative(this.options.pages, path.pathname)
      const targetLanguages = options.targetLanguages.map(lang => lang.toLowerCase())
      const sourceLanguage = options.sourceLanguage

      // Check if path contains any target language prefix to avoid infinite loops
      for (const lang of targetLanguages) {
        if (lang === sourceLanguage) {
          continue
        }

        if (relativePath.startsWith(lang + '/') || relativePath === lang) {
          return
        }
      }

      if (exclude.some(pattern => path.pathname.includes(pattern))) {
        return
      }

      const generatedPages = []

      // Iterate over target languages
      for (const targetLang of targetLanguages) {
        if (targetLang === sourceLanguage) continue

        // Parse content to get a fresh DOM
        const parsed = parseHTML(html)
        const blocks = []
        findTranslatableBlocks(parsed.root, blocks)

        if (blocks.length > 0) {
          // Identify missing translations
          const standardTasks = []
          const codeTasks = []
          const blockTaskMap = new Map() // Map<BlockNode, { cached: string } | { isTask: boolean }>

          for (const block of blocks) {
            const sourceHtml = serializeNode({ children: block.children })
            // Use MD5 of HTML as cache key
            const hash = computeHash(sourceHtml)

            if (fragmentCache[hash] && fragmentCache[hash][targetLang]) {
              blockTaskMap.set(block, { cached: fragmentCache[hash][targetLang] })
            } else {
              const task = {
                block,
                sourceHtml,
                hash
              }
              if (isCodeBlock(block)) {
                codeTasks.push(task)
                blockTaskMap.set(block, {
                  isTask: true,
                  type: 'code'
                })
              } else {
                standardTasks.push(task)
                blockTaskMap.set(block, {
                  isTask: true,
                  type: 'standard'
                })
              }
            }
          }

          let newTranslationsMap = new Map()

          const executeBatch = async (tasks, prompt, label) => {
            if (tasks.length === 0) return
            // Use generator to process batches for missing items
            const generator = processBlockTasks(
              targetLang,
              tasks,
              prompt,
              retries,
              chunkSize,
              api
            )

            // Consume generator
            try {
              for await (const { progress, results } of queue.add(() => generator)) {
                process.stdout.write(`\r[Translation] ${relativePath} -> ${targetLang} [${label}]: Chunk ${progress.chunkIndex}/${progress.totalChunks} (${progress.current}/${progress.total})`)

                if (results) {
                  for (const [block, translatedHtml] of results.entries()) {
                    newTranslationsMap.set(block, translatedHtml)

                    // Update fragment cache immediately in memory
                    const task = tasks.find(t => t.block === block)
                    if (task) {
                      if (!fragmentCache[task.hash]) fragmentCache[task.hash] = {}
                      fragmentCache[task.hash][targetLang] = translatedHtml
                    }
                  }
                }

                // Persist cache after processing all chunks for this page/lang
                await saveCache()
              }

              process.stdout.write('\n')
            } catch (err) {
              console.error(`\nTranslation error for ${relativePath} -> ${targetLang} [${label}]:`, err.message)
            }
          }

          if (standardTasks.length > 0) {
            const standardSystemPrompt = `You are an expert translator. Translate the text content within the following HTML fragments to ${targetLang}.
**CRITICAL HTML RULES:**
* **DO TRANSLATE** the values of these specific attributes: \`alt\`, \`title\`, \`placeholder\`, and \`aria-label\`.
* **DO NOT TRANSLATE** the values of any other attributes (e.g., \`class\`, \`id\`, \`href\`, \`src\`, \`data-*\`, \`style\`). Leave them exactly as they are.
* **DO NOT HTML-ESCAPE** the tags. Output tags exactly with angle brackets (e.g., <code>), not as HTML entities (e.g., &lt;code&gt;).
* Strictly preserve all HTML tags and structure. Do not wrap your response in markdown formatting.`

            await executeBatch(standardTasks, standardSystemPrompt, 'Text')
          }

          if (codeTasks.length > 0) {
            const codeSystemPrompt = `You are an expert technical translator and senior software engineer.
Your task is to translate the natural language portions of the provided code snippets to ${targetLang} while absolutely preserving the code's executability and structure.

You will receive HTML chunks containing <pre> or <code> blocks.

STRICT RULES:
1. ONLY translate inline comments (e.g., // comment, /* comment */, # comment, ), JSDoc/Docstrings, and user-facing text inside string literals.
2. DO NOT translate variable names, function names, class names, object keys, or programming keywords (like function, const, return, if, etc.).
3. DO NOT translate or modify any HTML tags, attributes, or XML chunks provided in the payload.
4. PRESERVE all original formatting, indentation, line breaks, and punctuation exactly as they appear in the source.
5. If a block contains no translatable comments or strings, return it exactly as it was provided.`

            await executeBatch(codeTasks, codeSystemPrompt, 'Code')
          }

          // Apply translations to DOM
          let success = true
          for (const block of blocks) {
            const map = blockTaskMap.get(block)
            let translatedHtml = null

            if (map.cached) {
              translatedHtml = map.cached
            } else if (newTranslationsMap.has(block)) {
              translatedHtml = newTranslationsMap.get(block)
            }

            if (translatedHtml) {
              reconstructBlock(block, translatedHtml, parseHTML)
            } else {
              // If it was a task but failed to translate
              if (map && map.isTask) {
                success = false
                console.warn(`Translation missing for block in ${relativePath} to ${targetLang}`)
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
