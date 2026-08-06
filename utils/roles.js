function normalizeUserRole(role) {
  const normalized = String(role || '').trim().toLowerCase();

  if (['admin', 'teacher', 'accountant', 'student', 'parent'].includes(normalized)) {
    return normalized;
  }

  return 'teacher';
}

module.exports = {
  normalizeUserRole
};
