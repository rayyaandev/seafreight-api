import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { authRouter } from './auth/auth.router.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { freightRouter } from './modules/freight/freight.router.js';
import { masterDataRouter } from './modules/masterData/index.js';
import { devRouter } from './modules/dev/dev.routes.js';
import { sendSuccess, sendError } from './utils/response.js';
import db from './db/connection.js';

export function createApp(): Express {
    const app: Express = express();

    app.use(cors());
    app.use(cookieParser());
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
                service: 'seafreight-api',
                database: 'connected',
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            sendError(res, 'DATABASE_UNAVAILABLE', 'Database connection failed', 503, undefined, err);
        }
    });

    // Public Auth Routes
    app.use('/v1/auth', authRouter);

    // Protected Sea Freight Routes
    app.use('/v1/freight', authMiddleware, freightRouter);

    // Protected Master Data Typeahead Routes
    app.use('/v1/masterdata', authMiddleware, masterDataRouter);

    // Development & Event Simulation Routes (Guarded by RBAC dev.simulate)
    app.use('/v1/dev', authMiddleware, devRouter);

    // 404 Handler
    app.use((req, res) => {
        sendError(res, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404);
    });

    // Global Error Handler
    app.use(errorHandler);

    return app;
}

export default createApp;
