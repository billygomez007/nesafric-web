DROP TRIGGER "FinancialLedgerEntry_immutable" ON "FinancialLedgerEntry";

CREATE TRIGGER "FinancialLedgerEntry_immutable"
  BEFORE UPDATE ON "FinancialLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_ledger_mutation();
