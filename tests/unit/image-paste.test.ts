import { describe, expect, test } from 'vitest';
import {
  expandImageName,
  extForMime,
  IMAGE_PICK_ACCEPT,
  IMAGE_PICK_EXTENSIONS,
  imageMarkdownRef,
  isValidImageFolder,
  pickedImageName,
  sanitizeImageName,
} from '../../src/lib/imagePaste';

const ctx = (existing: string[], docName = 'mods') => ({
  docName,
  now: new Date(2026, 6, 12, 14, 30, 59), // 2026-07-12 14:30:59 local
  exists: (fn: string) => existing.some((e) => e.toLowerCase() === fn.toLowerCase()),
});

describe('SPEC20 §1 pasted-image naming', () => {
  test('U43: pattern expansion — tokens, smallest free {n}, implicit " {n}" on collision', () => {
    // {doc} {n}: first paste, then the next free number (case-insensitively).
    expect(expandImageName('{doc} {n}', 'png', ctx([]))).toBe('mods 1.png');
    expect(expandImageName('{doc} {n}', 'png', ctx(['mods 1.png']))).toBe('mods 2.png');
    expect(expandImageName('{doc} {n}', 'png', ctx(['MODS 1.PNG', 'mods 2.png']))).toBe('mods 3.png');
    // Gaps fill: 1 taken, 3 taken → 2.
    expect(expandImageName('image-{n}', 'png', ctx(['image-1.png', 'image-3.png']))).toBe('image-2.png');

    // {date}/{time} expand against the injected clock.
    expect(expandImageName('{doc}-{date}', 'png', ctx([]))).toBe('mods-2026-07-12.png');
    expect(expandImageName('shot-{time}', 'png', ctx([]))).toBe('shot-143059.png');

    // No {n} in the pattern: plain name first, implicit " {n}" once it collides
    // — paste never overwrites an existing file.
    expect(expandImageName('photo', 'png', ctx([]))).toBe('photo.png');
    expect(expandImageName('photo', 'png', ctx(['photo.png']))).toBe('photo 1.png');
    expect(expandImageName('photo', 'png', ctx(['photo.png', 'photo 1.png']))).toBe('photo 2.png');

    // Empty pattern falls back to the default shape.
    expect(expandImageName('', 'png', ctx([]))).toBe('mods 1.png');

    // Extension comes from the clipboard MIME type.
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/gif')).toBe('gif');
    expect(extForMime('image/webp')).toBe('webp');
    expect(extForMime('image/tiff')).toBe('png'); // anything exotic lands as png
  });

  test('U44: filename sanitization — forbidden chars, reserved basenames, never empty', () => {
    // Forbidden filesystem/markdown characters are stripped; spaces survive.
    expect(sanitizeImageName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(sanitizeImageName('my shot 1')).toBe('my shot 1');
    // Control characters go too.
    expect(sanitizeImageName('bad\u0007name')).toBe('badname');
    // Windows rejects trailing/leading dots and spaces.
    expect(sanitizeImageName(' . name . ')).toBe('name');
    // Reserved basenames get the -img suffix, any case.
    expect(sanitizeImageName('con')).toBe('con-img');
    expect(sanitizeImageName('NUL')).toBe('NUL-img');
    expect(sanitizeImageName('Com3')).toBe('Com3-img');
    expect(sanitizeImageName('lpt9')).toBe('lpt9-img');
    // "aux 1" is not reserved (only the exact basename is).
    expect(sanitizeImageName('aux 1')).toBe('aux 1');
    // Nothing left → fall back, never an empty name.
    expect(sanitizeImageName('')).toBe('image');
    expect(sanitizeImageName('///:::')).toBe('image');

    // End to end: a document literally named "con.md" pastes safely.
    expect(expandImageName('{doc}', 'png', ctx([], 'con'))).toBe('con-img.png');

    // The inserted markdown percent-encodes spaces and parens.
    expect(imageMarkdownRef('images', 'mods 1.png')).toBe('![mods 1](images/mods%201.png)');
    expect(imageMarkdownRef('images', 'shot (2).png')).toBe('![shot (2)](images/shot%20%282%29.png)');

    // Folder validation: single path segment only.
    expect(isValidImageFolder('images')).toBe(true);
    expect(isValidImageFolder('my images')).toBe(true);
    expect(isValidImageFolder('')).toBe(false);
    expect(isValidImageFolder('  ')).toBe(false);
    expect(isValidImageFolder('a/b')).toBe(false);
    expect(isValidImageFolder('a\\b')).toBe(false);
    expect(isValidImageFolder('..')).toBe(false);
    expect(isValidImageFolder('.')).toBe(false);
  });
  test('U1222: a PICKED image keeps its own name — sanitized, extension preserved, numbered past collisions', () => {
    // SPEC20 follow-up (issue #266): the one naming rule both Insert Image…
    // seams use — a desktop path's basename and a hosted picker's File.name
    // land under the same name, so the flavors cannot drift.
    const taken = (existing: string[]) => (fn: string) => existing.some((e) => e.toLowerCase() === fn.toLowerCase());
    expect(pickedImageName('logo.png', taken([]))).toBe('logo.png');
    // Extension case is normalized; the stem's spaces survive.
    expect(pickedImageName('My Shot.JPG', taken([]))).toBe('My Shot.jpg');
    // A collision numbers rather than overwrites — case-insensitively.
    expect(pickedImageName('logo.png', taken(['LOGO.PNG']))).toBe('logo 1.png');
    expect(pickedImageName('logo.png', taken(['logo.png', 'logo 1.png']))).toBe('logo 2.png');
    // Filesystem-hostile characters and reserved basenames are sanitized.
    expect(pickedImageName('a/b:c*.png', taken([]))).toBe('abc.png');
    expect(pickedImageName('con.png', taken([]))).toBe('con-img.png');
    // No extension at all ⇒ png; a dotfile has no stem to split on either.
    expect(pickedImageName('screenshot', taken([]))).toBe('screenshot.png');
    expect(pickedImageName('.hidden', taken([]))).toBe('hidden.png');
    // Nothing usable left still yields a name, never an empty one.
    expect(pickedImageName('///:::.png', taken([]))).toBe('image.png');
  });

  test('U1223: the picker offers the image types, one list for both pickers', () => {
    // SPEC20 follow-up (issue #266): the desktop dialog's filter list is the
    // reference; the hosted browser input's accept value is derived from it.
    expect(IMAGE_PICK_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
    expect(IMAGE_PICK_ACCEPT).toBe('.png,.jpg,.jpeg,.gif,.webp,.svg');
  });
});
