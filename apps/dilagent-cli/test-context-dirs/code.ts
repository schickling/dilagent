export function processData(input: string): string {
  // Bug: this function has synchronization issues
  let result = '';
  
  setTimeout(() => {
    result = input.toUpperCase();
  }, 10);
  
  // Returns empty string instead of processed result
  return result;
}
