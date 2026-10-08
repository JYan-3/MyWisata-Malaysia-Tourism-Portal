import { describe, expect, it } from 'vitest';
import braces from 'braces';

const braceApi = braces as unknown as {
  parse(input: string): unknown;
  compile(input: string | Record<string, unknown>): unknown;
  expand(input: string | Record<string, unknown>): unknown;
  stringify(input: string | Record<string, unknown>): unknown;
};

const nestedPattern = (depth: number) => '{'.repeat(depth) + 'x' + '}'.repeat(depth);
const nestedAst = (depth: number) => {
  let node: Record<string, unknown> = { type: 'text', value: 'x' };
  for (let index = 0; index < depth; index += 1) {
    node = { type: 'paren', nodes: [node] };
  }
  return { type: 'root', nodes: [node] };
};

describe('braces nesting depth guard', () => {
  it.each(['parse', 'compile', 'expand', 'stringify'] as const)(
    'rejects deeply nested string input in %s with a controlled error',
    (method) => {
      expect(() => braceApi[method](nestedPattern(3500))).toThrowError(
        /maximum nesting depth/i,
      );
    },
  );

  it('preserves ordinary brace expansion and compilation', () => {
    expect(braceApi.expand('a{1..3}b{c,d}')).toEqual([
      'a1bc',
      'a1bd',
      'a2bc',
      'a2bd',
      'a3bc',
      'a3bd',
    ]);
    expect(braceApi.compile('a{1..3}b{c,d}')).toBe('a([1-3])b(c|d)');
  });

  it.each(['compile', 'expand', 'stringify'] as const)(
    'guards deeply nested AST input in %s',
    (method) => {
      expect(() => braceApi[method](nestedAst(3500))).toThrowError(
        /maximum nesting depth/i,
      );
    },
  );

  it('rejects cyclic AST parent links with a controlled depth error', () => {
    let parentReads = 0;
    const cyclicParent: Record<string, unknown> = {
      type: 'paren',
      nodes: [],
    };
    Object.defineProperty(cyclicParent, 'parent', {
      get: () => {
        parentReads += 1;
        if (parentReads > 1000) throw new Error('unbounded parent traversal');
        return cyclicParent;
      },
    });
    (cyclicParent.nodes as unknown[]).push({
      type: 'paren',
      nodes: [{ type: 'text', value: 'x' }],
    });

    expect(() => braceApi.expand({ type: 'root', nodes: [cyclicParent] })).toThrowError(
      /maximum nesting depth/i,
    );
  });

  it('bounds cyclic parent traversal before entering a child block', () => {
    let parentReads = 0;
    const root: Record<string, unknown> = { type: 'root', nodes: [] };
    const parent: Record<string, unknown> = { type: 'paren', nodes: [] };
    Object.defineProperty(parent, 'parent', {
      get: () => {
        parentReads += 1;
        if (parentReads > 1000) throw new Error('unbounded parent traversal');
        return parentReads === 1 ? root : parent;
      },
    });
    (parent.nodes as unknown[]).push({ type: 'paren', nodes: [] });
    (root.nodes as unknown[]).push(parent);

    expect(() => braceApi.expand(root)).toThrowError(/maximum nesting depth/i);
  });
});
