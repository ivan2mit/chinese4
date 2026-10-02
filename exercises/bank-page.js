// Страница банка иероглифов: группы педагога, декомпозиция на ключи и таблицы
// ключей. Только чтение — правки вносятся в bank/*.json и собираются `npm run bank`.

import { extractOutlines, MARK_COLORS, pathBounds } from "./outlines.js";
import { loadStrokeBank } from "./data.js";
import { strokeIcon } from "./player.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const REST_COLOR = "#9aa39f";
const FLAGS = {
  "no-svg": "нет SVG",
  "partial-key": "неполный ключ",
  "radical-missing": "нет главного ключа"
};
const EDITS_KEY = "animcjk-bank-edits:v1";
const FILTERS = [
  ["all", "Все"],
  ["edited", "С правками"],
  ["review", "На проверку"],
  ["manual", "Ручные поправки"],
  ["nosvg", "Без SVG"]
];

const $ = (id) => document.getElementById(id);
const state = { tab: null, filter: "all", query: "" };
const data = { bank: null, strokes: null };
const outlinesCache = new Map();

// ---------------------------------------------------------------- правки черт
//
// Админ правит тип черты (одна из 38 базовых) и порядок написания. Правки
// живут в localStorage и выгружаются одним JSON; в банк они попадают через
// bank/strokes.json и `npm run bank`. Черта всегда называется номером в SVG:
//   codes — { номер в SVG: код базовой черты }
//   order — номера SVG в порядке написания (только если порядок изменён)
//   parts — новое разбиение на части целиком, в формате bank/overrides.json:
//           { key, strokes } | { component, strokes } | { rest: [...] }
//   note  — свободный комментарий
let edits = {};
try {
  edits = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}") || {};
} catch { /* битое хранилище — начинаем с чистого листа */ }

function saveEdits() {
  try {
    localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
  } catch { /* приватный режим: правки живут до закрытия вкладки */ }
}

const baseOrder = (entry) => entry.order || entry.strokes.map((stroke) => stroke.n);
const orderOf = (entry) => edits[entry.character]?.order || baseOrder(entry);
const codeOf = (entry, stroke) => edits[entry.character]?.codes?.[stroke.n] ?? stroke.code;
const isEdited = (entry) => Boolean(edits[entry.character]);

// Части в формате поправок: отдельные черты собраны в один rest.
function simpleParts(parts) {
  const rest = parts.filter((part) => part.type === "stroke").flatMap((part) => part.strokes).sort((a, b) => a - b);
  return [
    ...parts.filter((part) => part.type !== "stroke").map((part) => (part.type === "key"
      ? { key: part.character, base: part.base, strokes: [...part.strokes] }
      : { component: part.character || "", strokes: [...part.strokes] })),
    ...(rest.length ? [{ rest }] : [])
  ].sort((a, b) => (a.strokes || a.rest)[0] - (b.strokes || b.rest)[0]);
}

// То, что показывается: части с учётом правки и карта «черта → индекс части».
function viewOf(entry) {
  const custom = edits[entry.character]?.parts;
  const parts = !custom ? entry.parts : custom.flatMap((item) => {
    if (item.rest) return item.rest.map((n) => ({ type: "stroke", character: null, strokes: [n] }));
    if ("component" in item) return [{ type: "component", character: item.component || null, strokes: item.strokes }];
    const info = data.bank.keys[item.key] || {};
    return [{ type: "key", character: item.key, base: item.base || info.base || item.key, variant: Boolean(info.variant), strokes: item.strokes }];
  }).sort((a, b) => a.strokes[0] - b.strokes[0]);
  const partOf = new Map();
  parts.forEach((part, index) => part.strokes.forEach((n) => partOf.set(n, index)));
  return { parts, partOf, custom: Boolean(custom) };
}

// Назначить выбранным чертам новую роль. Из остальных частей эти черты
// уходят; часть, оставшаяся без черт, исчезает.
function assignParts(entry, numbers, target) {
  const picked = new Set(numbers);
  const kept = viewOf(entry).parts
    .map((part) => ({ ...part, strokes: part.strokes.filter((n) => !picked.has(n)) }))
    .filter((part) => part.strokes.length);
  const sorted = [...picked].sort((a, b) => a - b);
  if (target.type === "stroke") kept.push(...sorted.map((n) => ({ type: "stroke", character: null, strokes: [n] })));
  else kept.push({ ...target, strokes: sorted });
  touch(entry, (item) => { item.parts = simpleParts(kept); });
}

