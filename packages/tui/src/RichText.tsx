import type { ReactNode } from "react";

const CODE_FENCE = /^```(?:([\w.+-]+))?\s*$/;

interface RichTextProps {
  text: string;
  color: string;
  codeColor: string;
}

interface Line {
  text: string;
  code: boolean;
  heading: boolean;
}

export function RichText({ text, color, codeColor }: RichTextProps): ReactNode {
  const lines: Line[] = [];
  let inCode = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const fence = CODE_FENCE.exec(rawLine.trim());
    if (fence) {
      inCode = !inCode;
      continue;
    }
    const heading = !inCode && /^#{1,6}\s+/.test(rawLine);
    lines.push({
      text: heading ? rawLine.replace(/^#{1,6}\s+/, "") : rawLine,
      code: inCode,
      heading,
    });
  }

  if (lines.length === 0) return null;
  return (
    <box style={{ flexDirection: "column" }}>
      {lines.map((line, index) => (
        <text
          key={`${index}-${line.text}`}
          fg={line.code ? codeColor : color}
          attributes={line.heading ? 1 : undefined}
        >
          {line.code ? `  ${line.text}` : renderListMarker(line.text)}
        </text>
      ))}
    </box>
  );
}

function renderListMarker(line: string): string {
  const match = /^(\s*)([-*+]|\d+\.)\s+/.exec(line);
  if (!match) return line;
  return `${match[1]}• ${line.slice(match[0].length)}`;
}
