import axios from 'axios';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

/**
 * Simulates calling a bank to process a payment.
 * Implements Exponential Backoff for retries.
 */
export const processPaymentWithBank = async (
  transactionId: string, 
  amount: number, 
  currency: string
) => {
  let attempt = 0;
  
  while (attempt < MAX_RETRIES) {
    try {
      console.log(`[Bank Client] Attempt ${attempt + 1} for Txn: ${transactionId}`);
      
      const response = await axios.post(process.env.MOCK_BANK_URL!, {
        transactionId,
        amount,
        currency
      }, { timeout: 3000 }); // strict timeout for bank calls

      return response.data; // e.g., { status: 'SUCCESS', bankReference: 'BANK123' }
      
    } catch (error: any) {
      attempt++;
      
      console.error(`[Bank Client] Attempt ${attempt} failed: ${error.message}`);
      
      // If we've exhausted retries, throw so the caller handles the failure
      if (attempt >= MAX_RETRIES) {
        throw new Error('Bank API unavailable after maximum retries');
      }

      // Exponential backoff: 1s, 2s, 4s...
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`[Bank Client] Waiting ${backoffMs}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
};
