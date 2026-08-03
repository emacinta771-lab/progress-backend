const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStudentAccountIdentity } = require('../utils/accountIdentity');

test('buildStudentAccountIdentity generates a unique username when the base name is taken', () => {
  const identity = buildStudentAccountIdentity({
    studentId: 'PROG101',
    firstName: 'John',
    lastName: 'Doe',
    username: 'john.doe',
    email: 'john.doe@example.com',
    existingUsernames: ['john.doe', 'john.doe1', 'john.doe2'],
    existingEmails: ['other@example.com']
  });

  assert.equal(identity.username, 'john.doe3');
  assert.equal(identity.email, 'john.doe@example.com');
});

test('buildStudentAccountIdentity falls back to the student ID when no base identity is available', () => {
  const identity = buildStudentAccountIdentity({
    studentId: 'PROG204',
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    existingUsernames: ['prog204'],
    existingEmails: ['student@example.com']
  });

  assert.equal(identity.username, 'prog204-1');
  assert.match(identity.email, /@school\.com$/);
});
