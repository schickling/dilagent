function add(a, b) {
  return a - b; // Bug: using subtraction instead of addition
}

function multiply(a, b) {
  return a * b;
}

module.exports = {
  add,
  multiply
};