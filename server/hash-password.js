#!/usr/bin/env node
const { hashPassword } = require('./auth');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node server/hash-password.js <password>');
  process.exit(1);
}

console.log(hashPassword(password));
