import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app.js';
import { connectRabbitMQ, shutdownRabbitMQ } from './bus/rabbitmq.config.js';
import { startOutboxWorker, stopOutboxWorker } from './bus/outbox.worker.js';
import { startConsumers, stopConsumers } from './bus/consumer.service.js';

const PORT = process.env.PORT || 4000;
const app = createApp();

const server = app.listen(PORT, async () => {
    console.log(`🚀 APIP Sea Freight API running at http://localhost:${PORT}`);
    console.log(`📋 Health Check: http://localhost:${PORT}/health`);
    console.log(`📦 Freight Files: http://localhost:${PORT}/v1/freight/files`);

    // Start RabbitMQ connection, outbox worker, and consumers
    try {
        await connectRabbitMQ();
        startOutboxWorker();
        await startConsumers();
        console.log('🐰 RabbitMQ event bus started');
    } catch (err) {
        console.error('⚠️  RabbitMQ startup failed (API will continue without event bus):', err);
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: shutting down...');

    stopOutboxWorker();
    await stopConsumers();
    await shutdownRabbitMQ();

    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

