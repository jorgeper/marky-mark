import { describe, expect, test } from 'vitest';
import { hasRemoteUrls, idFromFilename, parseTheme } from '../../src/lib/themes';

describe('theme parsing', () => {
  test('U6: metadata parser extracts @name/@variant/@author; malformed metadata falls back to filename and never throws', () => {
    const css = `/* @name: Midnight Ocean\n   @author: jorge\n   @variant: dark */\n.theme-root { --mm-bg: #0b1622; }`;
    const t = parseTheme('midnight-ocean.css', css, false);
    expect(t).not.toBeNull();
    expect(t!.name).toBe('Midnight Ocean');
    expect(t!.author).toBe('jorge');
    expect(t!.variant).toBe('dark');
    expect(t!.id).toBe('midnight-ocean');
    expect(t!.builtin).toBe(false);

    // No metadata block at all → filename-derived name, light default, no throw.
    const bare = parseTheme('my_cool-theme.css', '.theme-root { --mm-bg: #fff; }', true);
    expect(bare).not.toBeNull();
    expect(bare!.name).toBe('My Cool Theme');
    expect(bare!.variant).toBe('light');
    expect(bare!.builtin).toBe(true);

    // Malformed/partial metadata → parses what it can, falls back for the rest.
    const partial = parseTheme('weird.css', '/* @variant: DARK\nnot-a-key */ .theme-root { color: red; }', false);
    expect(partial).not.toBeNull();
    expect(partial!.name).toBe('Weird');
    expect(partial!.variant).toBe('dark');
    expect(partial!.author).toBe('unknown');

    // Empty file is rejected (null), not an exception.
    expect(parseTheme('empty.css', '   \n', false)).toBeNull();
    expect(idFromFilename('My Theme (v2).css')).toBe('my-theme-v2');
  });

  test('U7: themes containing remote url(http…) references are rejected', () => {
    const remote = `/* @name: Sneaky */\n.theme-root { background: url("https://evil.example/bg.png"); }`;
    expect(hasRemoteUrls(remote)).toBe(true);
    expect(parseTheme('sneaky.css', remote, false)).toBeNull();

    const protocolRelative = `.theme-root { background: url(//cdn.example/x.png); }`;
    expect(parseTheme('sneaky2.css', protocolRelative, false)).toBeNull();

    const httpSingle = `.theme-root h1 { list-style-image: url('http://x.example/dot.gif'); }`;
    expect(parseTheme('sneaky3.css', httpSingle, false)).toBeNull();

    // Local/data urls are fine.
    const local = `.theme-root { background: url(data:image/png;base64,AAAA); }`;
    expect(hasRemoteUrls(local)).toBe(false);
    expect(parseTheme('ok.css', local, false)).not.toBeNull();
  });
});
