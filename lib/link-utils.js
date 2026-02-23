import { extname } from 'node:path'

/**
 * Processes the AST to prefix relative links with the target language.
 * @param {Object} node - The AST node (root or element).
 * @param {string} targetLang - The target language code (e.g., 'fr').
 * @param {string} relativePagePath - The relative path of the current page (e.g., 'blog/index.html').
 */
export function processRelativeLinks (node, targetLang, relativePagePath) {
  if (!node) return

  if (node.name === 'a' && node.attribs && node.attribs.href) {
    const newHref = prefixPath(node.attribs.href, targetLang, relativePagePath)
    if (newHref) {
      node.attribs.href = newHref
    }
  }

  if (node.children) {
    for (const child of node.children) {
      processRelativeLinks(child, targetLang, relativePagePath)
    }
  }
}

/**
 * Prefixes a relative path with the target language.
 * @param {string} href - The original href.
 * @param {string} targetLang - The target language.
 * @param {string} relativePagePath - The relative path of the current page.
 * @returns {string|null} The new href, or null if no change.
 */
function prefixPath (href, targetLang, relativePagePath) {
  // 1. Skip ignore cases
  if (href.startsWith('#')) return null
  if (href.startsWith('mailto:')) return null
  if (href.startsWith('tel:')) return null
  if (href.match(/^[a-z]+:/)) return null // Absolute URL with protocol
  if (href.startsWith('//')) return null // Protocol-relative

  // 2. Normalize relativePagePath to forward slashes for URL API
  // We assume relativePagePath is relative to the root of the site (or pages dir)
  // Ensure it doesn't start with / for concatenation logic, or just handle it.
  // relative(...) returns path without leading / usually.
  const normalizedPagePath = relativePagePath.replace(/\\/g, '/')

  // 3. Construct Base URL
  // We use a dummy domain.
  // If normalizedPagePath is 'index.html', base is 'http://dummy.com/index.html'
  // If normalizedPagePath is 'blog/post.html', base is 'http://dummy.com/blog/post.html'
  const base = new URL(normalizedPagePath, 'http://dummy.com/')

  try {
    // 4. Resolve href against base
    const url = new URL(href, base)

    // 5. Check origin (must be same as dummy)
    if (url.origin !== 'http://dummy.com') return null

    // 6. Check extension
    const pathname = url.pathname
    const ext = extname(pathname)

    // logic: allowed if extension is empty or .html
    if (ext !== '' && ext !== '.html') return null

    // 7. Construct new path
    // pathname always starts with /
    // targetLang should be prepended.
    // e.g. /fr/blog.html
    const newPathname = `/${targetLang}${pathname}`

    // 8. Return full relative path + query + hash
    // We strip the origin.
    return newPathname + url.search + url.hash
  } catch (e) {
    // Invalid URL
    return null
  }
}
