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

export default function TagBadge({ tag }) {
  return <Badge label={tag} variant={variantFor(tag)} />
}
