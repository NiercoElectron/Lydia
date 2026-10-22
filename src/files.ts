// Current local date and time for file names, e.g. "2026-10-19_14-32-05"
export function timestamp() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

// Make the browser download a file by clicking a temporary link that points to it
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Free the memory a while later: some browsers cancel the download if the address is freed before they start reading
  // the file, and big project files take longer to start
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
