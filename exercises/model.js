// Модель трёх заданий. Всё здесь — чистые функции без DOM, поэтому покрыто
// тестами и одинаково работает в редакторе, в плеере и в проверке.
//
//   strokes — «Какой черты не хватает»: иероглиф без нескольких черт; ученик
//             называет каждую недостающую черту и её номер по счёту.
//   keys    — «Какого ключа не хватает»: иероглиф без одного или нескольких
//             ключей; на каждый — строка вариантов (верный и обманки).
//   order   — «Порядок черт»: целый иероглиф; ученик выкладывает базовые
//             черты в порядке написания.
//
// Два файла, как и в основном редакторе: ученику — без ответа, педагогу —
// с ключом. Ответ ученика — третий файл, его сверяет checkAnswers.

import { fnv1a, makeRandom, shuffle, makeKey, makeSetKey } from "./shared.js";
import { buildGlyphSvg } from "./outlines.js";

export const SCHEMA_VERSION = 1;

export const KINDS = Object.freeze({
  strokes: Object.freeze({
    label: "Какой черты не хватает",
    student: "hanzi-stroke-gaps",
    master: "hanzi-stroke-gaps.master",
    answers: "hanzi-stroke-gaps.answers"
  }),
  keys: Object.freeze({
    label: "Какого ключа не хватает",
    student: "hanzi-key-gaps",
    master: "hanzi-key-gaps.master",
    answers: "hanzi-key-gaps.answers"
  }),
  order: Object.freeze({
    label: "Порядок черт",
    student: "hanzi-stroke-order",
    master: "hanzi-stroke-order.master",
    answers: "hanzi-stroke-order.answers"
  })
});

export const MAX_DECOYS = 8;

export function symbolOf(code) {
  return Number.isInteger(code) && code > 0 ? String.fromCodePoint(code) : null;
}

// Верные коды черт иероглифа: разложение по acjk, поверх него — ручные правки
// педагога (`overrides[номер черты] = код`). Результат равен числу черт.
export function strokeCodes(decoded, overrides = {}) {
  return decoded.map((code, index) => overrides[index + 1] ?? code);
}

// ---------------------------------------------------------------- проверка

export function validateSubtask(kind, subtask, ctx) {
  const problems = [];
  if (typeof subtask.character !== "string" || !subtask.character) {
    return ["нет иероглифа"];
  }
  const outlines = ctx.outlines(subtask.character);
  const total = outlines.length;
  if (!total) return [`нет контуров иероглифа ${subtask.character}`];

  if (kind === "strokes") {
    const cut = subtask.cut || [];
    if (!cut.length) problems.push("нужно убрать хотя бы одну черту");
    if (cut.length >= total) problems.push("нельзя убрать все черты");
    if (new Set(cut).size !== cut.length) problems.push("одна черта выбрана дважды");
    const codes = strokeCodes(ctx.decoded(subtask.character), subtask.codes);
    for (const number of cut) {
      if (!Number.isInteger(number) || number < 1 || number > total) {
        problems.push(`черты ${number} нет в иероглифе`);
      } else if (!ctx.baseCodes.has(codes[number - 1])) {
        problems.push(`для черты ${number} не определён тип: выберите вручную`);
      }
    }
  } else if (kind === "keys") {
    const keys = subtask.keys || [];
    if (!keys.length) problems.push("нужно убрать хотя бы один ключ");
    const taken = new Set();
    keys.forEach((key, position) => {
      const label = `ключ ${position + 1} (${key.character})`;
      for (const number of key.strokes || []) {
        if (!Number.isInteger(number) || number < 1 || number > total) {
          problems.push(`${label}: черты ${number} нет в иероглифе`);
        } else if (taken.has(number)) {
          problems.push(`${label}: черта ${number} уже занята другим ключом`);
        }
        taken.add(number);
      }
      if (!key.strokes?.length) problems.push(`${label}: нет черт`);
      const decoys = (key.decoys || []).filter(Boolean);
      if (!decoys.length) problems.push(`${label}: нужна хотя бы одна обманка`);
      if (decoys.includes(key.character)) problems.push(`${label}: обманка совпадает с ответом`);
      if (new Set(decoys).size !== decoys.length) problems.push(`${label}: обманки повторяются`);
    });
    if (taken.size >= total && keys.length) problems.push("убраны все черты иероглифа");
  } else if (kind === "order") {
    const codes = strokeCodes(ctx.decoded(subtask.character), subtask.codes);
    if (codes.length !== total) problems.push(`разложение даёт ${codes.length} черт, а в картинке ${total}`);
    codes.forEach((code, index) => {
      if (!ctx.baseCodes.has(code)) problems.push(`для черты ${index + 1} не определён тип: выберите вручную`);
    });
  } else {
    problems.push(`неизвестный тип задания ${kind}`);
  }
  return problems;
}

