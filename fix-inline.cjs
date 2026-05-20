const fs = require('fs');

// Read the JSON
const companies = JSON.parse(fs.readFileSync('/Users/aronrosenfield/conscious-consumer/src/companies.json', 'utf8'));
console.log('Companies to inline:', companies.length);

// Read app
let app = fs.readFileSync('/Users/aronrosenfield/conscious-consumer/src/app.jsx', 'utf8');

// Remove JSON import
app = app.replace("import COMPANIES from './companies.json';\n", '');
app = app.replace("import { COMPANIES } from './companies.js';\n", '');

// Find QUIZ STEPS and insert companies before it
const marker = '// ─── QUIZ STEPS';
const pos = app.indexOf(marker);
if (pos === -1) { console.log('Cannot find marker'); process.exit(1); }

const companiesCode = `const COMPANIES = ${JSON.stringify(companies)};\n\n`;
app = app.slice(0, pos) + companiesCode + app.slice(pos);

fs.writeFileSync('/Users/aronrosenfield/conscious-consumer/src/app.jsx', app);
console.log('Done! App size:', fs.statSync('/Users/aronrosenfield/conscious-consumer/src/app.jsx').size, 'bytes');