// Правка, совпавшая с исходным значением, не хранится: в выгрузке только отличия.
function touch(entry, change) {
  const edit = edits[entry.character] || { codes: {} };
  change(edit);
  for (const stroke of entry.strokes) if (edit.codes[stroke.n] === stroke.code) delete edit.codes[stroke.n];
  if (edit.order && edit.order.join() === baseOrder(entry).join()) delete edit.order;
  if (!edit.note) delete edit.note;
  if (edit.parts && JSON.stringify(edit.parts) === JSON.stringify(simpleParts(entry.parts))) delete edit.parts;
  if (Object.keys(edit.codes).length || edit.order || edit.note || edit.parts) edits[entry.character] = edit;
  else delete edits[entry.character];
  saveEdits();
}

function exportEdits() {
  const characters = {};
  for (const [character, edit] of Object.entries(edits)) {
    const entry = data.bank.characters[character];
    if (!entry) continue;
    characters[character] = {
      codePoint: entry.codePoint,
      ...(Object.keys(edit.codes).length ? { codes: edit.codes } : {}),
      ...(edit.order ? { order: edit.order } : {}),
      ...(edit.parts ? { parts: edit.parts } : {}),
      ...(edit.note ? { note: edit.note } : {}),
      // Для чтения глазами: итоговая последовательность черт символами.
      result: orderOf(entry).map((n) => String.fromCodePoint(codeOf(entry, entry.strokes[n - 1]))).join("")
    };
  }
  const payload = { type: "hanzi-bank-edits", schemaVersion: 1, exportedAt: new Date().toISOString(),
    count: Object.keys(characters).length, characters };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
  h("a", { href: url, download: `bank-edits-${payload.exportedAt.slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name === "style") node.style.cssText = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

async function outlinesOf(entry) {
  if (!entry.svg) return null;
  if (!outlinesCache.has(entry.character)) {
    outlinesCache.set(entry.character, fetchText(`../${entry.svg}`).then(extractOutlines).catch(() => null));
  }
  return outlinesCache.get(entry.character);
}

// Цвет части: ключи — по кругу из палитры, остаток — серый.
function partColors(parts) {
  let next = 0;
  return parts.map((part) => (part.type === "key" ? MARK_COLORS[next++ % MARK_COLORS.length] : REST_COLOR));
}

const range = (strokes) => {
  const runs = [];
  for (const number of strokes) {
    const last = runs.at(-1);
    if (last && number === last[1] + 1) last[1] = number;
    else runs.push([number, number]);
  }
  return runs.map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`)).join(", ");
};

const reviewFlags = (entry) => entry.flags.filter((flag) => flag !== "no-svg");

function glyph(entry, outlines, { numbers = false, selected = null, onPick = null } = {}) {
  const view = viewOf(entry);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1024 1024");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Иероглиф ${entry.character}`);
  const colors = partColors(view.parts);
  for (const outline of outlines) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", outline.d);
    path.dataset.n = String(outline.n);
    path.style.fill = colors[view.partOf.get(outline.n)] || REST_COLOR;
    if (selected?.has(outline.n)) path.classList.add("is-selected");
    if (onPick) {
      path.classList.add("is-pickable");
      path.addEventListener("click", () => onPick(outline.n));
    }
    svg.append(path);
  }
  if (numbers) {
    for (const outline of outlines) {
      const bounds = pathBounds(outline.d);
      if (!bounds && !outline.start) continue;
      const [cx, cy] = outline.start || [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "bk-num");
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", "30");
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", cx);
      text.setAttribute("y", cy + 12);
      text.setAttribute("text-anchor", "middle");
      text.textContent = String(orderOf(entry).indexOf(outline.n) + 1);
      group.append(circle, text);
      svg.append(group);
    }
  }
  return svg;
}

function partChip(part, color) {
  if (part.type === "key") {
    const base = part.variant || part.base !== part.character ? ` (${part.base})` : "";
    return h("span", { class: "bk-part is-key", style: `--part-color:${color}`,
      title: `ключ ${part.character}${base}${part.partial ? " · неполный" : ""}${part.self ? " · сам иероглиф" : ""}` },
      h("b", { text: part.character }), `${base} ${range(part.strokes)}${part.partial ? " ~" : ""}`);
  }
  return h("span", { class: "bk-part is-rest", title: part.type === "component" ? "компонент, не ключ" : "отдельная черта" },
    part.character && part.type === "component" ? h("b", { text: part.character }) : null, range(part.strokes));
}

