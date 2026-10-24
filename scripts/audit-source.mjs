import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = ['.gitignore', 'LICENSE', 'README.md', 'package.json', 'manifest.json', 'background.js', 'content.js', 'content.css', 'network-player.js', 'popup.html', 'popup.js', 'scripts/audit-source.mjs', 'docs/carousel.png'];
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['machine-specific path', /(?:[A-Z]:[\\/]Users[\\/]|\/home\/|\/Users\/)[A-Za-z0-9_.-]+/i],
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['work identity', new RegExp(['hea', 'huja', '_', 'cis', 'co'].join(''), 'i')]
];
let failed = false;
for (const file of files) {
  if (!existsSync(file)) { console.error(`Missing publishable file: ${file}`); failed = true; continue; }
  if (file.endsWith('.png')) continue;
  const source = readFileSync(file, 'utf8');
  for (const [name, pattern] of rules) {
    if (pattern.test(source)) { console.error(`${file}: possible ${name}`); failed = true; }
  }
}
try {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).filter(Boolean);
  for (const file of tracked) {
    if (!files.includes(file)) { console.error(`Unexpected publishable file: ${file}`); failed = true; }
  }
} catch { /* File content checks also work before git init. */ }
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (manifest.host_permissions.some(host => !/^https:\/\/(?:www\.|\*\.)?nba\.com\/\*$/.test(host))) {
  console.error('Unexpected extension host permission'); failed = true;
}
if (failed) process.exit(1);
console.log(`Source audit passed: ${files.length} allowlisted files; no credential-pattern or personal/work identity matches.`);
