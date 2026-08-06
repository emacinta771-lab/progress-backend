const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { verifyPassword } = require('../utils/password');

test('verifyPassword accepts bcrypt hashes when present', async () => {
  const plainPassword = 'Secret123!';
  const hash = await bcrypt.hash(plainPassword, 10);
  const result = await verifyPassword(plainPassword, { password_hash: hash });

  assert.equal(result.valid, true);
  assert.equal(result.needsRehash, false);
});

test('verifyPassword falls back to a plain-text password when the hash is missing', async () => {
  const plainPassword = 'Secret123!';
  const result = await verifyPassword(plainPassword, { password_plain: plainPassword });

  assert.equal(result.valid, true);
  assert.equal(result.needsRehash, true);
});
