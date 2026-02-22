/**
 * @import {OpenAIOptions} from './index.js'
 */

import { parseTranslatedPayload } from './block-utils.js'
import { validateChunk } from './validation.js'

/**
 * Processes a single batch of translation tasks via the OpenAI API using a raw payload.
 *
 * @param {string} lang - The target language code (e.g., 'fr').
 * @param {string} payload - The raw payload string (e.g. XML chunks).
 * @param {Array<{index: number, originalHtml: string}>} mapping - The mapping of chunk IDs to original HTML.
 * @param {string} systemPrompt - The system instruction for the LLM.
 * @param {number} retries - Number of remaining retry attempts.
 * @param {OpenAIOptions & { maxTokensMultiplier: number }} options - Plugin configuration options containing API key.
 * @returns {Promise<Map<number, string>>} The map of chunk ID to translated HTML.
 */
export async function processBlockBatch (lang, payload, mapping, systemPrompt, retries, options) {
  try {
    const maxTokensMultiplier = options.maxTokensMultiplier || 1000
    const body = {
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
      ],
      max_tokens: mapping.length * maxTokensMultiplier
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    if (options.top_p !== undefined) {
      body.top_p = options.top_p
    }

    if (options.frequency_penalty !== undefined) {
      body.frequency_penalty = options.frequency_penalty
    }

    if (options.presence_penalty !== undefined) {
      body.presence_penalty = options.presence_penalty
    }

    const response = await fetch(`${options.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.key}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText} - ${errText}`)
    }

    const json = await response.json()
    const content = json.choices[0].message.content

    // Validation
    const translations = parseTranslatedPayload(content)

    // Check if all chunks are present and valid
    for (const item of mapping) {
      if (!translations.has(item.index)) {
        throw new Error(`Missing chunk ID ${item.index} in translation response`)
      }

      const translatedHtml = translations.get(item.index)
      const validation = validateChunk(item.originalHtml, translatedHtml)

      if (!validation.isValid) {
        throw new Error(`Validation failed for chunk ${item.index}: ${validation.reason}`)
      }
    }

    return translations
  } catch (error) {
    if (retries > 0) {
      return await processBlockBatch(lang, payload, mapping, systemPrompt, retries - 1, options)
    }
    throw error
  }
}
