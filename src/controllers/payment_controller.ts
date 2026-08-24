import { Request, Response } from 'express';
import { query } from '../config/db';
import { processPaymentWithBank } from '../services/bank_client';

export const createPayment = async (req: Request, res: Response) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  const { merchantId, amount, currency } = req.body;

  if (!merchantId || !amount || !currency) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Create Transaction (State: INITIATED)
    // Note: We don't need a transaction lock here because idempotency_key has a UNIQUE constraint.
    // If a duplicate slips past Redis, Postgres will throw a unique violation error.
    const result = await query(
      `INSERT INTO transactions (merchant_id, idempotency_key, amount, currency, status) 
       VALUES ($1, $2, $3, $4, 'INITIATED') 
       RETURNING id, status`,
      [merchantId, idempotencyKey, amount, currency]
    );
    
    const transactionId = result.rows[0].id;
    
    // 2. Transition to PENDING immediately before calling the bank
    await query(
      `UPDATE transactions SET status = 'PENDING', updated_at = NOW() WHERE id = $1`,
      [transactionId]
    );

    // 3. Fire request to Mock Bank (Async, we don't await the final result here for the client if it takes too long,
    // but for simplicity in this demo, we await. In real systems, this might be offloaded to a queue).
    try {
      const bankResult = await processPaymentWithBank(transactionId, amount, currency);
      
      // If the bank is synchronous and returns success immediately:
      if (bankResult && bankResult.status === 'SUCCESS') {
        await query(
          `UPDATE transactions SET status = 'SUCCESS', bank_reference = $1, updated_at = NOW() WHERE id = $2`,
          [bankResult.bankReference, transactionId]
        );
        return res.status(200).json({ transactionId, status: 'SUCCESS' });
      }

    } catch (bankError) {
      // If all retries failed, transition to FAILED
      await query(
        `UPDATE transactions SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
        [transactionId]
      );
      return res.status(502).json({ error: 'Payment failed due to bank downtime', transactionId, status: 'FAILED' });
    }
    
    // If bank is purely async, we just return PENDING and wait for a webhook
    return res.status(202).json({ transactionId, status: 'PENDING', message: 'Payment processing' });

  } catch (error: any) {
    // Handle Postgres Unique Constraint Violation (Duplicate Idempotency Key not in Redis)
    if (error.code === '23505') {
      try {
        console.log(`[Idempotency Fallback] Fetching existing transaction for key: ${idempotencyKey}`);
        const existingTxn = await query(
          `SELECT id, status FROM transactions WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        
        if (existingTxn.rows.length > 0) {
          const txn = existingTxn.rows[0];
          const statusCode = txn.status === 'SUCCESS' ? 200 : (txn.status === 'PENDING' ? 202 : 502);
          return res.status(statusCode).json({ 
            error: txn.status === 'FAILED' ? 'Payment failed due to bank downtime' : undefined,
            transactionId: txn.id, 
            status: txn.status,
            _note: 'Recovered from Database Fallback'
          });
        }
      } catch (fallbackError) {
        console.error('Fallback query failed:', fallbackError);
      }
    }
    
    console.error('Create Payment Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
