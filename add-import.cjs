const fs = require('fs');
let app = fs.readFileSync('/Users/aronrosenfield/conscious-consumer/src/App.jsx', 'utf8');
if (!app.includes("import { COMPANIES }")) {
  app = `import { COMPANIES } from './companies.js';\n` + app;
  fs.writeFileSync('/Users/aronrosenfield/conscious-consumer/src/App.jsx', app);
  console.log('Added import');
} else {
  console.log('Import already exists');
}
