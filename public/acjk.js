// Разбор acjk-нотации AnimCJK в упорядоченный список названий черт.
//
// Формат: <иероглиф><выражение>, где выражение — последовательность элементов.
//   оператор ⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻   группирует, но черт не добавляет
//   компонент <символ> [~похож] [.] [:[общий с …]] [.] [:] <число>
//   число — сколько черт компонент занимает здесь
//
// Итог проверяется по данным: сумма всех чисел выражения равна числу черт в
// SVG для всех 1201 иероглифа HSK. Метки «.» и «:» не меняют счёт — они лишь
// помечают, что черта общая с другим компонентом и потому названа дважды.

export const OPERATOR_ARITY = Object.freeze({
  "⿲": 3, "⿳": 3,
  "⿰": 2, "⿱": 2, "⿴": 2, "⿵": 2, "⿶": 2,
  "⿷": 2, "⿸": 2, "⿹": 2, "⿺": 2, "⿻": 2
});

export const ACJK_MARKS = Object.freeze({ radical: ".", shared: ":", similar: "~" });

export class AcjkSyntaxError extends SyntaxError {
  constructor(message, source, index) {
    super(`${message} at position ${index}: ${JSON.stringify(source.slice(Math.max(0, index - 12), index + 12))}`);
    this.name = "AcjkSyntaxError";
    this.source = source;
    this.index = index;
  }
}

export function isAcjkOperator(character) {
  return Object.hasOwn(OPERATOR_ARITY, character);
}

function readCodePoint(source, state) {
  if (state.index >= source.length) {
    throw new AcjkSyntaxError("Unexpected end of input", source, state.index);
  }
  const character = String.fromCodePoint(source.codePointAt(state.index));
  state.index += character.length;
  return character;
}

function readCount(source, state) {
  const match = source.slice(state.index).match(/^\d+/u);
  if (!match) throw new AcjkSyntaxError("Expected a stroke count", source, state.index);
  state.index += match[0].length;
  const count = Number.parseInt(match[0], 10);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new AcjkSyntaxError(`Invalid stroke count ${match[0]}`, source, state.index - match[0].length);
  }
  return count;
}

// Метки идут в любом сочетании и повторяются: «戈.:1», «乜:𠃌1», «𫝀:二.:1».
// Они не меняют счёт черт — только помечают, что черта общая с другим
// компонентом, а значит названа в нотации дважды.
function readMarks(source, state) {
  const marks = { radical: false, shared: false, partner: null, similar: null };
  if (source[state.index] === ACJK_MARKS.similar) {
    state.index += 1;
    marks.similar = readCodePoint(source, state);
  }
  for (;;) {
    if (source[state.index] === ACJK_MARKS.radical) {
      marks.radical = true;
      state.index += 1;
      continue;
    }
    if (source[state.index] === ACJK_MARKS.shared) {
      marks.shared = true;
      state.index += 1;
      const next = source[state.index];
      if (next && !/^\d/u.test(next) && !isAcjkOperator(next) && next !== ACJK_MARKS.radical) {
        marks.partner = readCodePoint(source, state);
      }
      continue;
    }
    break;
  }
  return marks;
}

// Оператор может быть записан неполно (в данных 14 таких записей): тогда
// недостающие части считаются пустыми и черт не добавляют.
// Оператор может быть записан с лишним счётчиком: «⿺1丿1㇏» в записи 𧘇 — это
// ⿺ с частями 丿 и ㇏, а единица после ⿺ дублирует их. Такие цифры пропускаем,
// остальное разбираем как обычно.
function readItem(source, state, first = readCodePoint(source, state)) {
  if (isAcjkOperator(first)) {
    const children = [];
    for (let index = 0; index < OPERATOR_ARITY[first]; index += 1) {
      if (state.index >= source.length) break;
      const before = state.index;
      try {
        children.push(readItem(source, state));
      } catch {
        state.index = before;
        if (/^\d/u.test(source.slice(state.index))) {
          readCount(source, state);
          continue;
        }
        break;
      }
    }
    return { type: "operator", operator: first, children };
  }
  if (/[\d.:~]/u.test(first)) {
    throw new AcjkSyntaxError(`Expected a component character, got ${first}`, source, state.index - first.length);
  }
  const marks = readMarks(source, state);
  if (/^\d/u.test(source.slice(state.index))) {
    return { type: "group", character: first, count: readCount(source, state), ...marks };
  }
  if (isAcjkOperator(source[state.index])) {
    return { type: "named", character: first, operator: readItem(source, state), ...marks };
  }
  // «衣.亠2𧘇4»: метка относится к самому иероглифу, а дальше идут его части.
  // Если числа нет вовсе («…丿1㇏»), это одиночная черта без счётчика.
  return { type: "marker", character: first, count: 1, ...marks };
}

