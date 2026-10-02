// Картинка иероглифа для ученика собирается не из исходного SVG AnimCJK, а
// заново — из одних контуров: <path d="…"> под currentColor. В такой картинке
// нет ни id с номером черты и codePoint, ни медиан, ни анимации, ни порядка:
// контуры перемешаны. Поэтому по самому файлу нельзя ни узнать иероглиф, ни
// прочитать порядок черт, ни понять, какая именно черта убрана.
//
// Исходный формат: <path id="z<codePoint>d<n>" d="…"/> — контур черты n.

import { makeRandom, shuffle } from "./shared.js";

const OUTLINE = /<path\s+id="z\d+d(\d+)"\s+d="([^"]+)"\s*\/>/gu;
const MEDIAN_START = /clip-path="url\(#z\d+c(\d+)a?\)"[^>]*?\sd="M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/gu;
// Палитра пропусков — та же, что --m0…--m4 в кабинете олимпиады: цвет рамки на
// картинке совпадает с цветом номера в строке вариантов.
export const MARK_COLORS = Object.freeze(["#E6A046", "#C25A3E", "#46806A", "#5B86A8", "#8A6BB0"]);
const MARK_INK = Object.freeze(["#1B2455", "#fff", "#fff", "#fff", "#fff"]);
const VIEW_BOX = "0 0 1024 1024";

// Контуры черт: [{ n, d, start }], n — номер черты (1-based), в порядке
// построения; start — [x, y], откуда черта начинается (первая точка медианы).
// Нужен только редактору — подписать черту; ученику он не уезжает.
export function extractOutlines(svgText) {
  const starts = new Map([...svgText.matchAll(MEDIAN_START)]
    .map((match) => [Number(match[1]), [Number(match[2]), Number(match[3])]]));
  const outlines = [...svgText.matchAll(OUTLINE)].map((match) => ({
    n: Number(match[1]), d: match[2], start: starts.get(Number(match[1])) || null
  }));
  outlines.sort((a, b) => a.n - b.n);
  return outlines;
}

// Рамка пути по всем числам команд. Для рамки пропуска её достаточно: контрольные
// точки кривых лежат чуть шире самой кривой, но не дальше — запас всё равно нужен.
export function pathBounds(d) {
  const numbers = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gu) || []).map(Number);
  if (numbers.length < 2) return null;
  const commands = [...d.matchAll(/([MLCQSTHVZA])([^MLCQSTHVZA]*)/giu)];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const point = (x, y) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const [, command, args] of commands) {
    const values = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/gu) || []).map(Number);
    const upper = command.toUpperCase();
    // AnimCJK пишет только абсолютные M, L, C, Q, Z; остальные не поддержаны.
    if (command !== upper) throw new Error(`Относительная команда ${command} в контуре не поддерживается`);
    if (upper === "H") values.forEach((x) => point(x, minY === Infinity ? 0 : minY));
    else if (upper === "V") values.forEach((y) => point(minX === Infinity ? 0 : minX, y));
    else if (upper !== "Z") {
      for (let index = 0; index + 1 < values.length; index += 2) point(values[index], values[index + 1]);
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

export function unionBounds(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  return {
    minX: Math.min(...list.map((box) => box.minX)),
    minY: Math.min(...list.map((box) => box.minY)),
    maxX: Math.max(...list.map((box) => box.maxX)),
    maxY: Math.max(...list.map((box) => box.maxY))
  };
}

// Рамка пропуска: чуть шире убранных черт и не меньше MIN, чтобы метка с
// номером поместилась и у короткой черты.
function markBox(bounds, pad = 28, min = 110) {
  let width = bounds.maxX - bounds.minX + pad * 2;
  let height = bounds.maxY - bounds.minY + pad * 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  width = Math.max(width, min);
  height = Math.max(height, min);
  return { x: Math.round(centerX - width / 2), y: Math.round(centerY - height / 2), width: Math.round(width), height: Math.round(height) };
}

// SVG для ученика. hidden — номера убранных черт; marks — пропуски, которые
// надо пометить рамкой с номером: [{ label, strokes: [номера] }]. Рамки видны
// ученику, поэтому из них нельзя узнать ничего, кроме места пропуска.
// seed делает перемешивание воспроизводимым: картинка в предпросмотре и в
// выгруженном файле байт-в-байт одна и та же.
export function buildGlyphSvg(outlines, { hidden = [], marks = [], seed = "glyph" } = {}) {
  const hide = new Set(hidden);
  const kept = outlines.filter((outline) => !hide.has(outline.n));
  const paths = shuffle(kept, makeRandom(seed))
    .map((outline) => `<path d="${outline.d}"/>`)
    .join("");
  const boxes = marks.map(({ label, strokes }) => {
    const bounds = unionBounds(outlines.filter((o) => strokes.includes(o.n)).map((o) => pathBounds(o.d)));
    return bounds ? { label, box: markBox(bounds) } : null;
  }).filter(Boolean);
  const gaps = boxes.map(({ label, box }) => {
    const { x, y, width, height } = box;
    const radius = 34;
    const color = MARK_COLORS[(Number(label) - 1 + 5) % 5];
    const ink = MARK_INK[(Number(label) - 1 + 5) % 5];
    const cx = x + radius * 0.7;
    const cy = y + radius * 0.7;
    return `<g class="gap-mark"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="none" stroke="${color}" stroke-width="10" stroke-dasharray="26 18"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"/>`
      + `<text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="46" font-weight="700" font-family="sans-serif" fill="${ink}">${label}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}" role="img" aria-label="Иероглиф"><g fill="currentColor">${paths}</g>${gaps}</svg>`;
}

// Одна базовая черта (для банка): только путь, без обёртки.
export function strokeOutlinePath(svgText) {
  const [outline] = extractOutlines(svgText);
  return outline ? outline.d : null;
}