export function validateExercise(kind, exercise, ctx) {
  if (!exercise.subtasks?.length) return ["в задании нет ни одного иероглифа"];
  return exercise.subtasks.flatMap((subtask, position) =>
    validateSubtask(kind, subtask, ctx).map((problem) => `иероглиф ${position + 1} (${subtask.character}): ${problem}`));
}

// ---------------------------------------------------------------- сборка

export function makeExerciseId(kind, taken, seed) {
  let key = makeKey(`${kind}:${seed}`);
  for (let attempt = 1; taken.has(key); attempt += 1) key = makeKey(`${kind}:${seed}#${attempt}`);
  return key;
}

// Варианты одной строки ключа: верный и обманки, перемешанные
// детерминированно. Номер варианта — то, что ученик называет вслух.
export function buildKeyOptions(exercise, subtask, key, position, salt = 0) {
  const texts = [...new Set([key.character, ...(key.decoys || []).filter(Boolean)])];
  const seed = `${exercise.id}:${salt}:${subtask.index}:${position}`;
  const ordered = shuffle(texts, makeRandom(seed));
  return {
    options: ordered.map((text, index) => ({ n: index + 1, text })),
    answer: ordered.indexOf(key.character) + 1
  };
}

function studentSubtask(kind, exercise, subtask, ctx, salt) {
  const outlines = ctx.outlines(subtask.character);
  const seed = `${exercise.id}:${salt}:${subtask.index}`;
  if (kind === "strokes") {
    return {
      n: subtask.index,
      svg: buildGlyphSvg(outlines, { hidden: subtask.cut, seed }),
      total: outlines.length,
      gaps: subtask.cut.length
    };
  }
  if (kind === "keys") {
    const keys = subtask.keys;
    return {
      n: subtask.index,
      svg: buildGlyphSvg(outlines, {
        hidden: keys.flatMap((key) => key.strokes),
        marks: keys.map((key, position) => ({ label: position + 1, strokes: key.strokes })),
        seed
      }),
      questions: keys.map((key, position) => ({
        k: position + 1,
        options: buildKeyOptions(exercise, subtask, key, position, salt).options
      }))
    };
  }
  return {
    n: subtask.index,
    svg: buildGlyphSvg(outlines, { seed }),
    total: outlines.length
  };
}

function masterSubtask(kind, exercise, subtask, ctx, salt) {
  const outlines = ctx.outlines(subtask.character);
  const base = {
    n: subtask.index,
    character: subtask.character,
    codePoint: subtask.character.codePointAt(0),
    image: buildGlyphSvg(outlines, { seed: `full:${exercise.id}:${subtask.index}` }),
    studentImage: studentSubtask(kind, exercise, subtask, ctx, salt).svg
  };
  if (kind === "strokes") {
    const codes = strokeCodes(ctx.decoded(subtask.character), subtask.codes);
    return {
      ...base,
      cut: [...subtask.cut],
      answers: [...subtask.cut].sort((a, b) => a - b).map((number) => ({
        order: number,
        code: codes[number - 1],
        symbol: symbolOf(codes[number - 1])
      }))
    };
  }
  if (kind === "keys") {
    return {
      ...base,
      keys: subtask.keys.map((key, position) => {
        const built = buildKeyOptions(exercise, subtask, key, position, salt);
        return {
          k: position + 1,
          character: key.character,
          strokes: [...key.strokes],
          decoys: (key.decoys || []).filter(Boolean),
          options: built.options,
          answer: built.answer
        };
      })
    };
  }
  const codes = strokeCodes(ctx.decoded(subtask.character), subtask.codes);
  return { ...base, codes, symbols: codes.map(symbolOf) };
}

function header(kind, type, exercises) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type,
    generatedAt: new Date().toISOString(),
    setKey: makeSetKey(exercises.map((exercise) => exercise.id))
  };
}

