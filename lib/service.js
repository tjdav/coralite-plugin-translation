/**
 * @import {OpenAIOptions} from './index.js'
 */

/**
 * Validates the safety and quality of a translation by comparing it with the source text.
 * Checks for empty results and suspicious length ratios.
 *
 * @param {string} original - The source text.
 * @param {string} translated - The translated text to validate.
 * @param {Object} [options] - Validation thresholds.
 * @param {number} [options.minRatio=0.3] - Minimum allowed length ratio (target/source).
 * @param {number} [options.maxRatio=5.0] - Maximum allowed length ratio (target/source).
 * @param {number} [options.minLengthThreshold=5] - Texts shorter than this skip ratio checks.
 * @returns {{ isValid: boolean, ratio: number, reason: string|null, clear: boolean, source: string|null, target: string|null }} Validation result object.
 */
export function validateTranslationSafety (original, translated, { minRatio = 0.3, maxRatio = 5.0, minLengthThreshold = 5 } = {}) {
  if (typeof translated !== 'string') {
    return {
      isValid: false,
      ratio: 0,
      reason: 'Translation is not a string'
    }
  }

  const source = typeof original === 'string' ? original.trim() : null
  const target = typeof translated === 'string' ? translated.trim() : null

  // Basic Content Check
  if (!target || !source) {
    return {
      isValid: false,
      ratio: 0,
      reason: 'Translation is empty'
    }
  }

  const sourceLen = source.length
  const targetLen = target.length

  // Short string bypass
  // If the string contains at least two words and is very short, ratios are statistically noisy.
  if (!source.includes(' ') || sourceLen <= minLengthThreshold) {
    return {
      isValid: true,
      ratio: targetLen / (sourceLen || 1),
      reason: 'Skipped: Below length threshold'
    }
  }

  // Script-specific adjustments (CJK)
  let currentMin = minRatio
  let currentMax = maxRatio

  const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(source + target)
  if (hasCJK) {
    currentMin = 0.1
    currentMax = 8.0
  }

  // Ratio calculation
  const ratio = targetLen / sourceLen

  if (ratio < currentMin) {
    return {
      isValid: false,
      ratio,
      reason: `Too short (Ratio: ${ratio.toFixed(2)})`,
      clear: true,
      source,
      target
    }
  }
  if (ratio > currentMax) {
    return {
      isValid: false,
      ratio,
      reason: `Too long (Ratio: ${ratio.toFixed(2)})`,
      clear: false,
      source,
      target
    }
  }

  return {
    isValid: true,
    ratio,
    reason: null,
    clear: false,
    source,
    target
  }
}

/**
 * Processes a single batch of translation tasks via the OpenAI API using the legacy text-node method.
 * Handles prompt construction, API calls, response parsing, validation, and recursive retries.
 *
 * @param {string} lang - The target language code (e.g., 'fr').
 * @param {Array<{text: string}>} tasks - Array of objects containing text to translate.
 * @param {string} systemPrompt - The system instruction for the LLM.
 * @param {number} retries - Number of remaining retry attempts.
 * @param {OpenAIOptions} options - Plugin configuration options containing API key.
 * @returns {Promise<string[]>} Array of translated strings.
 * @throws {Error} If validation fails or API errors persist after retries.
 */