// Подряд идущие отдельные черты сливаются в одну плашку: так карточка короче.
function chipsFor(entry) {
  const { parts } = viewOf(entry);
  const colors = partColors(parts);
  const chips = [];
  let loose = [];
  const flush = () => {
    if (loose.length) chips.push(h("span", { class: "bk-part is-rest", title: "отдельные черты" }, range(loose)));
    loose = [];
  };
  parts.forEach((part, index) => {
    if (part.type === "stroke") {
      loose.push(...part.strokes);
      return;
    }
    flush();
    chips.push(partChip(part, colors[index]));
  });
  flush();
  return chips;
}

function badges(entry) {
  const list = entry.flags.map((flag) => h("span", { class: "bk-badge is-warn", text: FLAGS[flag] || flag }));
  if (isEdited(entry)) list.push(h("span", { class: "bk-badge is-edit", text: "есть правки" }));
  if (entry.source === "manual") list.push(h("span", { class: "bk-badge is-manual", text: "вручную", title: entry.why || "" }));
  if (entry.self) list.push(h("span", { class: "bk-badge", text: "сам ключ" }));
  return list;
}

function card(entry) {
  const holder = h("span", { class: "bk-glyph" }, h("span", { class: "bk-glyph-text", text: entry.character }));
  const node = h("button", {
    type: "button",
    class: `bk-card${reviewFlags(entry).length ? " is-flagged" : ""}${entry.svg ? "" : " is-missing"}`,
    onclick: () => openDetail(entry)
  }, holder, h("span", { class: "bk-info" },
    h("span", { class: "bk-title" }, h("span", { class: "bk-char", text: entry.character }),
      h("span", { class: "bk-pinyin", text: entry.pinyin.join(", ") })),
    h("span", { class: "bk-parts" }, chipsFor(entry)),
    h("span", { class: "bk-badges" }, badges(entry))));
  node.dataset.character = entry.character;
  return node;
}

// Глифы подгружаются, когда карточка появляется на экране: в YCT 4 их 310.
const lazy = new IntersectionObserver((records) => {
  for (const record of records) {
    if (!record.isIntersecting) continue;
    lazy.unobserve(record.target);
    const entry = data.bank.characters[record.target.dataset.character];
    outlinesOf(entry).then((outlines) => {
      if (outlines) record.target.querySelector(".bk-glyph").replaceChildren(glyph(entry, outlines));
    });
  }
}, { rootMargin: "300px" });

function matches(entry) {
  if (state.filter === "edited" && !isEdited(entry)) return false;
  if (state.filter === "review" && !reviewFlags(entry).length) return false;
  if (state.filter === "manual" && entry.source !== "manual") return false;
  if (state.filter === "nosvg" && entry.svg) return false;
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLowerCase();
  return entry.character === query
    || viewOf(entry).parts.some((part) => part.character === query || part.base === query)
    || entry.pinyin.some((reading) => plain(reading).startsWith(plain(query)));
}

function renderGrid() {
  const group = data.bank.groups.find((item) => item.key === state.tab);
  const entries = group.characters.map((character) => data.bank.characters[character]).filter(matches);
  $("count").textContent = `${entries.length} из ${group.count}`;
  const cards = entries.map(card);
  $("grid").replaceChildren(...cards);
  for (const node of cards) lazy.observe(node);
}

// ---------------------------------------------------------------- карточка иероглифа

async function strokeBank() {
  if (!data.strokes) {
    const extras = JSON.parse(await fetchText("../data/extras.json"));
    data.strokes = new Map((await loadStrokeBank(extras, (code) => fetchText(`../svgsZhHans/${code}.svg`)))
      .map((item) => [item.code, item.d]));
  }
  return data.strokes;
}

// Состояние открытой карточки: active — черта, в которую попадёт щелчок по
// палитре; selected — черты, выбранные для переназначения части.
const ui = { active: null, selected: new Set(), keyQuery: "", component: "", radical: null };

async function openDetail(entry) {
  ui.active = null;
  ui.selected = new Set();
  ui.keyQuery = "";
  ui.component = "";
  ui.radical = null;
  await renderDetail(entry);
}

