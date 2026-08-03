const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// ==========================================
// GET NOTIFICATIONS FOR USER
// ==========================================
router.get('/', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const userId = decoded.id;
    
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
    
    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// MARK NOTIFICATION AS READ
// ==========================================
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query(
      'UPDATE notifications SET is_read = true, updated_at = NOW() WHERE id = $1',
      [id]
    );
    
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// MARK ALL NOTIFICATIONS AS READ
// ==========================================
router.put('/read-all', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    await pool.query(
      'UPDATE notifications SET is_read = true, updated_at = NOW() WHERE user_id = $1',
      [decoded.id]
    );
    
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// CREATE NOTIFICATION
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { user_id, title, message, type, link } = req.body;
    
    const result = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, title, message, type || 'info', link || null]
    );
    
    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;