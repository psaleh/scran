import { Badge } from '@astryxdesign/core/Badge'

// Astryx's categorical badge variants. A tag always hashes to the same
// colour, so "italian" looks identical everywhere without storing a colour.
const VARIANTS = ['blue', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow']

function variantFor(tag) {
  let hash = 0
  for (const ch of tag.toLowerCase()) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 997
  }
  return VARIANTS[hash % VARIANTS.length]
}

export default function TagBadge({ tag, onClick }) {
  const badge = <Badge label={tag} variant={variantFor(tag)} />
  if (!onClick) return badge
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Filter by tag ${tag}`}
      style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex' }}
    >
      {badge}
    </button>
  )
}
