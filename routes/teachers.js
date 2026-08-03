const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==========================================
// GET ALL TEACHERS
// ==========================================
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM teachers ORDER BY created_at DESC'
    );
    res.json({ success: true, teachers: result.rows });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET TEACHER BY ID
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM teachers WHERE id = $1 OR teacher_id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }
    
    res.json({ success: true, teacher: result.rows[0] });
  } catch (error) {
    console.error('Error fetching teacher:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// CREATE TEACHER
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { teacher_id, first_name, last_name, email, phone, specialization, qualification, salary } = req.body;
    
    const result = await pool.query(
      `INSERT INTO teachers (teacher_id, first_name, last_name, email, phone, specialization, qualification, salary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [teacher_id, first_name, last_name, email, phone, specialization, qualification, salary || 0]
    );
    
    res.status(201).json({ success: true, teacher: result.rows[0] });
  } catch (error) {
    console.error('Error creating teacher:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// UPDATE TEACHER
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, specialization, qualification, salary, is_active } = req.body;
    
    const result = await pool.query(
      `UPDATE teachers 
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           email = COALESCE($3, email),
           phone = COALESCE($4, phone),
           specialization = COALESCE($5, specialization),
           qualification = COALESCE($6, qualification),
           salary = COALESCE($7, salary),
           is_active = COALESCE($8, is_active),
           updated_at = NOW()
       WHERE teacher_id = $9 OR id = $9
       RETURNING *`,
      [first_name, last_name, email, phone, specialization, qualification, salary, is_active, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }
    
    res.json({ success: true, teacher: result.rows[0] });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// DELETE TEACHER
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM teachers WHERE teacher_id = $1 OR id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }
    
    res.json({ success: true, message: 'Teacher deleted successfully' });
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;