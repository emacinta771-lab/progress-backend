const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { buildStudentAccountIdentity } = require('../utils/accountIdentity');
const { verifyPassword } = require('../utils/password');

// ==========================================
// TEST ROUTE
// ==========================================
router.get('/test', (req, res) => {
  res.json({ message: 'Auth route working!' });
});

// ==========================================
// 🔐 LOGIN - WITH STUDENT CREDENTIALS SUPPORT
// ==========================================
router.post('/login', async (req, res) => {
  console.log('🔐 Login attempt received:', req.body);
  
  const { username, password } = req.body;
  
  if (!username || !password) {
    console.log('❌ Missing username or password');
    return res.status(400).json({
      success: false,
      error: 'Please provide username and password'
    });
  }
  
  try {
    // First, try to find user in users table
    let user = null;
    let isFromCredentials = false;
    
    // Check if login is using student credentials
    const credentialResult = await pool.query(
      `SELECT sc.*, s.user_id as student_user_id 
       FROM student_credentials sc
       LEFT JOIN students s ON sc.student_id = s.student_id
       WHERE sc.username = $1 OR sc.email = $1 OR sc.student_id = $1`,
      [username]
    );
    
    if (credentialResult.rows.length > 0) {
      const cred = credentialResult.rows[0];
      
      // Check if there's a user account linked to this student
      if (cred.student_user_id) {
        // Get the user account
        const userResult = await pool.query(
          'SELECT * FROM users WHERE id = $1',
          [cred.student_user_id]
        );
        
        if (userResult.rows.length > 0) {
          user = userResult.rows[0];
          isFromCredentials = true;
          
          // Update last login in credentials
          await pool.query(
            'UPDATE student_credentials SET last_login = NOW() WHERE id = $1',
            [cred.id]
          );
        }
      }
    }
    
    // If not found via credentials, try regular user login
    if (!user) {
      const result = await pool.query(
        `SELECT u.* FROM users u
         LEFT JOIN students s ON s.user_id = u.id
         WHERE u.username = $1 
            OR u.email = $1 
            OR s.student_code = $1
            OR s.student_id = $1`,
        [username]
      );
      user = result.rows[0];
    }
    
    if (user) {
      console.log('👤 Database user found:', user.username);
      console.log('👤 User role:', user.role);
      console.log('👤 Is student:', user.is_student);
      
      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          error: 'Account is deactivated. Please contact administrator.'
        });
      }
      
      const passwordCheck = await verifyPassword(password, user);
      if (!passwordCheck.valid) {
        console.log('❌ Invalid password for user:', user.username);
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      if (passwordCheck.needsRehash && user.password_hash) {
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(password, salt);
        await pool.query(
          'UPDATE users SET password_hash = $1, password_plain = $2, updated_at = NOW() WHERE id = $3',
          [newHash, password, user.id]
        );
      }
      
      await pool.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );
      
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          is_student: user.is_student || false,
          student_id: user.student_id || null,
          is_parent: user.is_parent || false
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );
      
      let redirect = '/dashboard';
      if (user.role === 'admin') redirect = '/admin-dashboard';
      else if (user.role === 'accountant') redirect = '/accountant-dashboard';
      else if (user.role === 'teacher') redirect = '/teacher-dashboard';
      else if (user.is_student) redirect = '/student-dashboard';
      else if (user.role === 'parent' || user.is_parent) redirect = '/student-dashboard';
      
      console.log('✅ Login successful for:', user.username);
      console.log('➡️ Redirecting to:', redirect);
      
      return res.json({
        success: true,
        message: 'Login successful',
        token: token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          is_student: user.is_student || false,
          student_id: user.student_id || null,
          is_parent: user.is_parent || false
        },
        redirect: redirect
      });
    }
    
    console.log('❌ Login failed for:', username);
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error during login: ' + error.message
    });
  }
});

