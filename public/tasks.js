// Модель задания: фраза разбивается на подзадания, у каждого — свой набор
// пропусков и свой набор вариантов-черт. Один символ = одно подзадание, но
// пропусков внутри символа может быть сколько угодно: на каждый убранный
// ученик должен назвать свою черту, поэтому верных вариантов ровно столько
// же, сколько пропусков.
//
// Два разных файла:
//   buildStudentPayload — ученику. Без ответа вообще: ни codePoint глифа,
//     ни номеров вырезанных черт, ни фразы, ни верных вариантов.
//   buildMasterPayload  — учителю. Полная копия с ключом, по которому потом
//     ищут ответ к присланным учеником ответам.

// Детерминированные псевдослучайные числа и перестановки.
//
// Зачем не Math.random: порядок вариантов должен совпадать в двух местах —
// в предпросмотре, который смотрит педагог, и в выгруженном ученическом
// файле. Один и тот же seed даёт одну и ту же перестановку, а «перемешать»
// меняет seed, и всё переставляется заново.

import { fnv1a, makeRandom, shuffle } from "./random.js";

export const SCHEMA_VERSION = 4;
export const STUDENT_TYPE = "hanzi-stroke-choice";
export const MASTER_TYPE = "hanzi-stroke-choice.master";

// Ключ задания: короткий, стабильный, без секрета. Ученик видит его в своём
// файле, учитель находит по нему ответы в мастер-файле.
export function makeKey(seed) {
  return `ex-${fnv1a(seed).toString(16).padStart(8, "0")}`;
}

// Ключ всего набора: по нему один файл ученику и один файл педагогу
// однозначно принадлежат друг другу, даже если заданий несколько.
export function makeSetKey(exerciseIds) {
  return `st-${fnv1a([...exerciseIds].join("|")).toString(16).padStart(8, "0")}`;
}

// Хеш должен быть уникален внутри набора: при совпадении seed уточняется
// счётчиком попыток, пока ключ не станет свободным.
export function uniqueId(taken, seed) {
  let key = makeKey(seed);
  for (let attempt = 1; taken.has(key); attempt += 1) {
    key = makeKey(`${seed}#${attempt}`);
  }
  return key;
}

// Ошибки собираются все сразу, а не падают на первой: педагогу нужно увидеть
// список целиком, а не по одному.
export function validateSubtask(subtask, baseStrokeCodes) {
  const problems = [];
  if (!Number.isInteger(subtask.index) || subtask.index < 0) {
    problems.push("нет номера иероглифа в фразе");
  }
  if (typeof subtask.character !== "string" || !subtask.character) {
    problems.push("нет иероглифа");
  }
  if (!Array.isArray(subtask.cut) || subtask.cut.length === 0) {
    problems.push("нужно убрать хотя бы одну черту");
  } else {
    const seen = new Set();
    for (const number of subtask.cut) {
      if (!Number.isInteger(number) || number < 1) {
        problems.push(`номер убранной черты ${number} неверен`);
      } else if (seen.has(number)) {
        problems.push(`черта ${number} выбрана повторно`);
      }
      seen.add(number);
    }
  }
  if (!Array.isArray(subtask.correct)) {
    problems.push("нет списка верных вариантов");
  } else if (subtask.correct.length !== subtask.cut.length) {
    problems.push(
      `верных вариантов ${subtask.correct.length}, а убранных черт ${subtask.cut.length}`
    );
  } else {
    // Верный вариант стоит напротив своей убранной черты: null = ещё не выбран.
    subtask.correct.forEach((code, slot) => {
      if (code === null) {
        problems.push(`для черты ${subtask.cut[slot]} не выбран верный вариант`);
      } else if (!Number.isInteger(code) || !baseStrokeCodes.has(code)) {
        problems.push(`верный вариант ${code} не является базовой чертой`);
      }
    });
  }
  if (!Array.isArray(subtask.distractors)) {
    problems.push("нет списка отвлекающих вариантов");
  } else {
    const seen = new Set();
    for (const code of subtask.distractors) {
      // Пустая колонка обманки — это «ещё не выбрано», а не ошибка: её видно
      // в таблице, и она не должна ломать выгрузку сама по себе. Ответ на то,
      // что вариантов хватает для выбора, — проверка под этим циклом.
      if (code === null || code === undefined) continue;
      if (!baseStrokeCodes.has(code)) {
        problems.push(`отвлекающий вариант ${code} не является базовой чертой`);
        continue;
      }
      if (Array.isArray(subtask.correct) && subtask.correct.includes(code)) {
        problems.push(`вариант ${code} одновременно верный и отвлекающий`);
      }
      if (seen.has(code)) problems.push(`вариант ${code} повторяется`);
      seen.add(code);
    }
  }
  // Вопрос без выбора — не вопрос: верный ответ должен конкурировать хотя бы
  // с одной «обманкой», иначе ученику не из чего выбирать.
  const cut = Array.isArray(subtask.cut) ? subtask.cut : [];
  const correct = Array.isArray(subtask.correct) ? subtask.correct : [];
  const distractors = Array.isArray(subtask.distractors) ? subtask.distractors : [];
  const chosen = [...correct, ...distractors].filter(
    (code) => code !== null && code !== undefined);
  if (cut.length && correct.every((code) => code !== null)
    && new Set(chosen).size < 2) {
    problems.push("нужен хотя бы один отвлекающий вариант: иначе выбирать не из чего");
  }
  return problems;
}

