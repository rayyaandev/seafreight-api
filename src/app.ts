import express, { type Express } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { freightRouter } from './modules/freight/freight.router.js';
import { sendSuccess, sendError } from './utils/response.js';
import db from './db/connection.js';

export function createApp(): Express {
    const app: Express = express();

    app.use(cors());
    app.use(express.json());
    if (process.env.NODE_ENV !== 'test') {
        app.use(morgan('dev'));
    }

    // Health check endpoint
    app.get('/health', async (_req, res) => {
        try {
            await db.raw('SELECT 1');
            sendSuccess(res, {
                status: 'healthy',
                service: 'apip-seafreight-api',
                database: 'connected',
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            sendError(res, 'DATABASE_UNAVAILABLE', 'Database connection failed', 503, undefined, err);
        }
    });

    // Scoped Auth & API routes
    app.use('/v1/freight', authMiddleware, freightRouter);

    // 404 Handler
    app.use((req, res) => {
        sendError(res, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404);
    });

    // Global Error Handler
    app.use(errorHandler);

    return app;
}

export default createApp;
