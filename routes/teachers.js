const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken, checkRole } = require('../middleware/auth');

const teacherLookupClause = 'teacher_id = $1 OR CAST(id AS TEXT) = $1 OR CAST(user_id AS TEXT) = $1';

const buildClassPayload = (teacher) => {
  const assignedStandard = teacher.assigned_standard ? Number(teacher.assigned_standard) : null;
  const assignedClass = teacher.assigned_class || '';

  return {
    teacher_id: teacher.teacher_id,
    assigned_standard: assignedStandard,
    assigned_class: assignedClass,
    assigned_academic_year: teacher.assigned_academic_year || null,
    class_name: assignedStandard && assignedClass ? `Standard ${assignedStandard} ${assignedClass}` : null,
  };
};

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
// GET TEACHER CLASS ASSIGNMENT
// ==========================================
router.get('/:id/classes', verifyToken, checkRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, teacher_id, user_id, assigned_standard, assigned_class, assigned_academic_year
       FROM teachers
       WHERE ${teacherLookupClause}`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    const teacher = result.rows[0];

    if (req.user.role === 'teacher' && teacher.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'You can only access your own class assignment' });
    }

    return res.json({
      success: true,
      class_assignment: buildClassPayload(teacher),
    });
  } catch (error) {
    console.error('Error fetching teacher class assignment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ASSIGN / UPDATE TEACHER CLASS
// ==========================================
router.put('/:id/classes', verifyToken, checkRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      assigned_standard,
      assigned_class,
      assigned_academic_year,
    } = req.body;

    if (!assigned_standard) {
      return res.status(400).json({ success: false, error: 'Assigned standard is required' });
    }

    const teacherResult = await pool.query(
      `SELECT id, teacher_id, user_id
       FROM teachers
       WHERE ${teacherLookupClause}`,
      [id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    const teacher = teacherResult.rows[0];

    if (req.user.role === 'teacher' && teacher.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'You can only update your own class assignment' });
    }

    const finalStandard = Number(assigned_standard);
    const finalClass = (assigned_class || 'A').trim().toUpperCase();
    const finalAcademicYear = assigned_academic_year || null;

    const result = await pool.query(
      `UPDATE teachers
       SET assigned_standard = $1,
           assigned_class = $2,
           assigned_academic_year = COALESCE($3, assigned_academic_year),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, teacher_id, assigned_standard, assigned_class, assigned_academic_year`,
      [finalStandard, finalClass, finalAcademicYear, teacher.id]
    );

    return res.json({
      success: true,
      class_assignment: buildClassPayload(result.rows[0]),
      message: `Class Standard ${finalStandard} ${finalClass} saved successfully`,
    });
  } catch (error) {
    console.error('Error updating teacher class assignment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET TEACHER STUDENTS BY ASSIGNED CLASS
// ==========================================
router.get('/:id/students', verifyToken, checkRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const teacherResult = await pool.query(
      `SELECT id, teacher_id, user_id, assigned_standard, assigned_class, assigned_academic_year
       FROM teachers
       WHERE ${teacherLookupClause}`,
      [id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Teacher not found' });
    }

    const teacher = teacherResult.rows[0];

    if (req.user.role === 'teacher' && teacher.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'You can only access your own class students' });
    }

    if (!teacher.assigned_standard || !teacher.assigned_class) {
      return res.json({
        success: true,
        class_assignment: buildClassPayload(teacher),
        students: [],
      });
    }

    const studentResult = await pool.query(
      `SELECT *
       FROM students
       WHERE current_standard = $1
         AND current_class = $2
         AND enrollment_status = 'Active'
       ORDER BY last_name ASC, first_name ASC`,
      [teacher.assigned_standard, teacher.assigned_class]
    );

    return res.json({
      success: true,
      class_assignment: buildClassPayload(teacher),
      students: studentResult.rows,
    });
  } catch (error) {
    console.error('Error fetching teacher students:', error);
    return res.status(500).json({ success: false, error: error.message });
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
    const {
      teacher_id,
      first_name,
      last_name,
      email,
      phone,
      specialization,
      qualification,
      salary,
      assigned_standard,
      assigned_class,
      assigned_academic_year,
    } = req.body;
    
    const result = await pool.query(
      `INSERT INTO teachers (
        teacher_id, first_name, last_name, email, phone, specialization, qualification, salary,
        assigned_standard, assigned_class, assigned_academic_year
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        teacher_id,
        first_name,
        last_name,
        email,
        phone,
        specialization,
        qualification,
        salary || 0,
        assigned_standard || null,
        assigned_class || null,
        assigned_academic_year || null,
      ]
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
    const {
      first_name,
      last_name,
      email,
      phone,
      specialization,
      qualification,
      salary,
      is_active,
      assigned_standard,
      assigned_class,
      assigned_academic_year,
    } = req.body;
    
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
           assigned_standard = COALESCE($9, assigned_standard),
           assigned_class = COALESCE($10, assigned_class),
           assigned_academic_year = COALESCE($11, assigned_academic_year),
           updated_at = NOW()
       WHERE teacher_id = $12 OR id = $12
       RETURNING *`,
      [
        first_name,
        last_name,
        email,
        phone,
        specialization,
        qualification,
        salary,
        is_active,
        assigned_standard,
        assigned_class,
        assigned_academic_year,
        id,
      ]
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