import changelog from '../CHANGELOG.md?raw'
import changelogPtBR from './translations/changelog.pt-BR.md?raw'
import changelogEs from './translations/changelog.es.md?raw'

// What changed in each version, for the start screen's "What's New?" (see WhatsNew.tsx), read from CHANGELOG.md as
// it is when Lydia is built, so it follows every new version by itself

// Where Lydia's files are on GitHub: links in the changelog to its documents (docs/decisions.md…) open there
export const REPOSITORY_FILES = 'https://github.com/NiercoElectron/Lydia/blob/main/'

// A version: its number, its date, the sentence that sums it up (some have one) and its lists of changes, each under
// a title ("Added", "Changed", "Fixed"…). The text is the changelog's Markdown
export type Release = {
  version: string
  date: string
  summary: string
  sections: { title: string; items: string[] }[]
}

// The versions in the changelog, newest first, leaving out what isn't released yet. The changelog is written as Keep a
// Changelog says: "## [version] - date", then "### Title" and a list of "- " items, each going on in lines that start
// with two spaces. The links' addresses at the end are left out
export function readReleases(text: string): Release[] {
  const releases: Release[] = []
  let release: Release | null = null
  let items: string[] | null = null // the list being read, if any
  for (const line of text.split(/\r?\n/)) {
    const heading = /^## \[(\d+\.\d+\.\d+)\] - (\S+)/.exec(line)
    if (heading) {
      release = { version: heading[1], date: heading[2], summary: '', sections: [] }
      releases.push(release)
      items = null
    } else if (line.startsWith('## ')) {
      release = null // "Unreleased"
    } else if (!release) {
      continue
    } else if (line.startsWith('### ')) {
      items = []
      release.sections.push({ title: line.slice(4), items })
    } else if (items && line.startsWith('- ')) {
      items.push(line.slice(2))
    } else if (items && items.length > 0 && line.startsWith('  ')) {
      items[items.length - 1] += ' ' + line.trim()
    } else if (!items && line.trim()) {
      release.summary += (release.summary ? ' ' : '') + line.trim()
    }
  }
  return releases
}

export const releases = readReleases(changelog)

const localizedReleases: Record<string, Map<string, Release>> = {
  'pt-BR': new Map(readReleases(changelogPtBR).map(release => [release.version, release])),
  es: new Map(readReleases(changelogEs).map(release => [release.version, release])),
}

// New releases remain visible in English until their translation is added.
export function releasesFor(locale: string): Release[] {
  const translated = localizedReleases[locale]
  return translated ? releases.map(release => translated.get(release.version) ?? release) : releases
}
