// Ключи иероглифа: компоненты, которые входят в 214 ключей Канси или в их
// варианты (亻 ← 人, 氵 ← 水…), и номера черт, которые каждый из них занимает.
//
// Откуда берутся границы. acjk-запись — это последовательность «порций»:
// «明⿰日.4月4» значит 4 черты 日, затем 4 черты 月. Порции идут в порядке
// построения, поэтому накопленный счёт и есть номера черт в SVG. Составной
// компонент раскрывается его собственной записью, и его части получают
// подотрезок родительского диапазона — так находятся и вложенные ключи.

import { strokeGroups, strokeNames } from "./shared.js";

// Индекс ключей: символ → { character, base, bases, variant }.
//   base    — ключ Канси, к которому относится символ (亻 → 人);
//   bases   — все такие ключи («阝 (阜 or 邑)» относится к двум);
//   variant — true, если сам символ не из 214, а его вариант.
// Варианты — это поле `radical` словаря в виде «亻 (人)»: так записаны и
// 氵 и 艹, и упрощённые 贝 车 门 讠 钅. Берём любую запись, где слева стоит
// сам символ, а справа — один из 214 ключей.
export function buildKeyIndex(extras, entries = [], { extraVariants = {}, excluded = [] } = {}) {
  const index = new Map();
  for (const item of extras.sets.radical.characters) {
    index.set(item.character, { character: item.character, base: item.character, bases: [item.character], variant: false });
  }
  for (const item of [...entries, ...extras.sets.component.characters]) {
    if (index.has(item.character)) continue;
    const match = /^(\S+)\s+\(([^)]+)\)$/u.exec(item.radical || "");
    if (!match || match[1] !== item.character) continue;
    const bases = match[2].split(/\s+or\s+/u).filter((base) => index.get(base)?.variant === false);
    if (bases.length) index.set(item.character, { character: item.character, base: bases[0], bases, variant: true });
  }
  // Ручные дополнения банка (bank/keys.json): варианты, которых нет в словаре
  // в виде «X (Y)», и символы, которые ключами считать не нужно.
  for (const [character, base] of Object.entries(extraVariants)) {
    if (index.get(base)?.variant !== false) throw new Error(`Вариант ${character}: ${base} не входит в 214 ключей`);
    index.set(character, { character, base, bases: [base], variant: true });
  }
  for (const character of excluded) index.delete(character);
  return index;
}

export function lengthOf(character, resolve, cache) {
  if (!cache.has(character)) {
    const acjk = resolve(character);
    cache.set(character, acjk ? strokeNames(acjk, resolve).length : 0);
  }
  return cache.get(character);
}

// Раскладка порций одной записи: каждой порции — отрезок [start, end) в
// локальной нумерации и `from` — с какой по счёту черты компонента она берёт
// (у разорванного компонента вроде 囗 в 国 вторая порция начинается не с нуля).
export function layoutGroups(groups, resolve, cache) {
  const named = groups.filter((group) => group.type !== "marker");
  const totals = new Map();
  for (const group of named) {
    totals.set(group.character, (totals.get(group.character) || 0) + group.count);
  }
  const shared = new Set();
  for (const [character, total] of totals) {
    if (total >= 2 && lengthOf(character, resolve, cache) === total) shared.add(character);
  }
  const used = new Map();
  const placed = [];
  let cursor = 0;
  for (const group of groups) {
    if (group.type === "marker") {
      // Висящий символ — одна черта, только если он сам одиночный.
      const size = lengthOf(group.character, resolve, cache) === 1 ? 1 : 0;
      cursor += size;
      continue;
    }
    const from = shared.has(group.character) ? (used.get(group.character) || 0) : 0;
    if (shared.has(group.character)) used.set(group.character, from + group.count);
    placed.push({ group, start: cursor, end: cursor + group.count, from, split: shared.has(group.character) });
    cursor += group.count;
  }
  return placed;
}

// Дерево компонентов с отрезками черт. depth 0 — непосредственные части
// иероглифа, глубже — части частей.
function spansFor(acjk, resolve, cache, stack, depth, keyIndex, under) {
  const nodes = [];
  for (const placed of layoutGroups(strokeGroups(acjk), resolve, cache)) {
    const { group } = placed;
    nodes.push({
      character: group.character,
      start: placed.start,
      end: placed.end,
      depth,
      main: Boolean(group.radical),
      split: placed.split,
      under
    });
    const own = resolve(group.character);
    if (!own || stack.has(group.character)) continue;
    stack.add(group.character);
    for (const child of spansFor(own, resolve, cache, stack, depth + 1, keyIndex, under || keyIndex.has(group.character))) {
      if (child.start < placed.from || child.end > placed.from + group.count) continue;
      const shift = placed.start - placed.from;
      // Компонент, который целиком совпал с собой же («一.1» → 一), не нужен.
      if (child.character === group.character && child.end - child.start === group.count) continue;
      nodes.push({ ...child, start: child.start + shift, end: child.end + shift, depth: child.depth });
    }
    stack.delete(group.character);
  }
  return nodes;
}

// Кандидаты в ключи для иероглифа, в порядке появления в записи.
//   strokes — 1-based номера черт; nested — ключ лежит внутри другого компонента;
//   main — ключ помечен в acjk точкой как главный ключ иероглифа.
// Одиночные черты (一 丨 丿…) ключами не считаются: для них есть другое задание.
// nested — ключ лежит внутри другого ключа (冂 в 囗): такой лишь шумит, и по
// умолчанию его прячут.
export function findKeys(character, resolve, keyIndex, { minStrokes = 2 } = {}) {
  const acjk = resolve(character);
  if (!acjk) return [];
  const cache = new Map();
  const total = lengthOf(character, resolve, cache);
  const result = [];
  const taken = new Map();
  for (const node of spansFor(acjk, resolve, cache, new Set([character]), 0, keyIndex, false)) {
    const info = keyIndex.get(node.character);
    const size = node.end - node.start;
    if (!info || size >= total) continue;
    const strokes = Array.from({ length: size }, (_, offset) => node.start + offset + 1);
    // Разорванный компонент (囗 в 国) — один ключ из нескольких порций.
    const merged = node.split ? taken.get(`${node.character}@${node.depth}`) : null;
    if (merged) {
      merged.strokes.push(...strokes);
      continue;
    }
    const key = {
      character: node.character,
      base: info.base,
      variant: info.variant,
      strokes,
      nested: node.under,
      main: node.main,
      under: node.under
    };
    if (node.split) taken.set(`${node.character}@${node.depth}`, key);
    // Один и тот же набор черт и один и тот же символ дважды не нужен.
    const signature = `${key.character}:${strokes.join(",")}`;
    if (result.some((other) => `${other.character}:${other.strokes.join(",")}` === signature)) continue;
    result.push(key);
  }
  return result
    .filter((key) => key.strokes.length >= minStrokes)
    .map((key, order) => ({ id: `k${order + 1}`, ...key }));
}
