import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickIdentifiers } from '../src/context/identifiers';

describe('pickIdentifiers', () => {
  it('lists unique symbols in order of first use', () => {
    const code = 'const total = formatPrice(cartTotal(items), currency); formatPrice(total);';
    assert.deepEqual(
      pickIdentifiers(code, 'typescript').map((i) => i.name),
      ['total', 'formatPrice', 'cartTotal', 'items', 'currency'],
    );
  });

  it('skips keywords, built-ins, short names and properties', () => {
    const code = 'if (user.address) { return Math.max(a, user.age) } console.log(x)';
    assert.deepEqual(pickIdentifiers(code, 'typescript').map((i) => i.name), ['user']);
  });

  it('ignores words inside strings and comments', () => {
    const code = '// call fetchUser here\nconst label = "fetchOrders"; render(label)';
    assert.deepEqual(pickIdentifiers(code, 'typescript').map((i) => i.name), ['label', 'render']);
  });

  it('reports the offset of the first use', () => {
    const [first] = pickIdentifiers('   handler()', 'javascript');
    assert.equal(first.offset, 3);
  });
});
