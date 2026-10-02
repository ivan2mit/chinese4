// Загрузка и разбор данных, общих для редактора, плеера и тестов.

import { strokeNames } from "./shared.js";
import { buildKeyIndex } from "./keys.js";
import { extractOutlines, strokeOutlinePath } from "./outlines.js";

// Словарь апстрима целиком (JSONL). resolve(символ) → acjk или null.
export function parseDictionary(text) {
  const entries = text.trim().split("\n").map((line) => JSON.parse(line));
  const acjk = new Map();
  for (const entry of entries) if (entry.acjk) acjk.set(entry.character, entry.acjk);
  return { entries, resolve: (character) => acjk.get(character) || null };
}

// Пул ключей для обманок: 214 ключей и их варианты, с числом черт.
export function buildKeyPool(extras, dictionary, options = {}) {
  const index = buildKeyIndex(extras, dictionary.entries, options);
  const pool = [...index.values()].map((info) => {
    const acjk = dictionary.resolve(info.character);
    return { ...info, strokeCount: acjk ? strokeNames(acjk, dictionary.resolve).length : 0 };
  });
  return { index, pool };
}

// 38 базовых черт с контурами: [{ code, d }]. loadSvg(code) → текст SVG.
export async function loadStrokeBank(extras, loadSvg) {
  const codes = extras.sets.stroke.characters.map((item) => item.character.codePointAt(0));
  const bank = [];
  for (const code of codes) {
    const d = strokeOutlinePath(await loadSvg(code));
    if (!d) throw new Error(`Нет контура у базовой черты U+${code.toString(16)}`);
    bank.push({ code, d });
  }
  return bank;
}

export { extractOutlines };
