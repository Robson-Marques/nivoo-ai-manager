/** Prioritize an actual failed assertion/exception over a trailing successful
 * test summary. The output is untrusted evidence, never a command to execute. */
export function verificationDiagnostic(output:string):string {
  const lines=output.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').split(/\r?\n/).map(l=>l.trim());
  const strong=lines.filter(l=>!/\[VersionHelper\]|npm warn|npm WARN|deprecated/i.test(l)&&
    /(?:AssertionError|TimeoutError|TypeError|ReferenceError|SyntaxError|Error \[ERR_[A-Z_]+\]|(?:^|\s)Error:|^FAIL\s|^not ok\s|^npm (?:ERR!|error) code|error TS\d+|(?:^|\s)Assertion failed)/i.test(l));
  // Prefer assertions over incidental errors from unrelated tools.
  const assertions=strong.filter(l=>/AssertionError|Assertion failed|TimeoutError|^FAIL\s|^not ok\s/i.test(l));
  return [...new Set(assertions.length?assertions:strong)].slice(-8).map(l=>l.slice(0,450)).join('\n').slice(0,3000);
}
