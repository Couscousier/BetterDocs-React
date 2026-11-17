const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...args: unknown[]) => console.log(`[${stamp()}]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${stamp()}] ⚠`, ...args),
  error: (...args: unknown[]) => console.error(`[${stamp()}] ✖`, ...args),
  action: (...args: unknown[]) => console.log(`[${stamp()}] ▶`, ...args),
};
