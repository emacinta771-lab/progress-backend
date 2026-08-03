const jwt = require('jsonwebtoken');

// ==========================================
// VERIFY JWT TOKEN
// ==========================================
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Access denied. No token provided.' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false, 
      error: 'Invalid or expired token.' 
    });
  }
};

// ==========================================
// CHECK USER ROLE
// ==========================================
const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized' 
      });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        error: 'You do not have permission to access this resource' 
      });
    }
    
    next();
  };
};

module.exports = { verifyToken, checkRole };