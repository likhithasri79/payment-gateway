import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import { connectRedis } from './config/redis';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

import { createPayment } from './controllers/payment_controller';
import { handleBankWebhook } from './controllers/webhook_controller';
import { idempotencyMiddleware } from './middleware/idempotency';

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register Payment Route with Idempotency Middleware
app.post('/payments', idempotencyMiddleware, createPayment);

// Register Webhook Route (No idempotency middleware needed, handles its own idempotency via DB state)
app.post('/webhooks/bank', handleBankWebhook);

async function startServer() {
  try {
    // Initialize connections
    await connectDB();
    await connectRedis();

    app.listen(PORT, () => {
      console.log(`🚀 Payment Gateway Simulator running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
