import { Request, Response } from 'express';
import { getClient } from '../config/db';

export const handleBankWebhook = async (req: Request, res: Response) => {
  const { transactionId, status } = req.body;

  if (!transactionId || !status) {
    return res.status(400).json({ error: 'Missing transactionId or status' });
  }

  // Get a dedicated client from the pool to run a database transaction
  const client = await getClient();

  try {
    await client.query('BEGIN'); // Start Transaction

    // 1. Lock the row using FOR UPDATE to prevent concurrency issues
    console.log(`[Webhook] Locking transaction ${transactionId} for update...`);
    const result = await client.query(
      `SELECT status FROM transactions WHERE id = $1 FOR UPDATE`,
      [transactionId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const currentStatus = result.rows[0].status;

    // 2. State Machine Validation
    if (currentStatus === 'SUCCESS' || currentStatus === 'FAILED' || currentStatus === 'REFUNDED') {
      console.log(`[Webhook] Transaction ${transactionId} is already in terminal state ${currentStatus}. Ignoring webhook.`);
      await client.query('ROLLBACK');
      return res.status(200).json({ message: 'Webhook ignored, already in terminal state' });
    }

    // 3. Update the state
    console.log(`[Webhook] Updating transaction ${transactionId} from ${currentStatus} to ${status}`);
    await client.query(
      `UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, transactionId]
    );

    await client.query('COMMIT'); // Commit Transaction & Release Lock
    
    return res.status(200).json({ message: 'Webhook processed successfully' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: 'Internal server error processing webhook' });
  } finally {
    client.release();
  }
};