// ==========================================
// 👤 GET CURRENT USER PROFILE
// ==========================================
router.get('/me', async (req, res) => {
  console.log('👤 Profile request received');
  
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const result = await pool.query(
        `SELECT id, username, email, first_name, last_name, role, 
                is_active, is_student, student_id, is_parent, parent_id,
                phone, created_at, last_login 
         FROM users WHERE id = $1`,
        [decoded.id]
      );
      
      if (result.rows[0]) {
        return res.json({
          success: true,
          user: result.rows[0]
        });
      }
    } catch (jwtError) {
      console.log('⚠️ Invalid token');
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
    
  } catch (error) {
    console.error('❌ Profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==========================================
// 📋 GET ALL USERS (Admin only)
// ==========================================
router.get('/users', async (req, res) => {
  console.log('📋 Users list request received');
  
  try {
    const result = await pool.query(
      `SELECT id, username, email, first_name, last_name, role, 
              is_active, is_student, student_id, is_parent, password_plain,
              created_at, last_login 
       FROM users 
       ORDER BY created_at DESC`
    );
    
    return res.json({
      success: true,
      users: result.rows
    });
    
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==========================================
// 📝 REGISTER NEW USER (Admin only)
// ==========================================
router.post('/register', async (req, res) => {
  console.log('📝 Registration request received:', req.body);
  
  const { username, email, password, first_name, last_name, role } = req.body;

  if (!username || !email || !password || !first_name || !last_name) {
    return res.status(400).json({
      success: false,
      error: 'Please provide all required fields: username, email, password, first_name, last_name'
    });
  }

  try {
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Username or email already exists'
      });
    }
    
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, password_plain, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, email, first_name, last_name, role, is_active, created_at`,
      [username, email, password_hash, password, first_name, last_name, role || 'teacher']
    );
    
    console.log('✅ User created successfully:', result.rows[0]);
    
    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error during registration: ' + error.message
    });
  }
});

// ==========================================
// 👨‍🎓 CREATE STUDENT ACCOUNT WITH CREDENTIALS
// ==========================================
router.post('/create-student-account', async (req, res) => {
  console.log('📝 Creating student account:', req.body);
  
  try {
    let { 
      username, email, password, first_name, last_name, 
      student_id, phone, role = 'student' 
    } = req.body;
    
    if (!email || !password || !student_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, password, and student ID are required' 
      });
    }
    
    console.log('🔍 Looking for student with ID/Code:', student_id);
    
    const student = await pool.query(
      `SELECT * FROM students 
       WHERE student_id = $1 OR student_code = $1`,
      [student_id]
    );
    
    console.log('📊 Student found:', student.rows[0] || 'None');
    
    let studentData;
    
    if (student.rows.length === 0) {
      console.log('⚠️ Student not found. Creating new student record...');
      
      if (!first_name || !last_name) {
        return res.status(400).json({ 
          success: false, 
          error: 'Student not found and missing required fields (first_name, last_name) to create one.' 
        });
      }
      
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
          student_id, // student_id
          student_id, // student_code (use same as student_id if not provided)
          first_name,
          last_name,
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
      
      console.log('✅ New student created:', newStudent.rows[0]);
      studentData = newStudent.rows[0];
    } else {
      studentData = student.rows[0];
    }
    
    // Check if student is active
    if (studentData.enrollment_status !== 'Active') {
      return res.status(400).json({ 
        success: false, 
        error: `Student is ${studentData.enrollment_status}. Only active students can have accounts.` 
      });
    }
    
    // Check if student already has a user account
    if (studentData.user_id) {
      return res.status(409).json({ 
        success: false, 
        error: 'This student already has an account' 
      });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user account
    const existingUsernames = [
      ...(await pool.query('SELECT username FROM users WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean),
      ...(await pool.query('SELECT username FROM student_credentials WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean)
    ];
    const existingEmails = [
      ...(await pool.query('SELECT email FROM users WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean),
      ...(await pool.query('SELECT email FROM student_credentials WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean)
    ];
    const identity = buildStudentAccountIdentity({
      studentId: studentData.student_id,
      firstName: first_name || studentData.first_name,
      lastName: last_name || studentData.last_name,
      username,
      email,
      existingUsernames,
      existingEmails
    });
    const finalUsername = identity.username;
    const finalEmail = identity.email;
    const userRole = role === 'student' ? 'student' : 'teacher';
    
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, 
                          role, is_student, student_id, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, username, email, role, is_student, student_id`,
      [finalUsername, finalEmail, hashedPassword, first_name || studentData.first_name, 
       last_name || studentData.last_name, userRole, true, studentData.student_id, phone || null, true]
    );
    
    // Update student table with user_id
    await pool.query(
      'UPDATE students SET user_id = $1 WHERE student_id = $2',
      [result.rows[0].id, studentData.student_id]
    );
    
    // Save credentials to student_credentials table
    const credentialExists = await pool.query(
      'SELECT id FROM student_credentials WHERE student_id = $1',
      [studentData.student_id]
    );
    
    if (credentialExists.rows.length === 0) {
      await pool.query(
        `INSERT INTO student_credentials (
          student_id,
          student_code,
          student_name,
          username,
          email,
          password_hash,
          password_plain,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          studentData.student_id,
          studentData.student_code,
          `${studentData.first_name} ${studentData.last_name}`,
          finalUsername,
          finalEmail,
          hashedPassword,
          password,
          result.rows[0].id
        ]
      );
    }
    
    console.log('✅ Student account created successfully:', result.rows[0]);
    
    res.status(201).json({
      success: true,
      message: student.rows.length === 0 ? 
        'Student account created successfully with new student record.' :
        'Student account created successfully.',
      user: {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
        role: result.rows[0].role,
        is_student: true,
        student_id: result.rows[0].student_id
      },
      credentials: {
        username: finalUsername,
        registration_number: studentData.student_code || student_id,
        student_id: studentData.student_id,
        email: finalEmail,
        password: password
      }
    });
  } catch (error) {
    console.error('❌ Error creating student account:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ==========================================
// 👨‍🏫 CREATE TEACHER ACCOUNT WITH LOGIN CREDENTIALS
// ==========================================
router.post('/create-teacher-account', async (req, res) => {
  console.log('📝 Creating teacher account:', req.body);

  try {
    let { teacher_id, email, username, password } = req.body;

    if (!password || (!teacher_id && !email)) {
      return res.status(400).json({
        success: false,
        error: 'Password and either teacher ID or email are required'
      });
    }

    const teacherQuery = await pool.query(
      `SELECT * FROM teachers WHERE teacher_id = $1 OR email = $2`,
      [teacher_id || null, email || null]
    );

    if (teacherQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Teacher not found. Please create the teacher record first.'
      });
    }

    const teacher = teacherQuery.rows[0];

    if (teacher.user_id) {
      return res.status(409).json({
        success: false,
        error: 'This teacher already has a login account.'
      });
    }

    const existingUsernames = [
      ...(await pool.query('SELECT username FROM users WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean),
      ...(await pool.query('SELECT username FROM student_credentials WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean)
    ];
    const existingEmails = [
      ...(await pool.query('SELECT email FROM users WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean),
      ...(await pool.query('SELECT email FROM student_credentials WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean)
    ];

    const identity = buildStudentAccountIdentity({
      studentId: teacher.teacher_id,
      firstName: teacher.first_name,
      lastName: teacher.last_name,
      username,
      email: email || teacher.email,
      existingUsernames,
      existingEmails
    });

    const finalUsername = identity.username;
    const finalEmail = identity.email;

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const userResult = await pool.query(
      `INSERT INTO users (username, email, password_hash, password_plain, first_name, last_name, role, is_student, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, username, email, first_name, last_name, role, is_student`,
      [finalUsername, finalEmail, password_hash, password, teacher.first_name, teacher.last_name, 'teacher', false, teacher.phone || null, true]
    );

    await pool.query(
      'UPDATE teachers SET user_id = $1 WHERE teacher_id = $2',
      [userResult.rows[0].id, teacher.teacher_id]
    );

    console.log('✅ Teacher account created successfully:', userResult.rows[0]);

    return res.status(201).json({
      success: true,
      message: 'Teacher login account created successfully.',
      user: userResult.rows[0],
      credentials: {
        username: finalUsername,
        email: finalEmail,
        password
      }
    });
  } catch (error) {
    console.error('❌ Error creating teacher account:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🧑‍🎓 STUDENT SELF-REGISTRATION
// ==========================================
router.post('/register-student', async (req, res) => {
  console.log('📝 Student self-registration:', req.body);
  
  try {
    let { 
      username, email, password, student_code, phone 
    } = req.body;
    
    if (!email || !password || !student_code) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, password, and student code are required' 
      });
    }
    
    const student = await pool.query(
      'SELECT * FROM students WHERE student_code = $1 AND enrollment_status = $2',
      [student_code, 'Active']
    );
    
    if (student.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Invalid student code. Please check with your teacher.' 
      });
    }
    
    if (student.rows[0].user_id) {
      return res.status(409).json({ 
        success: false, 
        error: 'This student already has an account. Please login.' 
      });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const studentData = student.rows[0];
    const existingUsernames = [
      ...(await pool.query('SELECT username FROM users WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean),
      ...(await pool.query('SELECT username FROM student_credentials WHERE username IS NOT NULL')).rows.map((row) => row.username).filter(Boolean)
    ];
    const existingEmails = [
      ...(await pool.query('SELECT email FROM users WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean),
      ...(await pool.query('SELECT email FROM student_credentials WHERE email IS NOT NULL')).rows.map((row) => row.email).filter(Boolean)
    ];
    const identity = buildStudentAccountIdentity({
      studentId: studentData.student_id,
      firstName: studentData.first_name,
      lastName: studentData.last_name,
      username,
      email,
      existingUsernames,
      existingEmails
    });
    const finalUsername = identity.username;
    const finalEmail = identity.email;
    
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, 
                          role, is_student, student_id, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, username, email, role, is_student, student_id`,
      [finalUsername, finalEmail, hashedPassword, studentData.first_name, studentData.last_name, 
       'student', true, studentData.student_id, phone || null, true]
    );
    
    await pool.query(
      'UPDATE students SET user_id = $1 WHERE student_id = $2',
      [result.rows[0].id, studentData.student_id]
    );
    
    // Save credentials
    const credentialExists = await pool.query(
      'SELECT id FROM student_credentials WHERE student_id = $1',
      [studentData.student_id]
    );
    
    if (credentialExists.rows.length === 0) {
      await pool.query(
        `INSERT INTO student_credentials (
          student_id,
          student_code,
          student_name,
          username,
          email,
          password_hash,
          password_plain,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          studentData.student_id,
          studentData.student_code,
          `${studentData.first_name} ${studentData.last_name}`,
          finalUsername,
          finalEmail,
          hashedPassword,
          password,
          result.rows[0].id
        ]
      );
    }
    
    console.log('✅ Student self-registration successful:', result.rows[0]);
    
    res.status(201).json({
      success: true,
      message: 'Account created successfully! You can now login using your registration number.',
      user: {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
        role: result.rows[0].role,
        is_student: true,
        student_id: result.rows[0].student_id
      },
      login_info: {
        registration_number: studentData.student_code,
        username: finalUsername,
        email: finalEmail
      }
    });
    
  } catch (error) {
    console.error('❌ Error in student registration:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ✅ VERIFY STUDENT CODE
// ==========================================
router.post('/verify-student', async (req, res) => {
  console.log('🔍 Verifying student code:', req.body);
  
  try {
    const { studentCode } = req.body;
    
    if (!studentCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student code is required' 
      });
    }
    
    const result = await pool.query(
      `SELECT student_id, student_code, first_name, last_name, 
              date_of_birth, phone, parent_email, parent_name, current_standard,
              enrollment_status, user_id
       FROM students 
       WHERE student_code = $1 OR student_id = $1`,
      [studentCode]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Invalid student code. Please check with your teacher.' 
      });
    }
    
    const studentData = result.rows[0];
    
    if (studentData.enrollment_status !== 'Active') {
      return res.status(400).json({ 
        success: false, 
        error: `Student is ${studentData.enrollment_status}. Only active students can register.` 
      });
    }
    
    if (studentData.user_id) {
      return res.status(409).json({
        success: false,
        error: 'This student already has an account. Please login.'
      });
    }
    
    res.json({ 
      success: true, 
      student: studentData,
      message: 'Student verified successfully!'
    });
    
  } catch (error) {
    console.error('❌ Error verifying student:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🔄 RESET STUDENT PASSWORD (Admin only)
// ==========================================
router.post('/reset-password/:studentId', async (req, res) => {
  console.log('🔑 Resetting password for student:', req.params.studentId);
  
  try {
    const { studentId } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 6 characters long' 
      });
    }
    
    const user = await pool.query(
      'SELECT id FROM users WHERE student_id = $1',
      [studentId]
    );
    
    if (user.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update user password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user.rows[0].id]
    );
    
    // Update credentials password
    await pool.query(
      'UPDATE student_credentials SET password_hash = $1, password_plain = $2, updated_at = NOW() WHERE student_id = $3',
      [hashedPassword, newPassword, studentId]
    );
    
    res.json({
      success: true,
      message: 'Password reset successfully'
    });
    
  } catch (error) {
    console.error('❌ Error resetting password:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🔄 TOGGLE USER STATUS (Admin only)
// ==========================================
router.put('/users/:id/toggle-status', async (req, res) => {
  console.log(`🔄 Toggle status for user ${req.params.id}`);
  
  try {
    const userId = parseInt(req.params.id);
    
    const current = await pool.query(
      'SELECT is_active FROM users WHERE id = $1',
      [userId]
    );
    
    if (!current.rows[0]) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const newStatus = !current.rows[0].is_active;
    const result = await pool.query(
      'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING is_active',
      [newStatus, userId]
    );
    
    // Update student credentials status
    const student = await pool.query(
      'SELECT student_id FROM students WHERE user_id = $1',
      [userId]
    );
    
    if (student.rows.length > 0) {
      await pool.query(
        'UPDATE student_credentials SET status = $1 WHERE student_id = $2',
        [newStatus ? 'Active' : 'Inactive', student.rows[0].student_id]
      );
    }
    
    return res.json({
      success: true,
      message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
      is_active: result.rows[0].is_active
    });
    
  } catch (error) {
    console.error('❌ Error toggling user status:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==========================================
// 🔒 DEACTIVATE USER (Admin only)
// ==========================================
router.put('/users/:id/deactivate', async (req, res) => {
  console.log(`🔒 Deactivating user ${req.params.id}`);
  
  try {
    const userId = parseInt(req.params.id);
    
    const result = await pool.query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING is_active',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Update student credentials status
    const student = await pool.query(
      'SELECT student_id FROM students WHERE user_id = $1',
      [userId]
    );
    
    if (student.rows.length > 0) {
      await pool.query(
        'UPDATE student_credentials SET status = $1 WHERE student_id = $2',
        ['Inactive', student.rows[0].student_id]
      );
    }
    
    res.json({
      success: true,
      message: 'User deactivated successfully',
      is_active: result.rows[0].is_active
    });
    
  } catch (error) {
    console.error('❌ Error deactivating user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🔓 ACTIVATE USER (Admin only)
// ==========================================
router.put('/users/:id/activate', async (req, res) => {
  console.log(`🔓 Activating user ${req.params.id}`);
  
  try {
    const userId = parseInt(req.params.id);
    
    const result = await pool.query(
      'UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING is_active',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Update student credentials status
    const student = await pool.query(
      'SELECT student_id FROM students WHERE user_id = $1',
      [userId]
    );
    
    if (student.rows.length > 0) {
      await pool.query(
        'UPDATE student_credentials SET status = $1 WHERE student_id = $2',
        ['Active', student.rows[0].student_id]
      );
    }
    
    res.json({
      success: true,
      message: 'User activated successfully',
      is_active: result.rows[0].is_active
    });
    
  } catch (error) {
    console.error('❌ Error activating user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🔄 CHANGE PASSWORD
// ==========================================
router.post('/change-password', async (req, res) => {
  console.log('🔑 Change password request received');
  
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'Please provide current and new password'
    });
  }

  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    const user = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [decoded.id]
    );
    
    if (!user.rows[0]) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const isValid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }
    
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(newPassword, salt);
    
    await pool.query(
      'UPDATE users SET password_hash = $1, password_plain = $2, updated_at = NOW() WHERE id = $3',
      [password_hash, newPassword, decoded.id]
    );
    
    // Update credentials if student
    const student = await pool.query(
      'SELECT student_id FROM students WHERE user_id = $1',
      [decoded.id]
    );
    
    if (student.rows.length > 0) {
      await pool.query(
        'UPDATE student_credentials SET password_hash = $1, password_plain = $2, updated_at = NOW() WHERE student_id = $3',
        [password_hash, newPassword, student.rows[0].student_id]
      );
    }
    
    return res.json({
      success: true,
      message: 'Password updated successfully'
    });
    
  } catch (error) {
    console.error('❌ Error changing password:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// ==========================================
// 👤 GET USER BY ID (Admin only)
// ==========================================
router.get('/users/:id', async (req, res) => {
  console.log(`👤 Fetching user ${req.params.id}`);
  
  try {
    const userId = parseInt(req.params.id);
    
    const result = await pool.query(
      `SELECT id, username, email, first_name, last_name, role, 
              is_active, is_student, student_id, is_parent, parent_id,
              phone, password_plain, created_at, last_login 
       FROM users WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ✏️ UPDATE USER (Admin only)
// ==========================================
router.put('/users/:id', async (req, res) => {
  console.log(`✏️ Updating user ${req.params.id}`);
  
  try {
    const userId = parseInt(req.params.id);
    const { first_name, last_name, email, phone, role } = req.body;
    
    const result = await pool.query(
      `UPDATE users 
       SET first_name = $1, last_name = $2, email = $3, 
           phone = $4, role = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, username, email, first_name, last_name, role, is_active`,
      [first_name, last_name, email, phone, role, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'User updated successfully',
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🗑️ DELETE USER (Admin only)
// ==========================================
router.delete('/users/:id', async (req, res) => {
  console.log(`🗑️ Deleting user ${req.params.id}`);
  
  try {
    const userId = parseInt(req.params.id);
    
    const check = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Delete associated credentials first
    const student = await pool.query(
      'SELECT student_id FROM students WHERE user_id = $1',
      [userId]
    );
    
    if (student.rows.length > 0) {
      await pool.query(
        'DELETE FROM student_credentials WHERE student_id = $1',
        [student.rows[0].student_id]
      );
    }
    
    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ✅ EXPORT
// ==========================================
module.exports = router;