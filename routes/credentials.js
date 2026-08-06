const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { buildStudentAccountIdentity } = require('../utils/accountIdentity');

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
    
    // Look up the student record so we can link a login account
    const student = await pool.query(
      `SELECT * FROM students 
       WHERE student_id = $1 OR student_code = $1`,
      [student_id]
    );
    
    let studentData = student.rows[0];
    
    if (!studentData) {
      // Optionally create a minimal student record so the account is usable
      const nameParts = String(student_name || '').split(' ').filter(Boolean);
      const newStudent = await pool.query(
        `INSERT INTO students (
          student_id, student_code, first_name, last_name,
          date_of_birth, gender, district, parent_name, parent_phone,
          parent_relationship, current_standard, current_class,
          academic_year, enrollment_status, emergency_contact_name,
          emergency_contact_phone, total_fees
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17
        ) RETURNING *`,
        [
          student_id,
          student_code || student_id,
          nameParts[0] || student_name || 'Student',
          nameParts.slice(1).join(' ') || student_name || '',
          new Date().toISOString().split('T')[0],
          'Male',
          'Lilongwe',
          'Parent Name',
          '+265 888 123 456',
          'Father',
          1,
          'A',
          new Date().getFullYear() + '/' + (new Date().getFullYear() + 1),
          'Active',
          'Emergency Contact',
          '+265 999 123 456',
          0
        ]
      );
      studentData = newStudent.rows[0];
    }
    
    // If the student record already has a linked user account, reject
    if (studentData.user_id) {
      return res.status(409).json({ 
        success: false, 
        error: 'This student already has a login account. Use "Create Account" flow or edit the user.' 
      });
    }
    
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    
    // Build consistent unique username/email
    const allUsernames = [
      ...(await pool.query('SELECT username FROM users WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean),
      ...(await pool.query('SELECT username FROM student_credentials WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean)
    ];
    const allEmails = [
      ...(await pool.query('SELECT email FROM users WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean),
      ...(await pool.query('SELECT email FROM student_credentials WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean)
    ];
    const nameParts = String(studentData.first_name + ' ' + studentData.last_name).trim().split(' ').filter(Boolean);
    const identity = buildStudentAccountIdentity({
      studentId: studentData.student_id,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' '),
      username,
      email,
      existingUsernames: allUsernames,
      existingEmails: allEmails
    });
    const finalUsername = identity.username;
    const finalEmail = identity.email;
    
    // Create the user account so the student can actually log in
    const userResult = await pool.query(
      `INSERT INTO users (username, email, password_hash, password_plain, first_name, last_name,
                          role, is_student, student_id, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, username, email, role, is_student, student_id, is_active`,
      [finalUsername, finalEmail, password_hash, password, studentData.first_name, studentData.last_name,
       'student', true, studentData.student_id, studentData.phone || null, true]
    );
    
    // Link the user to the student
    await pool.query(
      'UPDATE students SET user_id = $1 WHERE student_id = $2',
      [userResult.rows[0].id, studentData.student_id]
    );
    
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
    `, [studentData.student_id, studentData.student_code, `${studentData.first_name} ${studentData.last_name}`, finalUsername, finalEmail, password_hash, password, created_by || userResult.rows[0].id]);
    
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
      message: 'Student credentials created successfully and login account linked',
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
    
    const studentId = result.rows[0].student_id;
    
    // Clean up the linked user account and unlink the student record
    const student = await pool.query(
      'SELECT user_id FROM students WHERE student_id = $1',
      [studentId]
    );
    
    if (student.rows.length > 0 && student.rows[0].user_id) {
      await pool.query(
        'UPDATE students SET user_id = NULL WHERE student_id = $1',
        [studentId]
      );
      await pool.query(
        'DELETE FROM users WHERE id = $1',
        [student.rows[0].user_id]
      );
    }
    
    res.json({
      success: true,
      message: 'Credentials deleted successfully',
      student_id: studentId
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