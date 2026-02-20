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
 * Recursively collects text nodes and translatable attributes from the DOM tree.
 * @param {Object} node - The current DOM node.
 * @param {Array} texts - The array to store collected text nodes and attributes.
 * @param {Array} ignoredTags - List of tags to ignore.
 * @param {Object} allowedAttributes - Map of attributes to translate.
 */
export function collectTextNodes (node, texts, ignoredTags = ['script', 'style'], allowedAttributes = {}) {
  // Collect text content
  if (node.type === 'text') {
    const text = node.data.trim()
    if (text.length > 0) {
      texts.push({
        type: 'text',
        node,
        text
      })
    }
  } else if ((node.type === 'tag' || node.type === 'root') && !ignoredTags.includes(node.name)) {
    // Collect attributes
    if (node.attribs) {
      for (const attrName in node.attribs) {
        if (Object.prototype.hasOwnProperty.call(node.attribs, attrName)) {
          const attrValue = node.attribs[attrName]
          if (!attrValue || !attrValue.trim()) continue

          // Check against allowed attributes
          // Format 1: 'alt': true (global attribute)
          // Format 2: 'meta[description]': true (shorthand for meta name="description" content="...")
          // Format 3: 'input[type=button]:value': true (CSS-like selector targeting specific attribute)

          let isAllowed = false

          // 1. Exact Global Match
          if (allowedAttributes[attrName] === true) {
            isAllowed = true
          }

          // Meta tag shorthand ('meta[description]' -> <meta name="description" content="...">)
          else if (node.name === 'meta' && attrName === 'content') {
            const name = node.attribs.name || node.attribs.property
            if (name && allowedAttributes[`meta[${name}]`]) {
              isAllowed = true
            }
          }

          // Complex selector match
          else {
            for (const key in allowedAttributes) {
              // Skip globals handled above
              if (!key.includes(':') && !key.includes('[')) {
                continue
              }

              // Check if key targets this attribute
              if (!key.endsWith(`:${attrName}`)) {
                continue
              }

              // Parse selector part: "input[type=button]" from "input[type=button]:value"
              const selector = key.slice(0, key.lastIndexOf(':'))

              if (matchesSelector(node, selector)) {
                isAllowed = true
                break
              }
            }
          }

          if (isAllowed) {
            texts.push({
              type: 'attribute',
              node,
              name: attrName,
              text: attrValue
            })
          }
        }
      }
    }

    // Recursion
    if (node.children) {
      for (const child of node.children) {
        collectTextNodes(child, texts, ignoredTags, allowedAttributes)
      }
    }
  }
}

/**
 * Helper to check if a node matches a simple CSS-like selector.
 * Supports: 'tag', 'tag[attr=value]', 'tag[attr]'
 */
function matchesSelector (node, selector) {
  // Split tag and attributes
  const bracketIndex = selector.indexOf('[')

  let tagName = selector
  let attrs = null

  if (bracketIndex !== -1) {
    tagName = selector.slice(0, bracketIndex)
    const attrPart = selector.slice(bracketIndex + 1, selector.length - 1) // remove [ and ]
    // Handle "type=button" or just "required"
    const eqIndex = attrPart.indexOf('=')
    if (eqIndex !== -1) {
      attrs = {
        name: attrPart.slice(0, eqIndex),
        value: attrPart.slice(eqIndex + 1)
      }
    } else {
      attrs = {
        name: attrPart,
        value: null
      }
    }
  }

  if (tagName && node.name !== tagName) return false

  if (attrs) {
    const nodeAttrVal = node.attribs[attrs.name]
    if (nodeAttrVal === undefined) return false
    if (attrs.value !== null && nodeAttrVal !== attrs.value) return false
  }

  return true
}

/**
 * Computes the MD5 hash of a string.
 * @param {string} content
 * @returns {string}
 */
export function computeHash (content) {
  return createHash('md5').update(content).digest('hex')
}

export const DEFAULT_ALLOWED_ATTRIBUTES = {
  // --- Core / Global ---
  alt: true,
  title: true,

  // --- Forms & Inputs ---
  placeholder: true,
  label: true,
  'input[type=button]:value': true,
  'input[type=submit]:value': true,
  'input[type=reset]:value': true,

  // --- Accessibility (ARIA) ---
  'aria-label': true,
  'aria-description': true,
  'aria-valuetext': true,
  'aria-roledescription': true,
  'aria-placeholder': true,

  // --- Tables & Misc ---
  abbr: true,
  summary: true,

  // --- Meta Tags (SEO & Social) ---
  'meta[description]': true,
  'meta[keywords]': true,
  'meta[author]': true,

  // Open Graph
  'meta[og:title]': true,
  'meta[og:description]': true,
  'meta[og:site_name]': true,

  // Twitter Cards
  'meta[twitter:title]': true,
  'meta[twitter:description]': true,
  'meta[twitter:image:alt]': true
}
