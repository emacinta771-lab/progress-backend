const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

class User {
  static async findByUsername(username) {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT id, username, email, first_name, last_name, role, 
              is_active, last_login, created_at 
       FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async create(userData) {
    const {
      username,
      email,
      password,
      first_name,
      last_name,
      role = 'teacher'
    } = userData;

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (
        username, email, password_hash, first_name, last_name, role
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, email, first_name, last_name, role, created_at`,
      [username, email, password_hash, first_name, last_name, role]
    );
    return result.rows[0];
  }

  static async comparePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  static generateToken(user) {
    const payload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name
    };

    return jwt.sign(
      payload, 
      process.env.JWT_SECRET, 
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
  }

  static async updateLastLogin(userId) {
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );
  }

  static async updatePassword(userId, newPassword) {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(newPassword, salt);
    
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [password_hash, userId]
    );
  }

  static async toggleStatus(userId) {
    const user = await pool.query(
      'SELECT is_active FROM users WHERE id = $1',
      [userId]
    );

    if (!user.rows[0]) {
      throw new Error('User not found');
    }

    const newStatus = !user.rows[0].is_active;
    await pool.query(
      'UPDATE users SET is_active = $1 WHERE id = $2',
      [newStatus, userId]
    );

    return newStatus;
  }
}

module.exports = User;