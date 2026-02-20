/**
 * Utility functions for block-level translation.
 */

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
  legend: true
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
  code: true,
  pre: true,
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
    if (SEMANTIC_BLOCKS[node.name]) {
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
    return escapeHtml(node.data)
  }
  if (node.type === 'comment') {
    return `<!--${node.data}-->`
  }
  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    let html = `<${node.name}`
    if (node.attribs) {
      for (const [key, value] of Object.entries(node.attribs)) {
        // Safe attribute serialization
        const safeValue = escapeHtml(value || '')
        html += ` ${key}="${safeValue}"`
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
    // Only process blocks that actually have content
    const html = serializeNode({ children: block.children }) // Serialize children only
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

function escapeHtml (str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Updates a block with translated children.
 * @param {Object} block - The original AST block node.
 * @param {string} translatedHtml - The translated HTML string.
 * @param {Function} parseFn - Function to parse HTML string into AST nodes (e.g., coralite.parseHTML).
 */
export function reconstructBlock (block, translatedHtml, parseFn) {
  if (!translatedHtml) return

  const parsed = parseFn(translatedHtml)

  let newChildren = []
  if (parsed.root && parsed.root.children) {
    newChildren = parsed.root.children
  } else if (Array.isArray(parsed)) {
    newChildren = parsed
  } else if (parsed.children) {
    newChildren = parsed.children
  } else {
    // Fallback if parsing failed or returned weird structure
    return
  }

  // Update parent pointers
  block.children = newChildren
  newChildren.forEach(child => {
    child.parent = block
  })
}
