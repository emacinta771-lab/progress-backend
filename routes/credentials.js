const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

// ==========================================
// GET ALL STUDENT CREDENTIALS
// ==========================================
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        sc.id,
        sc.student_id,
        sc.student_code,
        sc.student_name,
        sc.username,
        sc.email,
        sc.password_plain as password,
        sc.created_at,
        sc.updated_at,
        sc.status,
        sc.last_login,
        u.first_name as created_by_name
      FROM student_credentials sc
      LEFT JOIN users u ON sc.created_by = u.id
      ORDER BY sc.created_at DESC
    `);
    
    res.json({
      success: true,
      credentials: result.rows
    });
  } catch (error) {
    console.error('Error fetching credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET CREDENTIALS BY STUDENT ID
// ==========================================
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        sc.id,
        sc.student_id,
        sc.student_code,
        sc.student_name,
        sc.username,
        sc.email,
        sc.password_plain as password,
        sc.created_at,
        sc.updated_at,
        sc.status,
        sc.last_login
      FROM student_credentials sc
      WHERE sc.student_id = $1
    `, [studentId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Credentials not found for this student' 
      });
    }
    
    res.json({
      success: true,
      credential: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching credential:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// CREATE STUDENT CREDENTIALS
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { 
      student_id, 
      student_code, 
      student_name, 
      username, 
      email, 
      password,
      created_by
    } = req.body;
    
    if (!student_id || !student_name || !username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student ID, name, username, email, and password are required' 
      });
    }
    
    const existing = await pool.query(
      'SELECT id FROM student_credentials WHERE student_id = $1',
      [student_id]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: 'Credentials already exist for this student' 
      });
    }
    
    const existingUser = await pool.query(
      'SELECT id FROM student_credentials WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: 'Username or email already exists' 
      });
    }
    
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    
    const result = await pool.query(`
      INSERT INTO student_credentials (
        student_id,
        student_code,
        student_name,
        username,
        email,
        password_hash,
        password_plain,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [student_id, student_code, student_name, username, email, password_hash, password, created_by || null]);
    
    const credential = {
      id: result.rows[0].id,
      student_id: result.rows[0].student_id,
      student_code: result.rows[0].student_code,
      student_name: result.rows[0].student_name,
      username: result.rows[0].username,
      email: result.rows[0].email,
      password: result.rows[0].password_plain,
      created_at: result.rows[0].created_at,
      status: result.rows[0].status
    };
    
    res.status(201).json({
      success: true,
      message: 'Student credentials created successfully',
      credential
    });
    
  } catch (error) {
    console.error('Error creating credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// UPDATE STUDENT CREDENTIALS
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, password, status } = req.body;
    
    const existing = await pool.query(
      'SELECT * FROM student_credentials WHERE id = $1',
      [id]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Credentials not found' 
      });
    }
    
    let updateQuery = `
      UPDATE student_credentials 
      SET 
        username = COALESCE($1, username),
        email = COALESCE($2, email),
        status = COALESCE($3, status),
        updated_at = NOW()
    `;
    
    const params = [username || null, email || null, status || null];
    let paramCount = 4;
    
    if (password) {
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);
      updateQuery += `, password_hash = $${paramCount}, password_plain = $${paramCount + 1}`;
      params.push(password_hash, password);
      paramCount += 2;
    }
    
    updateQuery += ` WHERE id = $${paramCount} RETURNING *`;
    params.push(id);
    
    const result = await pool.query(updateQuery, params);
    
    const credential = {
      id: result.rows[0].id,
      student_id: result.rows[0].student_id,
      student_code: result.rows[0].student_code,
      student_name: result.rows[0].student_name,
      username: result.rows[0].username,
      email: result.rows[0].email,
      password: result.rows[0].password_plain,
      status: result.rows[0].status,
      updated_at: result.rows[0].updated_at
    };
    
    res.json({
      success: true,
      message: 'Credentials updated successfully',
      credential
    });
    
  } catch (error) {
    console.error('Error updating credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// DELETE STUDENT CREDENTIALS
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM student_credentials WHERE id = $1 RETURNING student_id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Credentials not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Credentials deleted successfully',
      student_id: result.rows[0].student_id
    });
    
  } catch (error) {
    console.error('Error deleting credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET CREDENTIALS SUMMARY
// ==========================================
router.get('/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_credentials,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_credentials,
        COUNT(CASE WHEN status = 'Inactive' THEN 1 END) as inactive_credentials,
        COUNT(CASE WHEN last_login IS NOT NULL THEN 1 END) as has_logged_in
      FROM student_credentials
    `);
    
    res.json({
      success: true,
      summary: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error fetching credentials summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;