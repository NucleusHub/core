// Split a string into plain-text and link segments on http(s) URLs, so message
// text can render detected URLs as real (new-tab) links without dumping raw HTML
// into the DOM. Returns an array of { text, href? } — segments with `href` are
// links, the rest are plain text. Trailing sentence punctuation is kept out of
// the link so "see https://x.com." doesn't swallow the period.
const URL_RE = /(https?:\/\/[^\s<]+)/g
const TRAILING = /[.,!?;:'")\]}]+$/

export function linkify(text) {
  const str = String(text ?? '')
  const parts = []
  let last = 0
  for (const m of str.matchAll(URL_RE)) {
    if (m.index > last) parts.push({ text: str.slice(last, m.index) })
    let url = m[0]
    const trail = url.match(TRAILING)
    const tail = trail ? trail[0] : ''
    if (tail) url = url.slice(0, -tail.length)
    parts.push({ text: url, href: url })
    if (tail) parts.push({ text: tail })
    last = m.index + m[0].length
  }
  if (last < str.length) parts.push({ text: str.slice(last) })
  return parts
}