async function renderDetail(entry) {
  const dialog = $("detail");
  const scroll = dialog.scrollTop;
  const [outlines, strokes] = await Promise.all([outlinesOf(entry), strokeBank().catch(() => new Map())]);
  const view = viewOf(entry);
  const colors = partColors(view.parts);
  const order = orderOf(entry);
  const edit = edits[entry.character];
  const redraw = () => renderDetail(entry);
  const refresh = () => {
    redraw();
    render();
  };
  const toggle = (numbers) => {
    const all = numbers.every((n) => ui.selected.has(n));
    for (const n of numbers) (all ? ui.selected.delete(n) : ui.selected.add(n));
    redraw();
  };
  const big = h("div", { class: "bk-glyph bk-big" }, outlines
    ? glyph(entry, outlines, { numbers: true, selected: ui.selected, onPick: (n) => toggle([n]) })
    : h("span", { class: "bk-glyph-text", text: entry.character }));
  const hot = (numbers, on) => {
    for (const path of big.querySelectorAll("path[data-n]")) {
      path.style.opacity = on && !numbers.includes(Number(path.dataset.n)) ? ".25" : "";
    }
  };
  const hover = (numbers) => ({ onmouseenter: () => hot(numbers, true), onmouseleave: () => hot(numbers, false) });
  const icon = (code) => {
    const node = h("span", { class: "bk-stroke-icon" });
    if (strokes.get(code)) node.append(strokeIcon(strokes.get(code)));
    else node.textContent = "?";
    return node;
  };
  const setCode = (n, code) => {
    touch(entry, (item) => { item.codes[n] = code; });
    // После замены активной становится следующая черта: удобно идти подряд.
    const at = order.indexOf(n);
    ui.active = order[at + 1] ?? n;
    refresh();
  };

  // ------------------------------------------------------------ части
  const partRows = view.parts.map((part, index) => h("tr", {
    class: `bk-pickrow${part.strokes.every((n) => ui.selected.has(n)) ? " is-hot" : ""}`,
    title: "Щёлкните, чтобы выбрать черты этой части", onclick: () => toggle(part.strokes), ...hover(part.strokes)
  },
    h("td", {}, h("span", { class: "bk-swatch", style: `--part-color:${colors[index]}` }),
      h("span", { class: "zh", text: part.character || "·" })),
    h("td", { text: part.type === "key"
      ? `ключ${part.variant ? `, вариант ${part.base}` : part.base !== part.character ? `, корень ${part.base}` : ""}${part.main ? " ★" : ""}`
      : part.type === "component" ? "компонент (не ключ)" : "черта" }),
    h("td", { text: range(part.strokes) }),
    h("td", {}, part.inner ? part.inner.map((inner) => `${inner.character} ${range(inner.strokes)}`).join(", ") : "",
      part.partial ? "неполный: общая черта" : "")));

  const chosen = [...ui.selected].sort((a, b) => a - b);
  const assign = (target) => {
    assignParts(entry, chosen, target);
    ui.selected = new Set();
    ui.radical = null;
    refresh();
  };
  // Ключ выбирается в два шага: сначала сам ключ Канси (по символу, пиньиню,
  // значению, номеру или числу черт), затем его начертание — то, что стоит в
  // иероглифе. Корень (阜 или 邑 у 阝) при этом известен из первого шага.
  const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLowerCase();
  const formsOf = (radical) => [{ character: radical.character, strokeCount: radical.strokeCount }, ...radical.variants]
    .filter((form) => form.strokeCount > 1);
  const fits = (radical) => formsOf(radical).some((form) => form.strokeCount === chosen.length);
  const query = plain(ui.keyQuery.trim());
  const radicals = data.bank.radicals
    .filter((radical) => formsOf(radical).length)
    .filter((radical) => !query || radical.character === query || String(radical.number) === query
      || formsOf(radical).some((form) => form.character === query || String(form.strokeCount) === query)
      || radical.pinyin.some((reading) => plain(reading).startsWith(query))
      || (query.length > 1 && plain(radical.definition).includes(query)))
    .sort((a, b) => Number(fits(b)) - Number(fits(a)) || a.number - b.number);
  const picked = data.bank.radicals.find((radical) => radical.character === ui.radical) || null;
  const assignBox = chosen.length ? h("div", { class: "bk-assign" },
    h("p", { class: "ed-label", text: `Выбраны черты ${range(chosen)} — чем их сделать?` }),
    h("div", { class: "bk-assign-row" },
      h("input", { type: "text", class: "bk-mini zh", maxlength: "2", placeholder: "символ", value: ui.component,
        "aria-label": "Символ компонента", oninput: (event) => { ui.component = event.target.value.trim(); } }),
      h("button", { type: "button", onclick: () => assign({ type: "component", character: Array.from(ui.component)[0] || null }) }, "Компонент (не ключ)"),
      h("button", { type: "button", onclick: () => assign({ type: "stroke" }) }, "Отдельные черты"),
      h("button", { type: "button", class: "ed-link", onclick: () => { ui.selected = new Set(); redraw(); } }, "снять выбор")),
    h("p", { class: "ed-label", text: "1. Ключ" }),
    h("input", { type: "search", class: "bk-search bk-key-search", placeholder: "Найти: символ, пиньинь, значение, номер или число черт", value: ui.keyQuery,
      oninput: (event) => {
        ui.keyQuery = event.target.value;
        const caret = event.target.selectionStart;
        redraw().then(() => {
          const input = dialog.querySelector(".bk-key-search");
          input?.focus();
          input?.setSelectionRange(caret, caret);
        });
      } }),
    h("div", { class: "bk-keygrid" }, radicals.map((radical) => h("button", {
      type: "button", class: `bk-keypick${ui.radical === radical.character ? " is-on" : ""}${fits(radical) ? " is-fit" : ""}`,
      "aria-pressed": String(ui.radical === radical.character),
      title: `№${radical.number} · ${radical.pinyin.join(", ")} · ${radical.definition}`,
      onclick: () => { ui.radical = radical.character; redraw(); }
    }, h("span", { class: "zh", text: radical.character }), h("small", { text: String(radical.number) })))),
    picked ? h("div", { class: "bk-variants" },
      h("p", { class: "ed-label", text: `2. Начертание ключа ${picked.character} — как в иероглифе` }),
      h("p", { class: "ed-hint", text: `№${picked.number} · ${picked.pinyin.join(", ")} · ${picked.definition}` }),
      h("div", { class: "bk-assign-row" }, formsOf(picked).map((form) => h("button", {
        type: "button", class: `bk-keypick bk-form${form.strokeCount === chosen.length ? " is-fit" : ""}`,
        title: `${form.strokeCount} черт${form.character === picked.character ? " · основная форма" : " · вариант"}`,
        onclick: () => assign({ type: "key", character: form.character, base: picked.character })
      }, h("span", { class: "zh", text: form.character }), h("small", { text: `${form.strokeCount} черт` }))))) : null) : null;

  // ------------------------------------------------------------ черты
  const move = (position, shift) => touch(entry, (item) => {
    const next = [...order];
    [next[position], next[position + shift]] = [next[position + shift], next[position]];
    item.order = next;
  });
  const strokeRows = order.map((n, position) => {
    const stroke = entry.strokes[n - 1];
    const part = view.parts[view.partOf.get(n)];
    const code = codeOf(entry, stroke);
    const changed = code !== stroke.code;
    const moved = baseOrder(entry)[position] !== n;
    const cell = h("button", {
      type: "button", class: `bk-stroke-btn${ui.active === n ? " is-active" : ""}`,
      title: "Выберите ячейку и щёлкните по черте справа — или перетащите черту сюда",
      "aria-label": `Черта ${position + 1}`, "aria-pressed": String(ui.active === n),
      onclick: () => { ui.active = ui.active === n ? null : n; redraw(); },
      ondragover: (event) => { event.preventDefault(); cell.classList.add("is-drop"); },
      ondragleave: () => cell.classList.remove("is-drop"),
      ondrop: (event) => {
        event.preventDefault();
        const dropped = Number(event.dataTransfer.getData("text/plain"));
        if (strokes.has(dropped)) setCode(n, dropped);
      }
    }, icon(code));
    return h("tr", { class: `${changed || moved ? "is-edited" : ""}${ui.selected.has(n) ? " is-hot" : ""}`, ...hover([n]) },
      h("td", {}, String(position + 1), moved ? h("small", { class: "bk-was", text: ` было ${baseOrder(entry).indexOf(n) + 1}` }) : null),
      h("td", {}, cell, changed ? h("span", { class: "bk-was" }, " было ", icon(stroke.code)) : null),
      h("td", {}, h("span", { class: "bk-swatch", style: `--part-color:${colors[view.partOf.get(n)]}` }),
        h("span", { class: "zh", text: part?.character || "·" })),
      h("td", { class: "bk-actions" },
        h("button", { type: "button", "aria-label": `Черту ${position + 1} раньше`, title: "Раньше", disabled: position === 0,
          onclick: () => { move(position, -1); refresh(); } }, "↑"),
        h("button", { type: "button", "aria-label": `Черту ${position + 1} позже`, title: "Позже", disabled: position === order.length - 1,
          onclick: () => { move(position, 1); refresh(); } }, "↓"),
        changed ? h("button", { type: "button", class: "ed-link", onclick: () => {
          touch(entry, (item) => { delete item.codes[n]; });
          refresh();
        } }, "вернуть") : null));
  });

  // ------------------------------------------------------------ палитра 38 черт
  const activeCode = ui.active ? codeOf(entry, entry.strokes[ui.active - 1]) : null;
  const palette = h("aside", { class: "bk-palette" },
    h("p", { class: "ed-label", text: "Базовые черты" }),
    h("p", { class: "ed-hint", text: ui.active
      ? `Выбрана черта №${order.indexOf(ui.active) + 1}: щёлкните по нужной.`
      : "Перетащите черту в ячейку таблицы или сначала выберите ячейку." }),
    h("div", { class: "bk-picker", role: "group", "aria-label": "Базовые черты" },
      [...strokes].map(([option, d]) => h("button", {
        type: "button", draggable: "true", class: `bk-pick${option === activeCode ? " is-on" : ""}`,
        "aria-label": `Черта ${String.fromCodePoint(option)}`, disabled: false,
        onclick: () => ui.active && setCode(ui.active, option),
        ondragstart: (event) => {
          event.dataTransfer.setData("text/plain", String(option));
          event.dataTransfer.effectAllowed = "copy";
        }
      }, strokeIcon(d)))));

  dialog.replaceChildren(
    h("div", { class: "bk-detail-head" },
      h("h2", { text: entry.character }),
      h("span", { class: "bk-pinyin", text: `${entry.pinyin.join(", ")} · ${entry.definition}` }),
      h("button", { type: "button", onclick: () => dialog.close() }, "Закрыть")),
    h("div", { class: "bk-detail-grid" },
      h("div", { class: "bk-left" }, big,
        h("p", { class: "ed-hint", text: `Словарь AnimCJK: ${entry.ids || "—"}, главный ключ ${entry.radical || "—"}. Черт: ${entry.strokeCount}.` }),
        h("div", { class: "bk-badges" }, badges(entry)),
        entry.why ? h("p", { class: "ed-hint", text: `Поправка: ${entry.why}.` }) : null,
        entry.svg ? null : h("p", { class: "ed-hint is-error", text: "SVG этого иероглифа ещё не скачан: в заданиях он недоступен." })),
      h("div", {},
        h("p", { class: "ed-label", text: `Части${view.custom ? " — изменены" : ""}` }),
        h("p", { class: "ed-hint", text: "Чтобы изменить ключ или компонент, выберите черты — щелчком по глифу или по строке части — и назначьте им новую роль." }),
        h("table", { class: "bk-table" },
          h("thead", {}, h("tr", {}, ["Часть", "Что это", "Черты", "Примечание"].map((text) => h("th", { text })))),
          h("tbody", {}, partRows)),
        assignBox,
        view.custom ? h("button", { type: "button", class: "ed-link", onclick: () => {
          touch(entry, (item) => { delete item.parts; });
          refresh();
        } }, "вернуть исходное разбиение") : null,
        h("div", { class: "bk-section" },
          h("p", { class: "ed-label", text: "Черты по порядку написания" }),
          h("table", { class: "bk-table" },
            h("thead", {}, h("tr", {}, ["№", "Черта", "Часть", "Порядок"].map((text) => h("th", { text })))),
            h("tbody", {}, strokeRows)),
          h("label", { class: "ed-field" }, h("span", { class: "ed-label", text: "Комментарий к правке" }),
            h("input", { type: "text", value: edit?.note || "", placeholder: "необязательно", onchange: (event) => {
              touch(entry, (item) => { item.note = event.target.value.trim(); });
              render();
            } })),
          edit ? h("button", { type: "button", onclick: () => {
            delete edits[entry.character];
            saveEdits();
            refresh();
          } }, "Сбросить правки этого иероглифа") : null)),
      palette));
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = scroll;
}

