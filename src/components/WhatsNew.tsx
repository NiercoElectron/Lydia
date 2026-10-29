import { useLanguage } from '../i18n'
import { releasesFor, REPOSITORY_FILES } from '../whatsNew'

// The start screen's "What's New?": the changes of each version (see whatsNew.ts), the newest open and the others
// closed below it, each opening with a click
export function WhatsNew() {
  const { t, locale } = useLanguage()
  return (
    <aside className="whats-new">
      <h2>{t("What's New?")}</h2>
      {releasesFor(locale).map((release, i) => (
        <details key={release.version} open={i === 0}>
          <summary>
            Lydia {release.version}{' '}
            <span className="hint">
              {new Date(`${release.date}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' })}
            </span>
          </summary>
          {release.summary && (
            <p>
              <Inline text={release.summary} />
            </p>
          )}
          {release.sections.map(section => (
            <section key={section.title}>
              <h3>{t(section.title)}</h3>
              <ul>
                {section.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      ))}
    </aside>
  )
}

// The changelog's bold text, code and links. A link to one of Lydia's files opens it on GitHub
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (!link) return part
    const address = /^https?:/.test(link[2]) ? link[2] : REPOSITORY_FILES + link[2]
    return (
      <a key={i} href={address} target="_blank" rel="noreferrer">
        {link[1]}
      </a>
    )
  })
}
