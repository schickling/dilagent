const { add, multiply } = require('./calculator');

function test(description, fn) {
  try {
    fn();
    console.log(`✓ ${description}`);
  } catch (error) {
    console.log(`✗ ${description}`);
    console.log(`  Error: ${error.message}`);
    process.exitCode = 1;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    }
  };
}

test('add should return sum of two numbers', () => {
  expect(add(2, 3)).toBe(5);
  expect(add(-1, 1)).toBe(0);
  expect(add(10, 20)).toBe(30);
});

test('multiply should return product of two numbers', () => {
  expect(multiply(2, 3)).toBe(6);
  expect(multiply(-2, 4)).toBe(-8);
  expect(multiply(0, 100)).toBe(0);
});