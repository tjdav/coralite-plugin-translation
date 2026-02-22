import { parseHTML } from 'coralite'

/**
 * Extracts all text content from an AST node and its children.
 * @param {Object} node - The AST node.
 * @returns {string} The concatenated text content.
 */
function extractText (node) {
  if (!node) return ''
  if (node.type === 'text') {
    return node.data || ''
  }
  if (node.children) {
    return node.children.map(extractText).join('')
  }
  return ''
}

/**
 * Recursively counts occurrences of each tag in the AST.
 * @param {Object} node - The AST node.
 * @param {Map<string, number>} counts - The map to store tag counts.
 */
function countTags (node, counts = new Map()) {
  if (!node) return counts

  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    const tagName = node.name.toLowerCase()
    counts.set(tagName, (counts.get(tagName) || 0) + 1)
  }

  if (node.children) {
    for (const child of node.children) {
      countTags(child, counts)
    }
  }
  return counts
}

/**
 * Recursively extracts critical attributes from the AST for validation.
 * Includes href, src, class, id. Skips alt, title, aria-*, etc.
 * @param {Object} node - The AST node.
 * @param {Array<{tag: string, attr: string, value: string}>} attributes - List of attributes found.
 */
function extractAttributes (node, attributes = []) {
  if (!node) return attributes

  if (node.type === 'tag' && node.attribs) {
    for (const [key, value] of Object.entries(node.attribs)) {
      if (['href', 'src', 'class', 'id'].includes(key)) {
        attributes.push({
          tag: node.name,
          attr: key,
          value: value || ''
        })
      }
    }
  }

  if (node.children) {
    for (const child of node.children) {
      extractAttributes(child, attributes)
    }
  }
  return attributes
}

/**
 * Validates a translated HTML chunk against its source.
 * Checks text length ratio, tag structure, and attribute preservation.
 *
 * @param {string} sourceHtml - The original HTML string.
 * @param {string} translatedHtml - The translated HTML string.
 * @param {Object} [options] - Validation thresholds.
 * @param {number} [options.minRatio=0.4] - Minimum allowed text length ratio.
 * @param {number} [options.maxRatio=2.5] - Maximum allowed text length ratio.
 * @returns {{ isValid: boolean, reason: string|null }} Validation result.
 */
export function validateChunk (sourceHtml, translatedHtml, { minRatio = 0.4, maxRatio = 2.5 } = {}) {
  if (typeof translatedHtml !== 'string') {
    return {
      isValid: false,
      reason: 'Translation is not a string'
    }
  }

  // Parse both HTML strings
  let sourceAst
  let translatedAst
  try {
    sourceAst = parseHTML(sourceHtml).root
    translatedAst = parseHTML(translatedHtml).root
  } catch (err) {
    return {
      isValid: false,
      reason: 'Failed to parse HTML: ' + err.message
    }
  }

  // 1. Text-Only Ratio Checking
  const sourceText = extractText(sourceAst).trim()
  const translatedText = extractText(translatedAst).trim()

  const sourceLen = sourceText.length
  const targetLen = translatedText.length

  if (sourceLen > 0 && targetLen === 0) {
    return {
      isValid: false,
      reason: 'Translation text is empty'
    }
  }

  // CJK Detection & Ratio Adjustment
  const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(sourceText + translatedText)
  let currentMin = minRatio
  let currentMax = maxRatio

  if (hasCJK) {
    // English -> CJK usually shrinks (0.1x is safe lower bound)
    // CJK -> English usually expands (8.0x is safe upper bound)
    currentMin = 0.1
    currentMax = 8.0
  }

  const ratio = sourceLen > 0 ? targetLen / sourceLen : 1.0 // handle empty source safely

  if (sourceLen > 5) { // Skip ratio check for very short texts
    if (ratio < currentMin) {
      return {
        isValid: false,
        reason: `Text too short (Ratio: ${ratio.toFixed(2)})`
      }
    }
    if (ratio > currentMax) {
      return {
        isValid: false,
        reason: `Text too long (Ratio: ${ratio.toFixed(2)})`
      }
    }
  }

  // 2. Structural Integrity (Tag Parity)
  const sourceTags = countTags(sourceAst)
  const translatedTags = countTags(translatedAst)

  for (const [tag, count] of sourceTags.entries()) {
    const translatedCount = translatedTags.get(tag) || 0
    if (count !== translatedCount) {
      return {
        isValid: false,
        reason: `Tag mismatch for <${tag}>: expected ${count}, got ${translatedCount}`
      }
    }
  }
  // Check for hallucinated tags (tags in translation but not in source)
  for (const [tag, count] of translatedTags.entries()) {
    if (!sourceTags.has(tag)) {
      return {
        isValid: false,
        reason: `Hallucinated tag <${tag}>: expected 0, got ${count}`
      }
    }
  }

  // 3. Attribute Preservation Check
  const sourceAttrs = extractAttributes(sourceAst)
  const translatedAttrs = extractAttributes(translatedAst)

  // Sort to compare lists easily (though order might change in translation? attributes order in tag doesn't matter, but hierarchy does)
  // Since we flattened the attributes list, we need to be careful.
  // Ideally, we should check attributes *per tag instance*, but that requires matching nodes.
  // Matching nodes is hard if text changes.
  // For now, let's just check that the *set* of attributes matches.
  // If there are multiple <a> tags, we expect the set of hrefs to match exactly.

  // Count attribute occurrences
  const countAttrs = (list) => {
    const map = new Map()
    for (const item of list) {
      const key = `${item.tag}|${item.attr}|${item.value}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }

  const sourceAttrCounts = countAttrs(sourceAttrs)
  const translatedAttrCounts = countAttrs(translatedAttrs)

  for (const [key, count] of sourceAttrCounts.entries()) {
    const translatedCount = translatedAttrCounts.get(key) || 0
    if (count !== translatedCount) {
      const [tag, attr, value] = key.split('|')
      return {
        isValid: false,
        reason: `Attribute mismatch: <${tag} ${attr}="${value}"> expected ${count}, got ${translatedCount}`
      }
    }
  }

  // Check for hallucinated attributes (in translated but not in source)
  for (const [key, count] of translatedAttrCounts.entries()) {
    if (!sourceAttrCounts.has(key)) {
      const [tag, attr, value] = key.split('|')
      return {
        isValid: false,
        reason: `Hallucinated attribute: <${tag} ${attr}="${value}">`
      }
    }
  }

  return {
    isValid: true,
    reason: null
  }
}