export async function processRepairBatch (lang, tasks, systemPrompt, retries, options) {
  // Prepare Batch Text
  let dataPrompt = ''
  for (const task of tasks) {
    // Always trim input for the prompt to ensure clean translation
    dataPrompt += task.text.trim() + '\n\n---\n\n'
  }
  // Remove trailing separator
  dataPrompt = dataPrompt.substring(0, dataPrompt.length - 7)

  try {
    const response = await fetch(`${options.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.key}`
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: lang.toUpperCase() + '\n' + dataPrompt
          }
        ]
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText} - ${errText}`)
    }

    const json = await response.json()
    const content = json.choices[0].message.content

    // Parse Response
    const translations = convertMessage(content)

    // --- SAFETY CHECK 1: COUNT MISMATCH ---
    if (translations.length !== tasks.length) {
      throw new Error(`Count Mismatch: Sent ${tasks.length}, got ${translations.length}.`)
    }

    // --- SAFETY CHECK 2: LENGTH ANOMALIES ---
    for (let i = 0; i < translations.length; i++) {
      const validation = validateTranslationSafety(tasks[i].text, translations[i])

      if (!validation.isValid) {
        let result = '\n\n'
        result += '---\n'
        result += 'source: ' + validation.source + '\n'
        result += 'target: ' + validation.target + '\n'
        result += '---'
        result += '\n'
        throw new Error(`Validation failed for item ${i}: ${validation.reason} ${result}`)
      }
    }

    return translations
  } catch (error) {
    // Recursively retry just this batch
    if (retries > 0) {
      // console.warn(`Batch failed for ${lang} (${retries} retries left): ${error.message}`)
      return await processRepairBatch(lang, tasks, systemPrompt, retries - 1, options)
    }

    throw error
  }
}

/**
 * Processes a single batch of translation tasks via the OpenAI API using a raw payload.
 *
 * @param {string} lang - The target language code (e.g., 'fr').
 * @param {string} payload - The raw payload string (e.g. XML chunks).
 * @param {string} systemPrompt - The system instruction for the LLM.
 * @param {number} retries - Number of remaining retry attempts.
 * @param {OpenAIOptions} options - Plugin configuration options containing API key.
 * @returns {Promise<string>} The raw translated content string.
 */
export async function processBlockBatch (lang, payload, systemPrompt, retries, options) {
  try {
    const response = await fetch(`${options.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.key}`
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Translate to: ${lang.toUpperCase()}\n\n${payload}`
          }
        ]
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText} - ${errText}`)
    }

    const json = await response.json()
    return json.choices[0].message.content
  } catch (error) {
    if (retries > 0) {
      return await processBlockBatch(lang, payload, systemPrompt, retries - 1, options)
    }
    throw error
  }
}

/**
 * Orchestrates the translation of a large set of tasks by splitting them into chunks.
 * Manages the batch processing loop and aggregates results.
 *
 * @param {string} lang - The target language code.
 * @param {Array<{text: string}>} tasks - All tasks to translate.
 * @param {string} systemPrompt - The system prompt for the translation.
 * @param {number} retries - Retry attempts per chunk.
 * @param {number} chunkSize - Number of items to process in each batch.
 * @param {OpenAIOptions} options - Plugin configuration options.
 * @yields {{ progress: { total: number, current: number, chunkIndex: number, totalChunks: number }, results: (string|null)[] }} Yields progress and results per chunk.
 */
export async function* repairLanguageFields (lang, tasks, systemPrompt, retries, chunkSize, options) {
  if (!tasks || tasks.length === 0) return []

  const totalChunks = Math.ceil(tasks.length / chunkSize)

  // Loop through data in chunks
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize)
    const chunkIndex = Math.floor(i / chunkSize) + 1

    let results
    try {
      results = await processRepairBatch(lang, chunk, systemPrompt, retries, options)
    } catch (error) {
      // If final retry fails, fill with nulls
      // console.error(`Chunk failed for ${lang} at index ${i}. Filling with nulls.`, error)
      results = new Array(chunk.length).fill(null)
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

/**
 * Parses the LLM text response into an array of strings.
 * Expects segments separated by '---'.
 *
 * @param {string} translation - The raw text response from the API.
 * @returns {string[]} Array of separated translation strings.
 */
export function convertMessage (translation) {
  let textSplit = translation.split('---')
  let data = []

  for (let index = 0; index < textSplit.length; index++) {
    const text = textSplit[index].trim()
    if (text) { // Ensure we don't push empty strings if split creates empty artifacts
      data.push(text)
    }
  }

  return data
}
