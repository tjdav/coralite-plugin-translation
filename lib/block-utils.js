import { parseHTML } from 'coralite'

/**
 * Utility functions for block-level translation.
 */

const TRANSLATABLE_ATTRS = new Set(['alt', 'title', 'placeholder', 'aria-label'])

// Semantic blocks that are definitely translation units if they contain any text
const SEMANTIC_BLOCKS = {
  p: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  li: true,
  blockquote: true,
  td: true,
  th: true,
  figcaption: true,
  caption: true,
  dt: true,
  dd: true,
  summary: true,
  option: true,
  legend: true,
  code: true,
  pre: true
}

// Container blocks that might be translation units ONLY if they contain direct text.
// Otherwise, we should traverse into them.
const CONTAINER_BLOCKS = {
  div: true,
  span: true,
  section: true,
  article: true,
  aside: true,
  header: true,
  footer: true,
  main: true,
  form: true,
  nav: true,
  figure: true,
  details: true
}

// Tags to skip entirely (no translation inside).
const SKIP_TAGS = {
  script: true,
  style: true,
  svg: true,
  noscript: true,
  iframe: true,
  template: true
}

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


/**
 * Traverses the AST to find block-level elements that contain text.
 * @param {Object} node - The AST node to start from.
 * @param {Array} blocks - The array to collect translatable blocks into.
 */
export function findTranslatableBlocks (node, blocks) {
  if (!node) return

  // Skip ignored tags
  if (SKIP_TAGS[node.name]) return

  let isBlock = false

  if (node.type === 'tag') {
    if (hasTranslatableAttributes(node)) {
      isBlock = true
    } else if (SEMANTIC_BLOCKS[node.name]) {
      if (hasTextContent(node)) {
        isBlock = true
      }
    } else if (CONTAINER_BLOCKS[node.name]) {
      if (hasDirectTextContent(node)) {
        isBlock = true
      }
    }
  }

  if (isBlock) {
    blocks.push(node)
    // Stop traversing children because the whole block is taken
    return
  }

  // Continue traversing children
  if (node.children) {
    for (const child of node.children) {
      findTranslatableBlocks(child, blocks)
    }
  }
}

/**
 * Checks if a node has any translatable attributes.
 * @param {Object} node
 * @returns {boolean}
 */
export function hasTranslatableAttributes (node) {
  if (!node.attribs) return false
  for (const attr of TRANSLATABLE_ATTRS) {
    if (node.attribs[attr] && node.attribs[attr].trim().length > 0) {
      return true
    }
  }
  return false
}

/**
 * Checks if a node or its descendants have any text content.
 * @param {Object} node
 * @returns {boolean}
 */
function hasTextContent (node) {
  if (node.type === 'text') {
    return node.data && node.data.trim().length > 0
  }
  if (node.children) {
    return node.children.some(child => hasTextContent(child))
  }
  return false
}

/**
 * Checks if a node has direct text content (ignoring whitespace).
 * @param {Object} node
 * @returns {boolean}
 */
function hasDirectTextContent (node) {
  if (!node.children) return false
  return node.children.some(child => child.type === 'text' && child.data.trim().length > 0)
}

/**
 * Serializes an AST node (and its children) back to an HTML string.
 * @param {Object} node
 * @returns {string}
 */
export function serializeNode (node) {
  if (node.type === 'text') {
    return node.data
  }
  if (node.type === 'comment') {
    return `<!--${node.data}-->`
  }
  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    let html = `<${node.name}`
    if (node.attribs) {
      for (const [key, value] of Object.entries(node.attribs)) {
        html += ` ${key}="${value}"`
      }
    }

    // Void elements
    if (voidTags[node.name]) {
      html += '>'
      return html
    }

    html += '>'
    if (node.children) {
      html += node.children.map(serializeNode).join('')
    }
    html += `</${node.name}>`
    return html
  }
  // Root or fragments
  if (node.children) {
    return node.children.map(serializeNode).join('')
  }
  return ''
}

/**
 * Wraps blocks in XML chunks for the LLM.
 * @param {Array} blocks - Array of block AST nodes.
 * @returns {Object} { payload: string, mapping: Array }
 */
export function prepareTranslationPayload (blocks) {
  let payload = ''
  const mapping = []

  blocks.forEach((block, index) => {
    const useOuter = hasTranslatableAttributes(block)
    const html = useOuter ? serializeNode(block) : serializeNode({ children: block.children })

    if (!html.trim()) return

    payload += `<chunk id="${index}">\n${html}\n</chunk>\n`
    mapping.push({
      index,
      block,
      originalHtml: html
    })
  })

  return {
    payload,
    mapping
  }
}

