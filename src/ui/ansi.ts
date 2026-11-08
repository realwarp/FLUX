// Small, dependency-free ANSI and terminal-width helpers.

const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g

export function visibleWidth(value: string): number {
  return value.replace(ansiPattern, "").length
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return ""
  if (visibleWidth(value) <= width) return value
  if (width === 1) return "…"
  return `${value.slice(0, width - 1)}…`
}

export function wrapText(value: string, width: number): string[] {
  if (width <= 0) return [""]
  return value.split(/\r?\n/).flatMap((line) => {
    if (!line) return [""]
    const words = line.split(/\s+/)
    const lines: string[] = []
    let current = ""
    words.forEach((word) => {
      if (word.length > width) {
        if (current) lines.push(current)
        current = ""
        for (let index = 0; index < word.length; index += width) {
          lines.push(word.slice(index, index + width))
        }
        return
      }
      const next = current ? `${current} ${word}` : word
      if (next.length > width) {
        lines.push(current)
        current = word
        return
      }
      current = next
    })
    if (current || lines.length === 0) lines.push(current)
    return lines
  })
}

export function pad(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`
}