// ---------------------------------------------------------------- таблицы ключей

function renderKeys() {
  const { radicals, keys } = data.bank;
  const used = (character) => keys[character]?.usedIn || [];
  const rows = radicals
    .filter((radical) => state.filter !== "review"
      || used(radical.character).length || radical.variants.some((item) => used(item.character).length))
    .map((radical) => {
      const forms = [radical.character, ...radical.variants.filter((item) => item.strokeCount > 1).map((item) => item.character)];
      const similar = [...new Set(forms.flatMap((form) => keys[form]?.similar || []))];
      const where = forms.flatMap((form) => used(form));
      return h("tr", {},
        h("td", { text: String(radical.number) }),
        h("td", { class: "zh", text: radical.character }),
        h("td", { text: String(radical.strokeCount) }),
        h("td", { class: "zh", text: radical.variants.filter((item) => item.strokeCount > 1).map((item) => item.character).join(" ") }),
        h("td", { class: "zh", text: similar.join(" ") }),
        h("td", { class: "bk-used", title: where.join(""), text: where.length ? `${where.slice(0, 14).join("")}${where.length > 14 ? "…" : ""} (${where.length})` : "" }));
    });
  $("keys").replaceChildren(
    h("p", { class: "ed-hint", text: "214 ключей Канси с вариантами начертания и визуально похожими ключами. Похожие предлагаются первыми при автоподборе обманок; варианты одного ключа друг другу обманками не служат. Правка — в bank/keys.json." }),
    h("div", { class: "bk-keys-scroll" }, h("table", { class: "bk-table" },
      h("thead", {}, h("tr", {}, ["№", "Ключ", "Черт", "Варианты", "Похожие", "Где встречается в банке"].map((text) => h("th", { text })))),
      h("tbody", {}, rows))));
}

