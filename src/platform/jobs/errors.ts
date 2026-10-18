/**
 * Thrown by a job handler when retrying cannot help (configuration missing, recipient outside the
 * messaging window) or could cause harm (an unconfirmed send that a retry might duplicate). The
 * runner moves the job straight to DEAD_LETTER instead of scheduling another attempt.
 */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}
