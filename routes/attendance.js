const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==========================================
// GET ALL ATTENDANCE
// ==========================================
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, s.first_name, s.last_name, s.student_code 
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       ORDER BY a.date DESC`
    );
    res.json({ success: true, attendance: result.rows });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET ATTENDANCE BY STUDENT
// ==========================================
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT * FROM attendance 
       WHERE student_id = (SELECT id FROM students WHERE student_id = $1)
       ORDER BY date DESC`,
      [studentId]
    );
    res.json({ success: true, attendance: result.rows });
  } catch (error) {
    console.error('Error fetching student attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// RECORD ATTENDANCE
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { student_id, date, status, check_in_time, check_out_time, notes } = req.body;
    
    const student = await pool.query(
      'SELECT id FROM students WHERE student_id = $1',
      [student_id]
    );
    
    if (student.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    const result = await pool.query(
      `INSERT INTO attendance (student_id, date, status, check_in_time, check_out_time, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (student_id, date) 
       DO UPDATE SET status = $3, check_in_time = $4, check_out_time = $5, notes = $6, updated_at = NOW()
       RETURNING *`,
      [student.rows[0].id, date || new Date().toISOString().split('T')[0], status, check_in_time, check_out_time, notes]
    );
    
    res.status(201).json({ success: true, attendance: result.rows[0] });
  } catch (error) {
    console.error('Error recording attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET TODAY'S ATTENDANCE
// ==========================================
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT a.*, s.first_name, s.last_name, s.student_code 
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       WHERE a.date = $1
       ORDER BY s.first_name`,
      [today]
    );
    res.json({ success: true, attendance: result.rows });
  } catch (error) {
    console.error('Error fetching today\'s attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;