/**
 * Extracts translated content from the LLM response.
 * @param {string} response
 * @returns {Map<number, string>} Map of chunk ID to translated HTML.
 */
export function parseTranslatedPayload (response) {
  const translations = new Map()
  // Regex to match <chunk id="...">(...)</chunk>
  // Using [\s\S]*? to match across newlines non-greedily
  const regex = /<chunk id="(\d+)">([\s\S]*?)<\/chunk>/g
  let match

  while ((match = regex.exec(response)) !== null) {
    const id = parseInt(match[1], 10)
    const content = match[2].trim()
    translations.set(id, content)
  }

  return translations
}

/**
 * Updates a block with translated children or attributes.
 * @param {Object} block - The original AST block node.
 * @param {string} translatedHtml - The translated HTML string.
 * @param {Function} parseFn - Function to parse HTML string into AST nodes (e.g., coralite.parseHTML).
 * @param {boolean} [useOuter=false] - Whether the translation includes the outer tag (for attribute translation).
 */
export function reconstructBlock (block, translatedHtml, parseFn, useOuter = false) {
  if (!translatedHtml) return

  const parsed = parseFn(translatedHtml)

  let newChildren = []
  let newAttribs = null

  if (parsed.root && parsed.root.children) {
    const rootChildren = parsed.root.children
    // Filter for tag nodes to ignore whitespace text nodes
    const tagNodes = rootChildren.filter(c => c.type === 'tag')

    if (useOuter && tagNodes.length === 1) {
      const rootNode = tagNodes[0]
      newChildren = rootNode.children || []
      newAttribs = rootNode.attribs
    } else {
      newChildren = rootChildren
    }
  } else {
    // Fallback if parsing failed or returned weird structure
    return
  }

  // Update parent pointers
  block.children = newChildren
  newChildren.forEach(child => {
    child.parent = block
  })

  // Update attributes safely if applicable
  if (useOuter && newAttribs) {
    // Only update translatable attributes to preserve critical attributes (e.g. href, class)
    // in case the translation service omitted them or restoreAttributes failed.
    for (const attr of TRANSLATABLE_ATTRS) {
      if (Object.prototype.hasOwnProperty.call(newAttribs, attr)) {
        block.attribs[attr] = newAttribs[attr]
      }
    }
  }
}

/**
 * Recursively collects all tag nodes from an AST node.
 * @param {Object} node
 * @param {Array} list
 * @returns {Array}
 */
function getFlatTags (node, list = []) {
  if (!node) return list
  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    list.push(node)
  }
  if (node.children) {
    for (const child of node.children) {
      getFlatTags(child, list)
    }
  }
  return list
}

/**
 * Restores forbidden attributes from source HTML to translated HTML,
 * preserving allowed translated attributes.
 *
 * @param {string} sourceHtml
 * @param {string} translatedHtml
 * @returns {string} The potentially modified translated HTML.
 */
export function restoreAttributes (sourceHtml, translatedHtml) {
  if (!translatedHtml) return translatedHtml

  let sourceRoot
  let translatedRoot

  try {
    sourceRoot = parseHTML(sourceHtml).root
    translatedRoot = parseHTML(translatedHtml).root
  } catch (err) {
    return translatedHtml
  }

  const sourceTags = getFlatTags(sourceRoot)
  const translatedTags = getFlatTags(translatedRoot)

  // Structural mismatch check
  if (sourceTags.length !== translatedTags.length) {
    return translatedHtml
  }

  for (let i = 0; i < sourceTags.length; i++) {
    const sTag = sourceTags[i]
    const tTag = translatedTags[i]

    // Tag name mismatch
    if (sTag.name !== tTag.name) {
      return translatedHtml
    }

    const sourceAttrs = sTag.attribs || {}
    const targetAttrs = tTag.attribs || {}
    const newAttrs = { ...sourceAttrs } // Start with a clone of source attributes

    // Restore allowed translated attributes
    for (const attr of TRANSLATABLE_ATTRS) {
      if (Object.prototype.hasOwnProperty.call(targetAttrs, attr)) {
        newAttrs[attr] = targetAttrs[attr]
      }
    }

    tTag.attribs = newAttrs
  }

  return serializeNode(translatedRoot)
}
