// Плеер заданий: то, что видит ученик. Принимает ученический файл (без ответов),
// отдаёт файл ответов. Если передан мастер-файл, умеет показать проверку —
// это режим предпросмотра для педагога, ученику мастер-файл не отдаётся.

import { KINDS, checkSubtask, newAnswersFile } from "./model.js";
import { draggable, dropTarget } from "./dnd.js";

// Ключ localStorage, через который редактор передаёт предпросмотр странице ученика.
export const PREVIEW_KEY = "animcjk-exercises:student-preview";

const SVG_NS = "http://www.w3.org/2000/svg";
const ALLOWED_TAGS = new Set(["svg", "g", "path", "rect", "circle", "text"]);
const ALLOWED_ATTRS = new Set([
  "xmlns", "viewBox", "role", "aria-label", "class", "fill", "d", "x", "y", "cx", "cy", "r",
  "width", "height", "rx", "stroke", "stroke-width", "stroke-dasharray", "text-anchor",
  "font-size", "font-weight", "font-family"
]);

export function kindOfType(type) {
  const found = Object.entries(KINDS).find(([, value]) => value.student === type);
  if (!found) throw new Error(`Неизвестный тип файла: ${type}`);
  return found[0];
}

// Картинка приходит из файла, поэтому не вставляется как есть: из неё
// собирается DOM, в котором остаются только известные теги и атрибуты.
export function safeSvg(text) {
  const parsed = new DOMParser().parseFromString(String(text), "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.tagName !== "svg") {
    throw new Error("Картинка задания повреждена");
  }
  const clean = (source, parent) => {
    const node = document.createElementNS(SVG_NS, source.tagName);
    for (const { name, value } of source.attributes) {
      if (ALLOWED_ATTRS.has(name)) node.setAttribute(name, value);
    }
    for (const child of source.childNodes) {
      if (child.nodeType === 1 && ALLOWED_TAGS.has(child.tagName)) clean(child, node);
      else if (child.nodeType === 3 && source.tagName === "text") node.append(child.data);
    }
    parent.append(node);
  };
  const holder = document.createDocumentFragment();
  clean(parsed.documentElement, holder);
  return holder.firstChild;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function strokeIcon(d) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1024 1024");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

function glyphCard(svgText) {
  const host = make("div", "pl-glyph");
  host.append(safeSvg(svgText));
  return host;
}

function button(className, label, onClick, extra = {}) {
  const node = make("button", className);
  node.type = "button";
  if (label) node.textContent = label;
  if (extra.aria) node.setAttribute("aria-label", extra.aria);
  if (extra.pressed !== undefined) node.setAttribute("aria-pressed", String(extra.pressed));
  node.addEventListener("click", onClick);
  return node;
}

function bankView(bank, onPick, usedCodes = new Set(), field = "code") {
  const grid = make("div", "pl-bank");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Банк черт");
  for (const { code, d } of bank) {
    const item = button(`pl-bank-item${usedCodes.has(code) ? " is-used" : ""}`, "", () => onPick(code), {
      aria: `Черта ${bank.findIndex((entry) => entry.code === code) + 1}`
    });
    item.append(strokeIcon(d));
    draggable(item, { payload: { field, value: code } });
    grid.append(item);
  }
  return grid;
}

function verdictLine(result) {
  const line = make("p", `pl-verdict ${result.score === result.max ? "is-ok" : "is-bad"}`);
  line.textContent = result.score === result.max
    ? "Верно"
    : `Верно ${result.score} из ${result.max}`;
  return line;
}

// ------------------------------------------------------------ «Какой черты не хватает»

function renderStrokes(subtask, context) {
  const { bank, onChange, master, initial } = context;
  const paths = new Map(bank.map((item) => [item.code, item.d]));
  const cells = Array.from({ length: subtask.gaps }, (_, index) => ({
    code: initial?.cells?.[index]?.code ?? null, order: initial?.cells?.[index]?.order ?? null
  }));
  // Две независимые «стрелки»: куда пойдёт следующая черта и куда следующий номер.
  // Клик по банку пишет только в ячейки черт, клик по числу только в ячейки номеров;
  // после заполнения стрелка переходит к следующей пустой ячейке своего ряда.
  const firstEmpty = (field) => Math.max(0, cells.findIndex((cell) => cell[field] === null));
  const nextEmpty = (field, from) => {
    for (let step = 1; step < cells.length; step += 1) {
      const next = (from + step) % cells.length;
      if (cells[next][field] === null) return next;
    }
    return from;
  };
  const ptr = { code: firstEmpty("code"), order: firstEmpty("order") };
  let lastPart = "code";
  const root = make("div", "pl-task");

  // Бросок: в ячейку (index) кладётся payload; если его тянули из другой ячейки,
  // они меняются местами. index === null — «выбросили»: ячейка очищается.
  const drop = (field, index, payload) => {
    if (payload.field !== undefined && payload.field !== field) return;
    if (index === null) {
      cells[payload.from][field] = null;
    } else if (payload.from !== undefined) {
      const held = cells[index][field];
      cells[index][field] = payload.value ?? cells[payload.from][field];
      cells[payload.from][field] = held;
    } else {
      cells[index][field] = payload.value;
    }
    ptr[field] = index === null ? payload.from : nextEmpty(field, index);
    lastPart = field;
    onChange();
    render();
  };

  const commitNumber = (number) => {
    cells[ptr.order].order = number;
    ptr.order = nextEmpty("order", ptr.order);
    lastPart = "order";
    onChange();
    render();
  };

  const render = () => {
    root.replaceChildren();
    root.append(glyphCard(subtask.svg));
    const side = make("div", "pl-side");
    side.append(make("p", "pl-hint pl-intro", `Восстановите иероглиф: не хватает черт — ${subtask.gaps} (всего в иероглифе ${subtask.total}). Найдите недостающие черты, выберите каждую из банка и укажите, какой по счёту она пишется.`));
    const row = make("div", "pl-columns");
    cells.forEach((cell, index) => {
      const column = make("div", "pl-column");
      const strokeCell = button(`pl-cell${ptr.code === index ? " is-active" : ""}${cell.code ? " is-filled" : ""}`, "", () => {
        ptr.code = index; lastPart = "code";
        render();
      }, { aria: `Черта ${index + 1}: ${cell.code ? "заполнена" : "пусто"}` });
      if (cell.code) {
        strokeCell.append(strokeIcon(paths.get(cell.code)));
        draggable(strokeCell, { payload: { field: "code", value: cell.code, from: index }, onOutside: () => drop("code", null, { from: index }) });
      }
      dropTarget(strokeCell, (payload) => drop("code", index, payload));
      const orderCell = button(`pl-cell pl-cell-number${ptr.order === index ? " is-active" : ""}${cell.order ? " is-filled" : ""}`,
        cell.order ? String(cell.order) : "№", () => {
          ptr.order = index; lastPart = "order";
          render();
        }, { aria: `Номер черты ${index + 1}: ${cell.order || "пусто"}` });
      if (cell.order) draggable(orderCell, { payload: { field: "order", value: cell.order, from: index }, onOutside: () => drop("order", null, { from: index }) });
      dropTarget(orderCell, (payload) => drop("order", index, payload));
      column.append(strokeCell, orderCell);
      if (cell.code || cell.order) {
        column.append(button("pl-clear", "×", () => {
          cell.code = null;
          cell.order = null;
          ptr.code = index; ptr.order = index; lastPart = "code";
          onChange();
          render();
        }, { aria: "Очистить ячейку" }));
      }
      row.append(column);
    });
    side.append(row);
    const pad = make("div", "pl-pad");
    for (let number = 1; number <= subtask.total; number += 1) {
      const item = button(`pl-pad-item${cells[ptr.order].order === number ? " is-active" : ""}`, String(number), () => commitNumber(number));
      draggable(item, { payload: { field: "order", value: number } });
      pad.append(item);
    }
    side.append(make("p", "pl-hint", `Какая по счёту это черта? Нажмите число (сейчас оно пойдёт в колонку ${ptr.order + 1}) или перетащите его в окошко «№»:`), pad);
    root.append(side);

    const lower = make("div", "pl-lower");
    lower.append(make("h5", "pl-bank-title", "Банк черт"), make("p", "pl-hint", `Выберите черту для колонки ${ptr.code + 1} или перетащите её в ячейку.`));
    lower.append(bankView(bank, (code) => {
      cells[ptr.code].code = code;
      ptr.code = nextEmpty("code", ptr.code);
      lastPart = "code";
      onChange();
      render();
    }, new Set(cells.map((cell) => cell.code))));
    root.append(lower);
    if (master) {
      const result = checkSubtask("strokes", master, { cells });
      root.append(verdictLine(result));
      const answer = make("div", "pl-key");
      for (const item of master.answers) {
        const chip = make("span", "pl-key-chip");
        chip.append(strokeIcon(paths.get(item.code)), make("b", "", `№${item.order}`));
        answer.append(chip);
      }
      root.append(make("p", "pl-hint", "Верный ответ:"), answer);
    }
    root.querySelector(lastPart === "code" ? ".pl-cell.is-active:not(.pl-cell-number)" : ".pl-cell-number.is-active")?.focus({ preventScroll: true });
  };
  render();
  return { element: root, get: () => ({ n: subtask.n, cells: cells.map((cell) => ({ ...cell })) }), redraw: render };
}

// ------------------------------------------------------------ «Какого ключа не хватает»

function renderKeys(subtask, context) {
  const { onChange, master, initial } = context;
  const picks = subtask.questions.map((_, index) => initial?.picks?.[index] ?? null);
  const root = make("div", "pl-task");
  const render = () => {
    root.replaceChildren();
    root.append(glyphCard(subtask.svg));
    const side = make("div", "pl-side");
    side.append(make("p", "pl-hint pl-intro", subtask.questions.length === 1
      ? "Восстановите иероглиф: в рамке 1 не хватает ключа. Выберите ключ, который нужно вписать в рамку."
      : `Восстановите иероглиф: в ${subtask.questions.length} рамках не хватает ключей. Для каждой рамки выберите ключ, который нужно в неё вписать.`));
    subtask.questions.forEach((question, index) => {
      const row = make("div", "pl-key-row");
      row.dataset.k = String(question.k);
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", `Рамка ${question.k}`);
      row.append(make("span", "pl-badge", String(question.k)), make("span", "pl-row-label", `Что вписать в рамку ${question.k}?`));
      const options = make("div", "pl-options");
      for (const option of question.options) {
        const answer = master?.keys[index];
        const state = !answer ? ""
          : answer.answer === option.n ? " is-right"
            : picks[index] === option.n ? " is-wrong" : "";
        options.append(button(`pl-option${picks[index] === option.n ? " is-picked" : ""}${state}`, option.text, () => {
          picks[index] = picks[index] === option.n ? null : option.n;
          onChange();
          render();
        }, { pressed: picks[index] === option.n }));
      }
      row.append(options);
      side.append(row);
    });
    root.append(side);
    if (master) root.append(verdictLine(checkSubtask("keys", master, { picks })));
  };
  render();
  return { element: root, get: () => ({ n: subtask.n, picks: [...picks] }), redraw: render };
}

// ------------------------------------------------------------ «Порядок черт»

function renderOrder(subtask, context) {
  const { bank, onChange, master, initial } = context;
  const paths = new Map(bank.map((item) => [item.code, item.d]));
  const sequence = Array.from({ length: subtask.total }, (_, index) => initial?.sequence?.[index] ?? null);
  let active = 0;
  const root = make("div", "pl-task");
  const nextEmpty = (from) => {
    for (let step = 1; step <= sequence.length; step += 1) {
      const index = (from + step) % sequence.length;
      if (sequence[index] === null) return index;
    }
    return Math.min(from + 1, sequence.length - 1);
  };
  // Бросок в ячейку; из другой ячейки — обмен местами; null — выбросили.
  const drop = (index, payload) => {
    if (payload.field !== "seq") return;
    if (index === null) {
      sequence[payload.from] = null;
    } else if (payload.from !== undefined) {
      const held = sequence[index];
      sequence[index] = payload.value;
      sequence[payload.from] = held;
    } else {
      sequence[index] = payload.value;
    }
    active = index ?? payload.from;
    onChange();
    render();
  };
  const render = () => {
    root.replaceChildren();
    root.append(glyphCard(subtask.svg));
    const side = make("div", "pl-side");
    side.append(make("p", "pl-hint pl-intro", `Выложите все ${subtask.total} черт иероглифа по порядку написания: от первой до последней.`));
    const row = make("div", "pl-columns pl-order");
    sequence.forEach((code, index) => {
      const column = make("div", "pl-column");
      const cell = button(`pl-cell${active === index ? " is-active" : ""}${code ? " is-filled" : ""}`, "", () => {
        active = index;
        render();
      }, { aria: `Черта ${index + 1}: ${code ? "заполнена" : "пусто"}` });
      if (code) {
        cell.append(strokeIcon(paths.get(code)));
        draggable(cell, { payload: { field: "seq", value: code, from: index }, onOutside: () => drop(null, { from: index }) });
      }
      dropTarget(cell, (payload) => drop(index, payload));
      column.append(make("span", "pl-index", String(index + 1)), cell);
      if (code) {
        column.append(button("pl-clear", "×", () => {
          sequence[index] = null;
          active = index;
          onChange();
          render();
        }, { aria: "Очистить ячейку" }));
      }
      row.append(column);
    });
    side.append(row);
    root.append(side);
    const lower = make("div", "pl-lower");
    lower.append(make("h5", "pl-bank-title", "Банк черт"), make("p", "pl-hint", `Выберите черту для ячейки ${active + 1} или перетащите её в ячейку.`));
    lower.append(bankView(bank, (code) => {
      sequence[active] = code;
      active = nextEmpty(active);
      onChange();
      render();
    }, new Set(), "seq"));
    root.append(lower);
    if (master) {
      root.append(verdictLine(checkSubtask("order", master, { sequence })));
      const answer = make("div", "pl-key");
      master.codes.forEach((code, index) => {
        const chip = make("span", "pl-key-chip");
        chip.append(strokeIcon(paths.get(code)), make("b", "", String(index + 1)));
        answer.append(chip);
      });
      root.append(make("p", "pl-hint", "Верный порядок:"), answer);
    }
    root.querySelector(".is-active")?.focus({ preventScroll: true });
  };
  render();
  return { element: root, get: () => ({ n: subtask.n, sequence: [...sequence] }), redraw: render };
}

const RENDERERS = { strokes: renderStrokes, keys: renderKeys, order: renderOrder };

// Один вопрос без рамок и заголовков — для встраивания в кабинет олимпиады:
// там заголовок, номер и навигацию рисует сам кабинет. kind — "strokes" | "keys"
// | "order"; bank — банк черт из ученического файла (у "keys" не нужен).
export function mountSubtask(host, kind, subtask, { bank = [], onChange = () => {}, initial = null } = {}) {
  host.replaceChildren();
  host.classList.add("hz", "hz-embedded");
  const part = RENDERERS[kind](subtask, { bank, onChange, master: null, initial });
  host.append(part.element);
  return { get: () => part.get(), element: part.element };
}

// Монтирует весь набор. masters — мастер-файл того же набора (необязательно).
export function mountPlayer(host, student, { master = null, onChange = () => {} } = {}) {
  const kind = kindOfType(student.type);
  host.replaceChildren();
  host.classList.add("hz");
  const parts = [];
  const bank = student.bank || [];
  const masters = new Map((master?.exercises || []).map((exercise) => [exercise.id, exercise]));
  for (const exercise of student.exercises) {
    const section = make("section", "pl-exercise");
    section.append(make("h3", "pl-title", exercise.title || "Задание"));
    exercise.subtasks.forEach((subtask, position) => {
      const card = make("article", "pl-subtask");
      card.append(make("p", "pl-number", `Иероглиф ${position + 1}`));
      const masterSubtask = masters.get(exercise.id)?.subtasks.find((item) => item.n === subtask.n) || null;
      const part = RENDERERS[kind](subtask, { bank, onChange, master: masterSubtask });
      card.append(part.element);
      section.append(card);
      parts.push({ exercise: exercise.id, part });
    });
    host.append(section);
  }
  return {
    kind,
    getAnswers() {
      const byExercise = new Map();
      for (const { exercise, part } of parts) {
        if (!byExercise.has(exercise)) byExercise.set(exercise, { exercise, subtasks: [] });
        byExercise.get(exercise).subtasks.push(part.get());
      }
      return newAnswersFile(kind, student, [...byExercise.values()]);
    }
  };
}
