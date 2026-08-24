import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';

export const idempotencyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  try {
    const cachedResponse = await redisClient.get(`idempotency:${idempotencyKey}`);
    
    if (cachedResponse) {
      console.log(`[Idempotency] Cache hit for key: ${idempotencyKey}`);
      const response = JSON.parse(cachedResponse);
      return res.status(response.statusCode).json(response.body);
    }

    // Intercept res.json to cache the response before sending it
    const originalJson = res.json;
    res.json = function (body) {
      // Only cache 2xx and 4xx responses, not 5xx errors (we might want to retry 5xx)
      if (res.statusCode >= 200 && res.statusCode < 500) {
        const responseToCache = {
          statusCode: res.statusCode,
          body: body,
        };
        // Cache for 24 hours
        redisClient.setEx(`idempotency:${idempotencyKey}`, 86400, JSON.stringify(responseToCache))
          .catch(err => console.error('Redis cache error:', err));
      }
      return originalJson.call(this, body);
    };

    next();
  } catch (error) {
    console.error('Idempotency middleware error:', error);
    next(error); // Proceed without idempotency if Redis fails, or return 500 based on preference
  }
};
