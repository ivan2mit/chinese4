// Единственная точка, через которую задания берут модули редактора.
// При внедрении в общую сборку меняются только пути в этом файле.
export { parseAcjk, strokeGroups, strokeNames } from "../public/acjk.js";
export { decodeStrokes } from "../public/stroke-map.js";
export { fnv1a, makeRandom, shuffle } from "../public/random.js";
export { splitPhrase } from "../public/phrase.js";
export { makeKey, makeSetKey, uniqueId } from "../public/tasks.js";