// Разбор строки acjk. Первый символ — сам иероглиф, и он же первый элемент:
// «一.1» значит, что иероглиф состоит из одной черты, а «七⿻…» — что
// иероглиф разложен на части.
export function parseAcjk(source) {
  if (typeof source !== "string" || !source) {
    throw new AcjkSyntaxError("Empty acjk string", String(source), 0);
  }
  const state = { index: 0 };
  const character = readCodePoint(source, state);
  if (isAcjkOperator(character)) {
    throw new AcjkSyntaxError("Leading character must be an ideograph", source, 0);
  }
  const items = [readItem(source, state, character)];
  // В 12 записях словаря IDS обрывается («⿺1» без частей). Разбор обрывается
  // молча, а флаг truncated говорит вызывающему, что черт вышло меньше.
  let truncated = false;
  while (state.index < source.length) {
    const before = state.index;
    try {
      items.push(readItem(source, state));
    } catch {
      state.index = before;
      truncated = true;
      break;
    }
  }
  return { character, items, truncated };
}

// Плоский список «порций» черт в порядке записи: операторы только группируют,
// поэтому порядок элементов и есть порядок черт.
export function strokeGroups(source) {
  const tree = typeof source === "string" ? parseAcjk(source) : source;
  const groups = [];
  const visit = (node) => {
    if (node.type === "operator") {
      for (const child of node.children) visit(child);
      return;
    }
    if (node.type === "named") {
      visit(node.operator);
      return;
    }
    groups.push(node);
  };
  for (const item of tree.items) visit(item);
  return groups;
}

// Сумма чисел выражения. Одиночные символы без счётчика здесь не считаются:
// назвать их можно, только зная словарь, а число черт от этого не меняется.
export function countStrokes(source) {
  return strokeGroups(source)
    .filter((group) => group.type !== "marker")
    .reduce((sum, group) => sum + group.count, 0);
}

// Названия черт в порядке построения. Компонент раскрывается рекурсивно через
// resolve(символ) -> acjk компонента; если раскрытия нет, остаётся сам символ.
//
// Один компонент может встретиться дважды по разным причинам:
//   «朋⿰月.4月4»    — две самостоятельные 月, каждая раскрывается целиком;
//   «国⿴囗.:2玉5囗.:1» — одна 囗, разорванная надвое: 2 + 1 = 3, ровно её длина.
// Различаем по сумме: если сумма счётчиков равна длине компонента, части — это
// подряд идущие куски одной и той же последовательности черт.
export function strokeNames(source, resolve, seen = new Set()) {
  return namesForGroups(strokeGroups(source), resolve, seen);
}

function namesForGroups(groups, resolve, seen) {
  const named = groups.filter((group) => group.type !== "marker");
  const totals = new Map();
  for (const group of named) {
    totals.set(group.character, (totals.get(group.character) || 0) + group.count);
  }
  const shared = new Set();
  for (const [character, total] of totals) {
    if (total < 2) continue;
    const own = expand(character, resolve, seen);
    if (own && own.length === total) shared.add(character);
  }
  const used = new Map();
  const names = [];
  for (const group of groups) {
    const from = shared.has(group.character) ? (used.get(group.character) || 0) : 0;
    if (shared.has(group.character)) used.set(group.character, from + group.count);
    names.push(...namesFrom(group, from, resolve, seen));
  }
  return names;
}

// Счётчик компонента может превышать его разложение: «禹⿻⿱丿1口3禸.5»
// просит у 禸 пять черт, а 禸 = ⿻冂2厶2 даёт четыре (丨 𠃌 𠃋 丶).
// Тогда нехватку закрываем, но не названием самого компонента: иначе в
// нижнем уровне снова появляется составной символ. Если компонент одиночный
// («丿6» в 番) — повторяем его, это верно; если составной — последнюю
// примитиву из его разложения.
function fallback(expanded, group, count) {
  const single = !expanded || !expanded.length;
  const name = single ? group.character : expanded[expanded.length - 1];
  return Array.from({ length: count }, () => name);
}

function namesFrom(group, from, resolve, seen) {
  // Одиночный символ без счётчика («…丿1㇏») — это одна черта, только если он
  // сам по себе одиночный: иначе (например, висящий 亠) он ничего не значит.
  if (group.type === "marker") {
    const own = expand(group.character, resolve, seen);
    return own && own.length === 1 ? own : [];
  }
  const expanded = expand(group.character, resolve, seen);
  if (!expanded || !expanded.length || from >= expanded.length) {
    return fallback(expanded, group, group.count);
  }
  const slice = expanded.slice(from, from + group.count);
  if (slice.length < group.count) {
    slice.push(...fallback(expanded, group, group.count - slice.length));
  }
  return slice;
}

function expand(character, resolve, seen) {
  if (!resolve || seen.has(character)) return null;
  const acjk = resolve(character);
  if (!acjk) return null;
  seen.add(character);
  const names = namesForGroups(strokeGroups(acjk), resolve, seen);
  seen.delete(character);
  return names;
}


