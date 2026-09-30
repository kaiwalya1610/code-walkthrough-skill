// Explicit, JSON-only checkpoints. One output file per worker/process.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';

export function record(path, id, state, { repo, sources }) {
  const root = realpathSync(repo);
  const hashes = {};
  for (const name of sources) {
    const source = realpathSync(resolve(root, name));
    const rel = relative(root, source);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`Source must be inside repo: ${name}`);
    }
    hashes[rel.split('\\').join('/')] = createHash('sha256').update(readFileSync(source)).digest('hex');
  }
  const serialized = JSON.stringify({ id, state, sources: hashes }, (_, value) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' ||
        (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('Checkpoints must contain explicit JSON values');
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new Error('Convert domain objects, Map and Set to plain JSON values before capture');
    }
    return value;
  });
  appendFileSync(path, serialized + '\n', 'utf8');
}