export function buildStudentPayload(kind, exercises, ctx, salt = 0) {
  const payload = {
    ...header(kind, KINDS[kind].student, exercises),
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      subtasks: exercise.subtasks.map((subtask) => studentSubtask(kind, exercise, subtask, ctx, salt))
    }))
  };
  // Банк черт общий на весь набор, поэтому лежит отдельно от заданий.
  if (kind !== "keys") payload.bank = ctx.bank.map(({ code, d }) => ({ code, d }));
  return payload;
}

export function buildMasterPayload(kind, exercises, ctx, salt = 0) {
  return {
    ...header(kind, KINDS[kind].master, exercises),
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      phrase: exercise.phrase,
      subtasks: exercise.subtasks.map((subtask) => masterSubtask(kind, exercise, subtask, ctx, salt))
    }))
  };
}

// ------------------------------------------------------------ проверка ответов
//
// Ответ ученика:
//   strokes: { n, cells: [{ code, order }] }       — по ячейке на каждый пропуск
//   keys:    { n, picks: [номер варианта | null] } — по строке на каждый ключ
//   order:   { n, sequence: [code | null] }        — по ячейке на каждую черту
//
// Ячейки в «strokes» не привязаны к конкретной черте: ученик сам решает, в какой
// ячейке какую пару писать, поэтому сверка идёт по номеру черты, а не по
// порядку ячеек. Один номер, названный дважды, засчитывается один раз.

export function checkSubtask(kind, masterSubtask, answer) {
  const given = answer || {};
  if (kind === "strokes") {
    const expected = new Map(masterSubtask.answers.map((item) => [item.order, item.code]));
    const seen = new Set();
    let score = 0;
    for (const cell of given.cells || []) {
      if (!expected.has(cell?.order) || seen.has(cell.order)) continue;
      seen.add(cell.order);
      if (expected.get(cell.order) === cell.code) score += 1;
    }
    return { score, max: expected.size };
  }
  if (kind === "keys") {
    const picks = given.picks || [];
    const score = masterSubtask.keys.filter((key, index) => picks[index] === key.answer).length;
    return { score, max: masterSubtask.keys.length };
  }
  const sequence = given.sequence || [];
  const score = masterSubtask.codes.filter((code, index) => sequence[index] === code).length;
  return { score, max: masterSubtask.codes.length };
}

// Сверка всего набора. Возвращает оценки по заданиям и итог; верно = все пункты.
export function checkAnswers(kind, master, answers) {
  const byExercise = new Map((answers?.answers || []).map((item) => [item.exercise, item]));
  let score = 0;
  let max = 0;
  const exercises = master.exercises.map((exercise) => {
    const given = byExercise.get(exercise.id);
    const subtasks = exercise.subtasks.map((subtask) => {
      const answer = (given?.subtasks || []).find((item) => item.n === subtask.n);
      const result = checkSubtask(kind, subtask, answer);
      score += result.score;
      max += result.max;
      return { n: subtask.n, ...result, correct: result.score === result.max };
    });
    return { id: exercise.id, subtasks };
  });
  return { setKey: master.setKey, score, max, exercises };
}

export function newAnswersFile(kind, student, exercisesAnswers) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: KINDS[kind].answers,
    setKey: student.setKey,
    answers: exercisesAnswers
  };
}

// ------------------------------------------------------------ обманки для ключей
//
// Автоподбор: сначала визуально похожие ключи (таблица `similar` из банка —
// 土 → 士 工 干 王), затем ближайшие по числу черт. Не берутся ключи того же
// корня Канси (для 亻 обманка 人 была бы той же сущностью). Педагог правит руками.
export function suggestDecoys(correct, pool, count, seed, similar = []) {
  const forbidden = new Set(correct.bases || [correct.base]);
  const candidates = pool.filter((item) =>
    item.character !== correct.character
    && !item.bases.some((base) => forbidden.has(base))
    && item.strokeCount > 0);
  const random = makeRandom(seed);
  const distance = (item) => Math.abs(item.strokeCount - correct.strokeCount);
  const alike = new Set(similar);
  const rank = (item) => (alike.has(item.character) ? 0 : 1);
  // Сначала похожие, затем по близости; внутри одной близости — случайно:
  // порядок воспроизводим.
  const keyed = shuffle(candidates, random).sort((a, b) => rank(a) - rank(b) || distance(a) - distance(b));
  return keyed.slice(0, Math.max(0, Math.min(count, MAX_DECOYS))).map((item) => item.character);
}

export { fnv1a };
