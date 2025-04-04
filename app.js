import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import { createRedisClient } from './config/redis.js';

// Initialize express app
const app = express();
const port = process.env.PORT || 4000;

// Global Redis client
let redisClient;

// Connect to databases and start server
const startServer = async () => {
  try {
    // Connect to Redis
    redisClient = await createRedisClient();

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/students-db');
    console.log('MongoDB connected');

    // Start express server
    app.listen(port, () => {
      console.log(`Student CRUD API running on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to initialize connections:', err);
    process.exit(1);
  }
};

// Student Schema
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  grade: { type: String, required: true, trim: true },
  age: { type: Number, required: true, min: 5 },
  subjects: [{ type: String, trim: true }],
  createdAt: { type: Date, default: Date.now },
});

// Student Model
const Student = mongoose.model('Student', studentSchema);

// Middleware
app.use(express.json());

// Cache middleware
const cacheData = (expireTime = 3600) => async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const cacheKey = `students:${req.originalUrl}`;

  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log(`Cache hit for ${cacheKey}`);
      return res.json(JSON.parse(cachedData));
    }

    console.log(`Cache miss for ${cacheKey}`);

    const originalJson = res.json;
    res.json = (data) => {
      redisClient.set(cacheKey, JSON.stringify(data), { EX: expireTime }).catch(err => console.error('Redis cache error:', err));
      return originalJson.call(res, data);
    };

    next();
  } catch (err) {
    console.error('Cache middleware error:', err);
    next();
  }
};

// Clear cache helper
const clearCache = async (pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length) {
      console.log(`Clearing cache keys matching: ${pattern}`);
      await Promise.all(keys.map(key => redisClient.del(key)));
    }
  } catch (err) {
    console.error('Error clearing cache:', err);
  }
};

// Routes with caching
app.post('/api/students', async (req, res) => {
  try {
    const student = new Student(req.body);
    await student.save();
    await clearCache('students:/api/students*');
    res.status(201).json(student);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/students', cacheData(60), async (req, res) => {
  try {
    const students = await Student.find({});
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/:id', cacheData(60), async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!student) return res.status(404).json({ message: 'Student not found' });

    await Promise.all([
      clearCache(`students:/api/students/${req.params.id}`),
      clearCache('students:/api/students*'),
    ]);

    res.json(student);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    await Promise.all([
      clearCache(`students:/api/students/${req.params.id}`),
      clearCache('students:/api/students*'),
    ]);

    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/search/:query', cacheData(30), async (req, res) => {
  try {
    const query = req.params.query;
    const students = await Student.find({
      $or: [{ name: { $regex: query, $options: 'i' } }, { email: { $regex: query, $options: 'i' } }],
    });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/grade/:grade', cacheData(60), async (req, res) => {
  try {
    const students = await Student.find({ grade: req.params.grade });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
startServer();

export default app;
