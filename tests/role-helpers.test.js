const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUserRole } = require('../utils/roles');

test('normalizeUserRole accepts teacher and accountant roles', () => {
  assert.equal(normalizeUserRole('teacher'), 'teacher');
  assert.equal(normalizeUserRole('accountant'), 'accountant');
  assert.equal(normalizeUserRole('ADMIN'), 'admin');
});

test('normalizeUserRole falls back to teacher for unsupported roles', () => {
  assert.equal(normalizeUserRole('superuser'), 'teacher');
  assert.equal(normalizeUserRole(''), 'teacher');
});
