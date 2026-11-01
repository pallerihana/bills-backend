require('dotenv').config();

const express = require('express');
const cors = require('cors');
const connect = require('./config/db');

const app = express();

// CORS Configuration
const allowedOrigins = [
  'http://localhost:5173',
  process.env.CLIENT_URL
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without an origin
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Middleware
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Expense Management API is running'
  });
});

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/forms/shared', require('./routes/sharedRoutes'));
app.use('/api/forms', require('./routes/employeeRoutes'));
app.use('/api/employees', require('./routes/directoryRoutes'));

// Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error'
  });
});

// Start Server
const PORT = process.env.PORT || 5000;

connect()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`API running on port ${PORT}`);
    });

    require('./services/cleanupService').start();
  })
  .catch((err) => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });