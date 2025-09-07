import { processData } from './code.ts';

console.log('Testing processData function...');
const result = processData('hello world');
console.log('Result:', result);
console.log('Expected: HELLO WORLD');
console.log('Actual: empty string (bug!)');
