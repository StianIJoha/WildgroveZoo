// Bundles src/ into one self-contained index.html (works on Windows, macOS, Linux).
// Usage: node build.js
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const parts = [
  src('shell.html'),
  '<script>\n' + src('art.js') + '\n</script>',
  '<script>\n' + src('data.js') + '\n</script>',
  '<script>\n' + src('engine.js') + '\n</script>',
];
const out = path.join(__dirname, 'index.html');
fs.writeFileSync(out, parts.join('\n'));
console.log(`Built ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
