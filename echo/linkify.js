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
