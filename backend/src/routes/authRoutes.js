import { Router } from 'express';
import { register, login } from '../services/authService.js';

const authRoutes = Router();

authRoutes.post('/register', async (req, res) => {
  try {
    const result = await register(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'internal server error' });
  }
});

authRoutes.post('/login', async (req, res) => {
  try {
    const result = await login(req.body);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'internal server error' });
  }
});

export { authRoutes };
