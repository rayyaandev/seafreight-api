import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { sendSuccess } from '../utils/response.js';

export class AuthController {
    public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, password } = req.body;
            const result = await AuthService.login(email, password);

            // Set refresh token in httpOnly Secure cookie
            res.cookie('refresh_token', result.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { actorId, workspaceId } = req.context;
            const profile = await AuthService.getProfile(actorId, workspaceId);
            sendSuccess(res, profile);
        } catch (err) {
            next(err);
        }
    }

    public static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const token = req.cookies?.refresh_token || req.body?.refresh_token;
            const result = await AuthService.refresh(token);

            res.cookie('refresh_token', result.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    }

    public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const accessToken = req.headers.authorization?.startsWith('Bearer ')
                ? req.headers.authorization.slice(7)
                : undefined;
            const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;
            await AuthService.logout(accessToken, refreshToken);
            res.clearCookie('refresh_token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
            });
            sendSuccess(res, { logged_out: true, message: 'Logged out successfully' });
        } catch (err) {
            next(err);
        }
    }
}