// ---------------------------------------------------------------- каркас

function render() {
  const tabs = [...data.bank.groups.map((group) => [group.key, group.label, group.count]), ["keys", "Ключи", data.bank.radicals.length]];
  $("tabs").replaceChildren(...tabs.map(([key, label, count]) => h("button", {
    type: "button", role: "tab", class: `ed-tab${state.tab === key ? " is-active" : ""}`, "aria-selected": String(state.tab === key),
    onclick: () => {
      state.tab = key;
      state.filter = "all";
      render();
    }
  }, label, h("b", { text: String(count) }))));
  const isKeys = state.tab === "keys";
  const filters = isKeys ? [["all", "Все 214"], ["review", "Только те, что есть в банке"]] : FILTERS;
  $("filters").replaceChildren(...filters.map(([key, label]) => h("button", {
    type: "button", class: `ed-tab${state.filter === key ? " is-active" : ""}`, "aria-pressed": String(state.filter === key),
    onclick: () => {
      state.filter = key;
      render();
    }
  }, label)));
  const total = Object.keys(edits).length;
  $("export").textContent = `Выгрузить правки (${total})`;
  $("export").disabled = !total;
  $("reset").hidden = !total;
  $("search").hidden = isKeys;
  $("count").hidden = isKeys;
  $("grid").hidden = isKeys;
  $("keys").hidden = !isKeys;
  if (isKeys) renderKeys();
  else renderGrid();
}

async function init() {
  try {
    data.bank = JSON.parse(await fetchText("../data/bank.json"));
    state.tab = data.bank.groups[0].key;
    const { stats } = data.bank;
    $("status").textContent = `Иероглифов: ${stats.characters}, с SVG: ${stats.withSvg}, ручных поправок: ${stats.manual}, на проверку: ${stats.flagged}. Щёлкните по карточке, чтобы увидеть все черты по порядку.`;
    $("toolbar").hidden = false;
    $("export").addEventListener("click", exportEdits);
    $("reset").addEventListener("click", () => {
      if (!confirm(`Удалить правки по ${Object.keys(edits).length} иероглифам? Отменить это нельзя.`)) return;
      edits = {};
      saveEdits();
      render();
    });
    $("search").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderGrid();
    });
    render();
  } catch (error) {
    console.error(error);
    $("status").textContent = `Не удалось загрузить банк: ${error.message}. Запустите npm run bank.`;
    $("status").classList.add("is-error");
  }
}

init();
