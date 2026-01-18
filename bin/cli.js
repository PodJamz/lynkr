#!/usr/bin/env node

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const pkg = require('../package.json');
  console.log(pkg.version);
  process.exit(0);
}

require("../index.js");
