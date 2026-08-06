import { describe, expect, it } from 'vitest';
import {
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  uploadExtension,
  uploadRejection,
  uploadTypeRejection,
} from '../../src/lib/fileTransfer';
import { isMarkdownFile } from '../../src/lib/folderTree';

// PRD 007 Req 19: the upload rule the client rejects with and the server
// enforces independently — the cap and the allowlist. Pure: no DOM, no
// server, no platform.

describe('PRD 007 Req 19 upload rule', () => {
  it('U295: the 20 MB cap is enforced, and the message names the limit', () => {
    expect(UPLOAD_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(uploadRejection('notes.md', UPLOAD_MAX_BYTES)).toBeNull(); // exactly at the cap is fine
    expect(uploadRejection('notes.md', UPLOAD_MAX_BYTES - 1)).toBeNull();
    const tooBig = uploadRejection('notes.md', UPLOAD_MAX_BYTES + 1);
    expect(tooBig).toMatch(/20 MB/);
    expect(tooBig).toMatch(/notes\.md/);
    // Size is judged before type: an oversize .exe reports the size, the one
    // rule renaming cannot work around.
    expect(uploadRejection('virus.exe', UPLOAD_MAX_BYTES + 1)).toMatch(/20 MB/);
  });

  it('U296: only Markdown and the asset types the app renders are allowed', () => {
    // The allowlist IS Markdown (folderTree's own test) plus the rendered set.
    expect(UPLOAD_EXTENSIONS.filter((e) => isMarkdownFile(`x.${e}`))).toEqual(['md', 'markdown']);
    expect([...UPLOAD_EXTENSIONS]).toEqual(['md', 'markdown', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
    for (const ext of UPLOAD_EXTENSIONS) {
      expect(uploadRejection(`file.${ext}`, 10), ext).toBeNull();
      expect(uploadRejection(`FILE.${ext.toUpperCase()}`, 10), ext).toBeNull(); // case-insensitive
    }
    // A rejection names the offending extension AND the allowed set, so the
    // user knows what would work.
    const bad = uploadRejection('report.pdf', 10);
    expect(bad).toMatch(/\.pdf/);
    expect(bad).toMatch(/\.md/);
    for (const name of ['archive.zip', 'run.exe', 'notes.txt', 'page.html']) {
      expect(uploadRejection(name, 10), name).toBeTypeOf('string');
    }
    // No extension at all is its own message, not a confusing “.” one.
    expect(uploadRejection('README', 10)).toMatch(/no file extension/);
    expect(uploadExtension('README')).toBe('');
    expect(uploadExtension('.hidden')).toBe(''); // a leading dot is not an extension
    expect(uploadExtension('a.b.PNG')).toBe('png');
    // The type half stands alone — it is what the server answers 415 from,
    // before a byte of the body has arrived — and says the same thing.
    expect(uploadTypeRejection('notes.md')).toBeNull();
    expect(uploadTypeRejection('report.pdf')).toBe(uploadRejection('report.pdf', 10));
  });
});
