// Simulação em memória do DSL sdk/db (apenas o subconjunto usado). NÃO é a plataforma.
export const table = (name, cols, extra) => {
  const t = { __name: name, __cols: cols };
  for (const [k, c] of Object.entries(cols)) t[k] = { __table: name, key: k, col: c };
  return t;
};
const chain = () => { const o = {}; for (const m of ['primaryKey','notNull','default','unique']) o[m] = () => o; return o; };
export const integer = () => chain(); export const text = () => chain(); export const json = () => chain();
export const uniqueIndex = () => ({ on: () => ({}) }); export const index = () => ({ on: () => ({}) });
export const eq = (c, v) => ({ f: (r) => r[c.key] === v });
export const and = (...xs) => ({ f: (r) => xs.every((x) => x.f(r)) });
export const desc = (c) => ({ key: c.key, dir: -1 }); export const asc = (c) => ({ key: c.key, dir: 1 });
