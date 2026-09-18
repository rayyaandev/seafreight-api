import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validateBody } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { LoginRequestSchema, RefreshTokenRequestSchema } from '../common/schemas.js';

export const authRouter = Router();

authRouter.post('/login', validateBody(LoginRequestSchema), AuthController.login);
authRouter.post('/refresh', validateBody(RefreshTokenRequestSchema), AuthController.refresh);
authRouter.post('/logout', AuthController.logout);
authRouter.get('/me', authMiddleware, AuthController.me);

