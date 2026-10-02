// Разбор строки ввода: фраза → список иероглифов + список отброшенных
// символов. Вынесено из editor.js, чтобы покрыть тестом: молча пропущенный
// символ ломает задание.
//
// Разбивка идёт по графемам, а не по UTF-16: сурогатные пары (например,
// черта ㇀ = U+31C0) иначе распались бы на два символа.
const GLYPH_PATTERN = /^[\u2E80-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{2FA1F}\u31C0-\u31E3]$/u;
const SEGMENTER = new Intl.Segmenter("zh", { granularity: "grapheme" });

// В задание попадают только иероглифы и базовые черты. Пунктуация, цифры,
// пробелы и латиница отбрасываются, но возвращаются отдельно: педагог должен
// знать, что символ из его фразы в задание не вошёл.
export function splitPhrase(value) {
  const segments = [...SEGMENTER.segment(value)]
    .map(({ segment }) => segment)
    .filter((character) => character.trim().length > 0);
  return {
    glyphs: segments.filter((character) => GLYPH_PATTERN.test(character)),
    skipped: segments.filter((character) => !GLYPH_PATTERN.test(character))
  };
}