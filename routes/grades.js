const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==========================================
// GET ALL GRADES
// ==========================================
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*, s.first_name, s.last_name, s.student_code 
       FROM grades g
       JOIN students s ON g.student_id = s.id
       ORDER BY g.created_at DESC`
    );
    res.json({ success: true, grades: result.rows });
  } catch (error) {
    console.error('Error fetching grades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET GRADES BY STUDENT
// ==========================================
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT * FROM grades 
       WHERE student_id = (SELECT id FROM students WHERE student_id = $1)
       ORDER BY academic_year DESC, term DESC NULLS LAST`,
      [studentId]
    );
    res.json({ success: true, grades: result.rows });
  } catch (error) {
    console.error('Error fetching student grades:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// CREATE GRADE
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { student_id, subject, score, grade, term, academic_year, notes, assessment_type } = req.body;

    // term column is INTEGER — extract numeric value if a string like "Term 1" is sent
    const termValue = term !== undefined && term !== null
      ? parseInt(String(term).replace(/\D/g, ''), 10) || 1
      : 1;
    
    const student = await pool.query(
      'SELECT id FROM students WHERE student_id = $1',
      [student_id]
    );
    
    if (student.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const safeAssessmentType = String(assessment_type || 'End of Term Exam');
    const assessmentInNotes = safeAssessmentType
      ? `[${safeAssessmentType}] ${String(notes || '').trim()}`.trim()
      : notes;

    const hasAssessmentColumnResult = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'grades'
           AND column_name = 'assessment_type'
      ) AS has_column`
    );
    const hasAssessmentColumn = hasAssessmentColumnResult.rows[0]?.has_column;

    let result;

    if (hasAssessmentColumn) {
      result = await pool.query(
        `INSERT INTO grades (student_id, subject, score, grade, term, assessment_type, academic_year, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [student.rows[0].id, subject, score, grade, termValue, safeAssessmentType, academic_year, notes]
      );
    } else {
      result = await pool.query(
        `INSERT INTO grades (student_id, subject, score, grade, term, academic_year, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [student.rows[0].id, subject, score, grade, termValue, academic_year, assessmentInNotes]
      );
    }
    
    res.status(201).json({ success: true, grade: result.rows[0] });
  } catch (error) {
    console.error('Error creating grade:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;