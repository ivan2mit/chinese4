// Детерминированные псевдослучайные числа и перестановки.
//
// Зачем не Math.random: порядок вариантов должен совпадать в двух местах —
// в предпросмотре, который смотрит педагог, и в выгруженном ученическом
// файле. Один и тот же seed даёт одну и ту же перестановку, а «перемешать»
// меняет seed, и всё переставляется заново.

// FNV-1a, 32 бита. Из строки seed — целое число по модулю 2^32.
export function fnv1a(value) {
  const input = String(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Генератор mulberry32: быстрый, без состояния кроме одного 32-битного числа,
// воспроизводимый из seed в любом браузере. Возвращает функцию → [0, 1).
export function makeRandom(seed) {
  let state = fnv1a(seed);
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Тасование Фишера—Йетса. Возвращает новый массив, исходный не трогает.
export function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
