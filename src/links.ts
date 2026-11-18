// Lydia's pages on GitHub, opened in the browser (the desktop app sends them there, see electron/main.mjs)
export const GITHUB_URL = 'https://github.com/NiercoElectron/Lydia'
const FILES_URL = `${GITHUB_URL}/blob/main`
export const GUIDE_URL = `${FILES_URL}/docs/guide.md`
export const CHANGES_URL = `${FILES_URL}/CHANGELOG.md`
// GitHub's form for a new issue, with the Bug template (see .github/ISSUE_TEMPLATE/bug.yml)
export const BUG_URL = `${GITHUB_URL}/issues/new?template=bug.yml`
