const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==========================================
// GENERATE STUDENT REPORT
// ==========================================
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await pool.query('SELECT * FROM students WHERE student_id = $1', [studentId]);
    if (student.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    const payments = await pool.query(
      'SELECT * FROM payments WHERE student_id = (SELECT id FROM students WHERE student_id = $1)',
      [studentId]
    );
    
    const grades = await pool.query(
      'SELECT * FROM grades WHERE student_id = (SELECT id FROM students WHERE student_id = $1)',
      [studentId]
    );
    
    const attendance = await pool.query(
      'SELECT * FROM attendance WHERE student_id = (SELECT id FROM students WHERE student_id = $1)',
      [studentId]
    );
    
    res.json({
      success: true,
      report: {
        student: student.rows[0],
        payments: payments.rows,
        grades: grades.rows,
        attendance: attendance.rows
      }
    });
  } catch (error) {
    console.error('Error generating student report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;