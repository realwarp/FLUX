import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { shouldUseColor } from "./theme.js";

const pixelLetters = {
  F: ["11111", "11000", "11000", "11110", "11000"],
  L: ["11000", "11000", "11000", "11000", "11111"],
  U: ["11011", "11011", "11011", "11011", "01110"],
  X: ["11011", "01110", "00100", "01110", "11011"],
} as const;

type LogoOptions = {
  color?: boolean;
  ascii?: boolean;
  scale?: 1 | 2;
};

export function renderFluxPixelLogo(width: number, frame = 0, options: LogoOptions = {}): string[] {
  const safeWidth = Math.max(1, width);
  const ascii = options.ascii ?? (process.env.FLUX_ASCII === "1" || process.env.TERM === "dumb");
  const color = options.color ?? shouldUseColor();
  const scale = options.scale ?? (safeWidth >= 46 ? 2 : 1);
  const bitmap = createBitmap(scale, safeWidth < 23 * scale);
  const rows = renderBitmapRows(bitmap, scale, frame, color, ascii);
  const logoWidth = rows.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  const offset = Math.max(0, Math.floor((safeWidth - logoWidth) / 2));
  return rows.map((line) => truncateToWidth(`${" ".repeat(offset)}${line}`, safeWidth));
}

export function renderFluxHeaderWordmark(frame = 0, options: Omit<LogoOptions, "scale"> = {}): string[] {
  const ascii = options.ascii ?? (process.env.FLUX_ASCII === "1" || process.env.TERM === "dumb");
  const color = options.color ?? shouldUseColor();
  return renderBitmapRows(createBitmap(1, false), 1, frame, color, ascii);
}

export function shouldAnimateFluxLogo(
  isTTY = Boolean(process.stdout.isTTY),
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTTY &&
    shouldUseColor(environment) &&
    environment.FLUX_DISABLE_ANIMATION !== "1";
}

function createBitmap(scale: 1 | 2, compact: boolean): { rows: string[]; colors: number[] } {
  const gap = compact ? "" : " ";
  const rows: string[] = [];
  const colors: number[] = [];
  for (let row = 0; row < pixelLetters.F.length; row++) {
    let line = "";
    let colorIndex = 0;
    for (const letter of ["F", "L", "U", "X"] as const) {
      if (line) {
        line += gap;
        if (gap) colors.push(-1);
      }
      for (const pixel of pixelLetters[letter][row]!) {
        line += pixel;
        colors.push(colorIndex++);
      }
    }
    rows.push(line);
  }
  return { rows, colors };
}

function renderBitmapRows(
  bitmap: { rows: string[]; colors: number[] },
  scale: 1 | 2,
  frame: number,
  color: boolean,
  ascii: boolean,
): string[] {
  const expandedRows = bitmap.rows.flatMap((row) => Array.from({ length: scale }, () => row));
  const expandedWidth = (bitmap.rows[0]?.length ?? 0) * scale;
  const expandedColors = Array.from({ length: expandedWidth }, (_, column) =>
    bitmap.colors[Math.floor(column / scale)] ?? -1,
  );
  const expandedRow = (row: string): string[] => Array.from(row, (pixel) =>
    Array.from({ length: scale }, () => pixel).join(""),
  );

  if (ascii) {
    return expandedRows.flatMap((row) => {
      const pixels = expandedRow(row).map((pixel) => pixel === "1" ? "#" : " ");
      return [pixels.map((pixel, column) => colorAsciiPixel(pixel, expandedColors[column]!, frame, color)).join("")];
    });
  }

  if (expandedRows.length % 2 !== 0) expandedRows.push(" ".repeat(bitmap.rows[0]?.length ?? 0));
  const output: string[] = [];
  for (let row = 0; row < expandedRows.length; row += 2) {
    const line = Array.from({ length: expandedWidth }, (_, column) => {
      const logicalColumn = Math.floor(column / scale);
      const top = expandedRows[row]?.[logicalColumn] === "1";
      const bottom = expandedRows[row + 1]?.[logicalColumn] === "1";
      const glyph = top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
      const pixel = expandedColors[column] ?? -1;
      return color && pixel >= 0 && glyph !== " " ? pixelColor(glyph, pixel, frame) : glyph;
    }).join("");
    output.push(line);
  }
  return output;
}

function colorAsciiPixel(pixel: string, column: number, frame: number, color: boolean): string {
  if (!color || pixel === " " || column < 0) return pixel;
  return pixelColor(pixel, column, frame);
}

function pixelColor(glyph: string, column: number, frame: number): string {
  const progress = column / 19;
  const violet = [113, 78, 226];
  const magenta = [209, 65, 174];
  const center = (frame * 0.3) % 20;
  const distance = Math.min(Math.abs(column - center), 20 - Math.abs(column - center));
  const highlight = Math.max(0, 1 - distance / 4);
  const shimmer = 0.97 + Math.sin(frame * 0.12 + column * 0.18) * 0.025;
  const rgb = violet.map((value, index) => {
    const gradient = value + (magenta[index]! - value) * progress;
    const cyan = [98, 205, 235][index]!;
    return Math.round((gradient * (1 - highlight) + cyan * highlight) * shimmer);
  });
  return `\u001b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${glyph}\u001b[0m`;
}
