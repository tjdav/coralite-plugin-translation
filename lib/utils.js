import { createHash } from 'node:crypto'

/**
 * Validates the options provided to the translation plugin.
 * @param {Object} options
 */
export function validateOptions (options) {
  if (!options.sourceLanguage) {
    throw new Error('Translation plugin requires "sourceLanguage" option.')
  }
  if (!options.targetLanguages || !Array.isArray(options.targetLanguages)) {
    throw new Error('Translation plugin requires "targetLanguages" array option.')
  }
}

/**
 * Computes the MD5 hash of a string.
 * @param {string} content
 * @returns {string}
 */
export function computeHash (content) {
  return createHash('md5').update(content).digest('hex')
}