export function validateExercise(exercise, baseStrokeCodes) {
  const problems = [];
  if (!Array.isArray(exercise.subtasks) || exercise.subtasks.length === 0) {
    problems.push("в задании нет ни одного иероглифа");
    return problems;
  }
  const indexes = new Set();
  exercise.subtasks.forEach((subtask, position) => {
    for (const problem of validateSubtask(subtask, baseStrokeCodes)) {
      problems.push(`иероглиф ${position + 1}: ${problem}`);
    }
    if (indexes.has(subtask.index)) {
      problems.push(`иероглиф ${position + 1}: номер ${subtask.index} повторяется`);
    }
    indexes.add(subtask.index);
  });
  return problems;
}

// Варианты одного иероглифа: верные и «обманки» сливаются в один набор без
// повторов (обманка не может совпасть с верным ответом, а два одинаковых
// варианта в вопросе бессмысленны) и перемешиваются.
//
// Ключевой момент: перемешивание детерминированное. Seed собран из ключа
// задания, соли набора и номера иероглифа, поэтому предпросмотр в редакторе
// и выгруженный ученический файл дают одно и то же. «Перемешать» в наборе
// увеличивает соль — и перестановка меняется целиком.
export function questionSeed(exercise, subtask, salt = 0) {
  return `${exercise.id}:${salt}:${subtask.imageKey ?? subtask.index}`;
}

export function optionCodes(subtask) {
  const all = [
    ...(Array.isArray(subtask.correct) ? subtask.correct : []),
    ...(Array.isArray(subtask.distractors) ? subtask.distractors : [])
  ];
  return [...new Set(all.filter((code) => code !== null && code !== undefined))];
}

// Номер варианта — с единицы, в перемешанном порядке. 0 означает, что кода в
// наборе нет (так бывает, если вопрос собран до выбора ответа).
export function optionNumber(orderedCodes, code) {
  const index = orderedCodes.indexOf(code);
  return index === -1 ? 0 : index + 1;
}

// Готовый вопрос для одного иероглифа: пронумерованные варианты, которые
// видит ученик, и номера верных ответов для педагога.
export function buildQuestion(exercise, subtask, salt = 0) {
  const ordered = shuffle(optionCodes(subtask), makeRandom(questionSeed(exercise, subtask, salt)));
  return {
    options: ordered.map((code, index) => ({ n: index + 1, code })),
    answers: (Array.isArray(subtask.correct) ? subtask.correct : [])
      .map((code) => ({ code, n: optionNumber(ordered, code) }))
  };
}

// Символ базовой черты. В мастер-файле он нужен педагогу, чтобы читать ключ
// глазами, не открывая редактор: в блоке CJK Strokes это 一, 丨, 丿 и т. п.
export function strokeSymbol(code) {
  return Number.isInteger(code) && code > 0 ? String.fromCodePoint(code) : null;
}

// Картинки подзадания хранятся парой: gap — то, что уехал ученику, full —
// полный иероглиф для мастер-файла. Оба собираются из одного исходного SVG,
// поэтому пара всегда согласована между собой, а редактор кладёт в Map
// ровно `{ gap, full }` на каждый imageKey.
function requireImage(images, subtask, position, kind) {
  const image = images.get(subtask.imageKey);
  const value = typeof image === "string" ? image : image?.[kind];
  if (typeof value !== "string" || !value) {
    throw new Error(`Нет картинки (${kind}) для иероглифа ${position + 1} (${subtask.character})`);
  }
  return value;
}

// Ученический файл. Ровно то, что нужно, чтобы ответить: картинка с пропуском
// и пронумерованные варианты. Ничего, что выдаёт иероглиф или правильный ответ:
// номера перемешаны, и верный ответа не сидит на первой позиции.
export function buildStudentPayload(exercises, images, salt = 0) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: STUDENT_TYPE,
    generatedAt: new Date().toISOString(),
    setKey: makeSetKey(exercises.map((exercise) => exercise.id)),
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      subtasks: exercise.subtasks.map((subtask, position) => ({
        n: subtask.index,
        image: requireImage(images, subtask, position, "gap"),
        options: buildQuestion(exercise, subtask, salt).options
      }))
    }))
  };
}

// Мастер-файл: ключ задания, полный иероглиф, тот SVG, который уехал ученику,
// и номер верного варианта рядом с символом черты.
export function buildMasterPayload(exercises, images, salt = 0) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: MASTER_TYPE,
    generatedAt: new Date().toISOString(),
    setKey: makeSetKey(exercises.map((exercise) => exercise.id)),
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      title: exercise.title,
      phrase: exercise.phrase,
      subtasks: exercise.subtasks.map((subtask, position) => {
        const question = buildQuestion(exercise, subtask, salt);
        return {
          n: subtask.index,
          character: subtask.character,
          codePoint: subtask.character.codePointAt(0),
          cut: [...subtask.cut],
          image: requireImage(images, subtask, position, "full"),
          studentImage: requireImage(images, subtask, position, "gap"),
          options: question.options,
          answers: question.answers.map((answer, slot) => ({
            stroke: subtask.cut[slot],
            code: answer.code,
            symbol: strokeSymbol(answer.code),
            n: answer.n
          }))
        };
      })
    }))
  };
}
