import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export const audioCacheKey = settings => createHash('sha256').update(JSON.stringify(settings)).digest('hex');
export class TtsCache {
  constructor(directory, { maxEntries = 256, maxBytes = 128 * 1024 * 1024 } = {}) { this.directory = directory; this.maxEntries = maxEntries; this.maxBytes = maxBytes; }
  async get(key) {
    if (!this.directory) return null;
    try { const data = await readFile(join(this.directory, `${key}.mp3`)); return data.length && data.length <= 8 * 1024 * 1024 ? data : null; } catch { return null; }
  }
  async put(key, audio, signal) {
    if (!this.directory || signal?.aborted) return;
    let temporary;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      temporary = join(this.directory, `${key}.${randomUUID()}.tmp`);
      await writeFile(temporary, audio, { mode: 0o600 });
      signal?.throwIfAborted();
      await rename(temporary, join(this.directory, `${key}.mp3`));
      const files = await readdir(this.directory);
      const entries = (await Promise.all(files.filter(name => /^[a-f0-9]{64}\.mp3$/.test(name)).map(async name => {
        try { const info = await stat(join(this.directory, name)); return { name, size: info.size, time: info.mtimeMs }; } catch { return null; }
      }))).filter(Boolean).sort((a, b) => b.time - a.time);
      let size = 0;
      for (const [index, entry] of entries.entries()) { size += entry.size; if (index >= this.maxEntries || size > this.maxBytes) await unlink(join(this.directory, entry.name)).catch(() => {}); }
    } catch { /* Cache write failures must not prevent playback of generated speech. */ }
    finally { if (temporary) await unlink(temporary).catch(() => {}); }
  }
}
