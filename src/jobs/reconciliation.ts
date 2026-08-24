import { getClient } from '../config/db';

/**
 * Mock Bank Statement Data
 * In a real system, this would be a CSV parsed from an SFTP server.
 * Format: { transactionId: status }
 */
const mockBankStatement: Record<string, string> = {
  "abb6b5c8-31ca-4c60-890b-fa34954de401": "SUCCESS"
  // We'll intentionally inject a mismatch here during testing
};

async function runReconciliation() {
  console.log('🔄 Starting Nightly Reconciliation Job...');
  const client = await getClient();

  try {
    // 1. Fetch all transactions from the last 24 hours
    // (For this simulator, we just fetch all transactions)
    const result = await client.query(`SELECT id, status, amount FROM transactions`);
    const dbTransactions = result.rows;

    console.log(`📊 Found ${dbTransactions.length} transactions in our database.`);

    let mismatches = 0;

    // 2. Cross-check each database transaction against the Bank Statement
    for (const txn of dbTransactions) {
      const bankStatus = mockBankStatement[txn.id];

      // If the bank doesn't have a record of a transaction we think succeeded...
      if (txn.status === 'SUCCESS' && !bankStatus) {
        console.error(`🚨 CRITICAL MISMATCH: DB shows SUCCESS for ${txn.id}, but bank has no record!`);
        mismatches++;
      }

      // If the bank says it succeeded, but we marked it FAILED (partial failure/lost webhook)...
      else if (bankStatus === 'SUCCESS' && txn.status !== 'SUCCESS') {
        console.warn(`⚠️ MISMATCH: Bank shows SUCCESS for ${txn.id}, but DB shows ${txn.status}. Auto-correcting...`);

        await client.query(
          `UPDATE transactions SET status = 'SUCCESS', updated_at = NOW() WHERE id = $1`,
          [txn.id]
        );
        console.log(`✅ Auto-corrected ${txn.id} to SUCCESS.`);
        mismatches++;
      }
    }

    console.log('✅ Reconciliation Job Completed.');
    console.log(`Summary: ${mismatches} mismatches found and processed.`);

  } catch (error) {
    console.error('❌ Reconciliation Job Failed:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

// Run the job
runReconciliation();
