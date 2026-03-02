import { TRANSLATABLE_ATTRS } from './block-utils.js'

export class TranslationMarkupError extends Error {
  constructor (message) {
    super(message)
    this.name = 'TranslationMarkupError'
  }
}

/**
 * Phase 1: Extraction (Pre-processing)
 * Traverses the AST and generates the AI Payload and Internal Map.
 * @param {Object} node - The root AST node or element.
 * @param {boolean} [useOuter=true] - Whether to include the outer tag in the processing.
 * @returns {Object} { payload: string, map: Object }
 */
export function extractHtmlPayload (node, useOuter = true) {
  let tagCounter = 0
  const internalMap = {}

  function serializeForAi (currentNode, isRoot = false) {
    // 1. Base case: If it's text, return it exactly as is for the LLM to translate!
    if (currentNode.type === 'text') {
      return currentNode.data || ''
    }

    // Comments shouldn't be touched usually, but we need to serialize them back if they exist in the payload
    if (currentNode.type === 'comment') {
      return `<!--${currentNode.data}-->`
    }

    // 2. If it's a tag, generate the placeholders and save to the map
    if (currentNode.type === 'tag' || currentNode.type === 'script' || currentNode.type === 'style') {
      if (!isRoot || useOuter) {
        const id = tagCounter++
        let aiPayloadString = `$${id}`
        let mapOpenTag = `<${currentNode.name}`

        // Process attributes
        if (currentNode.attribs) {
          for (const [key, value] of Object.entries(currentNode.attribs)) {
            if (TRANSLATABLE_ATTRS.has(key)) {
              aiPayloadString += `[${key}: ${value}]`
              mapOpenTag += ` ${key}="{${key}}"` // Use named marker for the map
            } else {
              mapOpenTag += ` ${key}="${value}"` // Keep original for the map
            }
          }
        }

        // Handle void/self-closing tags
        const voidTags = {
          area: true,
          base: true,
          br: true,
          col: true,
          embed: true,
          hr: true,
          img: true,
          input: true,
          link: true,
          meta: true,
          param: true,
          source: true,
          track: true,
          wbr: true
        }

        if (voidTags[currentNode.name]) {
          mapOpenTag += '>'
          internalMap[id] = {
            open: mapOpenTag,
            type: 'void'
          }
          return aiPayloadString
        }

        mapOpenTag += '>'

        // Save to your internal map
        internalMap[id] = {
          open: mapOpenTag,
          close: `</${currentNode.name}>`,
          type: 'paired'
        }

        // 3. Recursively process children
        const innerContent = (currentNode.children || []).map(child => serializeForAi(child)).join('')

        // 4. Wrap the inner text with the placeholders and return
        return `${aiPayloadString}${innerContent}$${id}_`
      } else {
        // If it's the root and we don't use outer, just process children
        return (currentNode.children || []).map(child => serializeForAi(child)).join('')
      }
    }

    // For Document or Fragment root nodes without tag type
    if (currentNode.children) {
      return currentNode.children.map(child => serializeForAi(child)).join('')
    }

    return ''
  }

  const payload = serializeForAi(node, true)

  return {
    payload,
    map: internalMap
  }
}

/**
 * Phase 3: Reconstruction (Post-processing)
 * Rebuilds the HTML string from the translated payload and internal map.
 * @param {string} translatedPayload - The string returned by the LLM.
 * @param {Object} internalMap - The map generated during extraction.
 * @returns {string} The reconstructed HTML string.
 */
export function reconstructHtml (translatedPayload, internalMap) {
  let result = translatedPayload

  // Check for hallucinated placeholders not present in internalMap
  const allPlaceholders = result.match(/\$\d+_?/g) || []
  for (const placeholder of allPlaceholders) {
    const isClose = placeholder.endsWith('_')
    const id = placeholder.substring(1, placeholder.length - (isClose ? 1 : 0))
    if (!internalMap[id]) {
      throw new TranslationMarkupError(`Hallucinated tag ${placeholder} found in translated text but not in original source. Please try translating again and do not add new $n tags.`)
    }
  }

  // Check for map keys to ensure all expected tags are handled correctly and
  // ensure we handle all $n placeholders.
  for (const id of Object.keys(internalMap)) {
    const mapEntry = internalMap[id]

    // Find all occurrences of the opening placeholder.
    // It looks like: $n followed optionally by some [attr: value] brackets.
    // Tolerant of whitespace.
    const openRegex = new RegExp(`\\$${id}(?:\\s*\\[(.*?)\\])?\\s*`, 'g')

    // Validation: if $id exists, it must be closed (if paired)
    const hasOpen = new RegExp(`\\$${id}(?![\\d_])`).test(result)
    const hasClose = new RegExp(`\\$${id}_`).test(result)

    if (hasOpen && mapEntry.type === 'paired' && !hasClose) {
      throw new TranslationMarkupError(`Missing closing tag for $${id}. You failed to close tag $${id}. Please try translating again and ensure all $n tags are perfectly closed.`)
    }
    if (!hasOpen && hasClose) {
      throw new TranslationMarkupError(`Found closing tag $${id}_ but missing opening tag $${id}. Please try translating again and ensure tag structure is preserved.`)
    }

    // Since regex replacement with functions can be tricky with multiple optional capture groups
    // especially since we can have multiple [attr: value] brackets (e.g. $0[aria-label: x][title: y]),
    // we need a specialized approach to find $id and all its brackets.

    // Regex to match $id optionally followed by any number of [...] brackets, tolerant to spaces
    // Important: we need to negative lookahead for `\\d` and `_` so we don't accidentally match the opening part of $id_ or $10 when id is 1
    const openTagPattern = new RegExp(`\\$${id}(?![\\d_])(?:\\s*\\[[^\\]]+\\])*\\s*`, 'g')

    result = result.replace(openTagPattern, (match) => {
      let reconstructedOpen = mapEntry.open

      // Extract all brackets [key: value] from the match
      const bracketRegex = /\[([^:]+):\s*([^\]]+)\]/g
      let bracketMatch
      const extractedAttrs = {}

      while ((bracketMatch = bracketRegex.exec(match)) !== null) {
        const key = bracketMatch[1].trim()
        const value = bracketMatch[2].trim()
        extractedAttrs[key] = value
      }

      // Inject into the map's named markers
      for (const attr of TRANSLATABLE_ATTRS) {
        const marker = `{${attr}}`
        if (reconstructedOpen.includes(marker)) {
          // If the AI provided a translated value, use it. Otherwise, fallback to empty or keep the marker?
          // The AI *should* provide it if it was in the payload. If it dropped it, we have a missing attribute.
          const translatedValue = extractedAttrs[attr] || ''
          reconstructedOpen = reconstructedOpen.replace(marker, translatedValue)
        }
      }

      return reconstructedOpen
    })

    // Replace the closing tag $id_
    if (mapEntry.type === 'paired') {
      const closeRegex = new RegExp(`\\$${id}_(?![\\d_])\\s*`, 'g')
      result = result.replace(closeRegex, mapEntry.close)
    }
  }

  return result
}
