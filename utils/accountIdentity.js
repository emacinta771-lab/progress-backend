function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '');
}

function makeUniqueValue(baseValue, existingValues = [], suffixGenerator = (value, index) => `${value}${index > 0 ? index : ''}`) {
  const normalizedBase = String(baseValue || '').trim();
  if (!normalizedBase) {
    return '';
  }

  const values = new Set(existingValues.map((value) => String(value || '').trim().toLowerCase()));
  if (!values.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let index = 1;
  let candidate = '';
  while (index <= 1000) {
    candidate = suffixGenerator(normalizedBase, index);
    if (!values.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }

  return `${normalizedBase}${Date.now()}`;
}

function buildStudentAccountIdentity({ studentId, firstName, lastName, username, email, existingUsernames = [], existingEmails = [] }) {
  const cleanedFirst = String(firstName || '').trim();
  const cleanedLast = String(lastName || '').trim();
  const cleanedStudentId = String(studentId || '').trim();

  let baseUsername = String(username || '').trim();
  if (!baseUsername) {
    if (cleanedFirst && cleanedLast) {
      baseUsername = `${slugify(cleanedFirst)}.${slugify(cleanedLast)}`;
    } else if (cleanedStudentId) {
      baseUsername = slugify(cleanedStudentId);
    } else {
      baseUsername = 'student';
    }
  }

  let baseEmail = String(email || '').trim();
  if (!baseEmail) {
    if (baseUsername) {
      baseEmail = `${baseUsername}@school.com`;
    } else if (cleanedStudentId) {
      baseEmail = `${slugify(cleanedStudentId)}@school.com`;
    } else {
      baseEmail = 'student@school.com';
    }
  }

  const shouldUseHyphenatedSuffix = baseUsername.toLowerCase().includes('prog') || baseUsername.toLowerCase().includes('std');
  const uniqueUsername = makeUniqueValue(baseUsername, existingUsernames, (value, index) => {
    if (index === 1) {
      return shouldUseHyphenatedSuffix ? `${value}-1` : `${value}1`;
    }
    return shouldUseHyphenatedSuffix ? `${value}-${index}` : `${value}${index}`;
  });

  const uniqueEmail = makeUniqueValue(baseEmail, existingEmails, (value, index) => {
    if (index <= 1) {
      return value;
    }
    const [localPart, domainPart] = value.split('@');
    if (!domainPart) {
      return `${value}${index}`;
    }
    return `${localPart}${index}@${domainPart}`;
  });

  return {
    username: uniqueUsername || baseUsername,
    email: uniqueEmail || baseEmail
  };
}

module.exports = {
  buildStudentAccountIdentity,
  makeUniqueValue,
  slugify
};
