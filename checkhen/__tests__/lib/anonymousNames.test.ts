import { generateAnonymousName, generateUniqueAnonymousName } from '@/lib/anonymousNames';

describe('generateAnonymousName', () => {
  it('returns a string with two words separated by a space', () => {
    const name = generateAnonymousName();
    expect(typeof name).toBe('string');
    const parts = name.split(' ');
    expect(parts.length).toBe(2);
  });

  it('starts with a capital letter', () => {
    const name = generateAnonymousName();
    expect(name[0]).toBe(name[0].toUpperCase());
  });
});

describe('generateUniqueAnonymousName', () => {
  it('returns a name not in the existing list', () => {
    const existing = ['Swift Panda', 'Blue Eagle'];
    const name = generateUniqueAnonymousName(existing);
    expect(existing).not.toContain(name);
  });

  it('returns a unique name even with many existing names', () => {
    // Fill a large set and ensure it still finds a unique one
    const existing: string[] = [];
    for (let i = 0; i < 20; i++) {
      const name = generateUniqueAnonymousName(existing);
      expect(existing).not.toContain(name);
      existing.push(name);
    }
  });
});
