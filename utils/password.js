const bcrypt = require('bcryptjs');

async function verifyPassword(plainPassword, userRecord) {
  if (!plainPassword) {
    return { valid: false, needsRehash: false };
  }

  const normalized = userRecord || {};
  const hash = normalized.password_hash;
  const plain = normalized.password_plain;

  if (hash) {
    try {
      const valid = await bcrypt.compare(plainPassword, hash);
      return {
        valid,
        needsRehash: false,
        matchedHash: valid
      };
    } catch (error) {
      console.warn('⚠️ Password hash comparison failed:', error.message);
    }
  }

  if (plain && plain === plainPassword) {
    return {
      valid: true,
      needsRehash: true,
      matchedPlain: true
    };
  }

  return {
    valid: false,
    needsRehash: false
  };
}

module.exports = {
  verifyPassword
};
