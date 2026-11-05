import { findVariableNames, resolveVariables } from './variable.util';

describe('resolveVariables', () => {
  const vars = new Map([
    ['baseUrl', 'http://localhost:8080'],
    ['token', 'abc'],
  ]);

  it('replaces known variables, tolerating inner whitespace', () => {
    const result = resolveVariables('{{baseUrl}}/users?t={{ token }}', vars);
    expect(result.text).toBe('http://localhost:8080/users?t=abc');
    expect(result.unresolved).toEqual([]);
  });

  it('leaves unknown variables as written and reports each once', () => {
    const result = resolveVariables('{{a}} {{a}} {{b}}', vars);
    expect(result.text).toBe('{{a}} {{a}} {{b}}');
    expect(result.unresolved).toEqual(['a', 'b']);
  });

  it('does not expand placeholders inside substituted values', () => {
    const result = resolveVariables('{{x}}', new Map([['x', '{{x}}']]));
    expect(result.text).toBe('{{x}}');
  });

  it('ignores inherited object properties', () => {
    const result = resolveVariables('{{constructor}} {{__proto__}}', vars);
    expect(result.unresolved).toEqual(['constructor', '__proto__']);
  });

  it('keeps empty-string values', () => {
    expect(resolveVariables('a{{e}}b', new Map([['e', '']])).text).toBe('ab');
  });

  it('lists referenced names', () => {
    expect(findVariableNames('{{a}}{{b}}{{a}}')).toEqual(['a', 'b']);
  });
});
