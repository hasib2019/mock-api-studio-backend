/**
 * Demo data.
 *
 * One realistic project - "Core Banking Sandbox" - whose endpoints double as
 * the product's teaching examples: every field carries a description and an
 * example, every endpoint shows off a different corner of the validation
 * engine (cross-field rules, custom expressions, query coercion, path params)
 * and every response is templated.
 *
 * Ported from the original Next.js studio's `src/lib/seed.ts`. This half is
 * pure data - every `ENDPOINT_BUILDERS` entry just calls `newEndpoint(...)`,
 * nothing here touches the database - so it is unchanged from the original
 * except for import paths. The three lines that actually called the store
 * (`getProjectBySlug`/`createProject`/`createEndpoint`) now live in
 * `./seed.service.ts`, which injects `ProjectsService`/`EndpointsService`
 * instead of importing bare functions.
 */

import {
  newCondition,
  newEndpoint,
  newField,
  newRule,
  newScenario,
} from "../common/defaults";
import type { EndpointDef, ValidationRule } from "../common/types";

/** Credentials the seeded endpoints expect - documented in the README. */
const API_KEY = "sandbox-demo-key";
const BEARER_TOKEN = "sandbox-demo-token";

/** Debit account that always answers "insufficient balance". */
const LOW_BALANCE_ACCOUNT = "1010000000001";
/** Account number that always answers 404. */
const UNKNOWN_ACCOUNT = "0000000000000";
/** Mobile number that always trips the OTP throttle. */
const THROTTLED_MOBILE = "01700000000";

const MOBILE_PATTERN = "^01[3-9]\\d{8}$";

/** `newRule` plus a hand-written message. */
function rule(
  id: ValidationRule["rule"],
  value: ValidationRule["value"],
  message?: string,
): ValidationRule {
  const created = newRule(id, value);
  return message ? { ...created, message } : created;
}

/* ------------------------------------------------------------------ *
 * 1. POST /fund-transfer
 * ------------------------------------------------------------------ */

function fundTransfer(projectId: string): EndpointDef {
  return newEndpoint(projectId, {
    name: "Fund Transfer",
    method: "POST",
    path: "/fund-transfer",
    description:
      "Debits the sender's account and credits a beneficiary account. Mirrors the NPSB " +
      "single-transfer contract: 13-digit account numbers, a 2-decimal amount and an " +
      "idempotency header.",
    tags: ["payments", "npsb"],
    notes:
      "Send amount > 100000 to see the limit response, or fromAccount " +
      `${LOW_BALANCE_ACCOUNT} to see the insufficient-balance response.`,
    auth: { type: "apiKey", headerName: "x-api-key", token: API_KEY },
    request: {
      contentType: "application/json",
      allowUnknownFields: false,
      validationMode: "collectAll",
      body: [
        newField({
          name: "fromAccount",
          label: "Debit account",
          type: "string",
          required: true,
          description: "13-digit account number the money is taken from.",
          example: "1010000000002",
          rules: [
            rule("exactLength", 13, "fromAccount must be exactly 13 digits"),
            rule("numericString", undefined, "fromAccount may contain digits only"),
          ],
        }),
        newField({
          name: "toAccount",
          label: "Credit account",
          type: "string",
          required: true,
          description: "13-digit beneficiary account number. Must differ from fromAccount.",
          example: "2020000000009",
          rules: [
            rule("exactLength", 13, "toAccount must be exactly 13 digits"),
            rule("numericString", undefined, "toAccount may contain digits only"),
            rule("notEqualsField", "fromAccount", "toAccount must be different from fromAccount"),
          ],
        }),
        newField({
          name: "amount",
          label: "Amount",
          type: "number",
          required: true,
          description: "Transfer amount in the given currency. Two decimal places at most.",
          example: 12500.5,
          rules: [
            rule("min", 10, "amount must be at least 10.00"),
            rule("max", 500000, "amount may not exceed 500000.00 per transaction"),
            rule("maxDecimals", 2, "amount may have at most 2 decimal places"),
          ],
        }),
        newField({
          name: "currency",
          label: "Currency",
          type: "string",
          required: true,
          description: "ISO 4217 currency code. The sandbox settles BDT and USD only.",
          example: "BDT",
          rules: [rule("enum", ["BDT", "USD"], "currency must be one of: {arg}")],
        }),
        newField({
          name: "purpose",
          label: "Purpose of transfer",
          type: "string",
          required: true,
          description: "Regulatory purpose code attached to the transaction.",
          example: "SALARY",
          rules: [
            rule("enum", ["SALARY", "BILL", "PERSONAL", "BUSINESS"], "purpose must be one of: {arg}"),
          ],
        }),
        newField({
          name: "remarks",
          label: "Remarks",
          type: "string",
          required: false,
          description: "Free-text note shown on the beneficiary's statement.",
          example: "August salary",
          rules: [rule("maxLength", 120, "remarks may not exceed 120 characters")],
        }),
        newField({
          name: "beneficiary",
          label: "Beneficiary",
          type: "object",
          required: true,
          description: "Who is being paid. The core matches this against the credit account.",
          children: [
            newField({
              name: "name",
              label: "Beneficiary name",
              type: "string",
              required: true,
              description: "Name as registered with the beneficiary bank.",
              example: "Rahim Uddin",
              rules: [rule("minLength", 3, "beneficiary.name must be at least 3 characters")],
            }),
            newField({
              name: "mobile",
              label: "Beneficiary mobile",
              type: "string",
              required: true,
              description: "Bangladeshi mobile number used for the credit SMS alert.",
              example: "01712345678",
              rules: [
                rule(
                  "pattern",
                  MOBILE_PATTERN,
                  "beneficiary.mobile must be a valid Bangladeshi mobile number",
                ),
              ],
            }),
            newField({
              name: "bankCode",
              label: "Beneficiary bank code",
              type: "string",
              required: true,
              description: "6-character clearing code of the beneficiary bank.",
              example: "BRAKBD",
              rules: [rule("exactLength", 6, "beneficiary.bankCode must be exactly 6 characters")],
            }),
          ],
        }),
      ],
      query: [],
      headers: [
        newField({
          name: "x-request-id",
          label: "Request id",
          type: "string",
          required: true,
          description: "Caller-generated UUID v4. Echoed back so you can correlate logs.",
          example: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
          rules: [rule("uuid", undefined, "x-request-id must be a valid UUID")],
        }),
      ],
    },
    scenarios: [
      newScenario({
        name: "Limit exceeded",
        description: "The single-transaction ceiling of the sandbox is 100,000.",
        conditions: [newCondition({ source: "body", path: "amount", operator: "gt", value: 100000 })],
        status: 200,
        body: {
          status: "FAILED",
          responseCode: "TXN_LIMIT_EXCEEDED",
          message: "Transaction amount exceeds the per-transaction limit",
          data: {
            requestedAmount: "{{body.amount}}",
            perTransactionLimit: 100000,
            currency: "{{body.currency}}",
          },
          requestId: "{{headers.x-request-id}}",
          timestamp: "{{now}}",
        },
      }),
      newScenario({
        name: "Insufficient balance",
        description: `Account ${LOW_BALANCE_ACCOUNT} is seeded with an empty balance.`,
        conditions: [
          newCondition({
            source: "body",
            path: "fromAccount",
            operator: "eq",
            value: LOW_BALANCE_ACCOUNT,
          }),
        ],
        status: 200,
        body: {
          status: "FAILED",
          responseCode: "INSUFFICIENT_BALANCE",
          message: "The debit account does not have sufficient balance",
          data: {
            fromAccount: "{{body.fromAccount}}",
            requestedAmount: "{{body.amount}}",
            availableBalance: 0,
          },
          requestId: "{{headers.x-request-id}}",
          timestamp: "{{now}}",
        },
      }),
      newScenario({
        name: "Success",
        description: "Default response: the transfer is accepted and settled instantly.",
        isDefault: true,
        status: 200,
        body: {
          status: "SUCCESS",
          responseCode: "TXN_SUCCESS",
          message: "Fund transfer completed successfully",
          data: {
            transactionId: "{{randomDigits(12)}}",
            referenceNo: "NPSB{{randomDigits(8)}}",
            fromAccount: "{{body.fromAccount}}",
            toAccount: "{{body.toAccount}}",
            beneficiaryName: "{{body.beneficiary.name}}",
            amount: "{{body.amount}}",
            currency: "{{body.currency}}",
            charge: 0,
            purpose: "{{body.purpose}}",
            remarks: '{{body.remarks || "N/A"}}',
            settlementStatus: "SETTLED",
            processedAt: "{{now}}",
          },
          requestId: "{{headers.x-request-id}}",
          timestamp: "{{now}}",
        },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * 2. GET /accounts/:accountNumber/balance
 * ------------------------------------------------------------------ */

function accountBalance(projectId: string): EndpointDef {
  return newEndpoint(projectId, {
    name: "Account Balance Enquiry",
    method: "GET",
    path: "/accounts/:accountNumber/balance",
    description:
      "Returns the available and ledger balance of a CASA account. The account number is a " +
      "path parameter and is echoed back in the response.",
    tags: ["accounts"],
    notes: `Call it with ${UNKNOWN_ACCOUNT} to see the not-found response.`,
    auth: { type: "none" },
    request: {
      contentType: "none",
      allowUnknownFields: true,
      validationMode: "collectAll",
      body: [],
      query: [
        newField({
          name: "currency",
          label: "Currency",
          type: "string",
          required: false,
          description: "Optional currency wallet to report. Defaults to BDT.",
          example: "BDT",
          rules: [rule("enum", ["BDT", "USD"], "currency must be one of: {arg}")],
        }),
      ],
      headers: [],
    },
    scenarios: [
      newScenario({
        name: "Account not found",
        description: "The core has no record of this account number.",
        conditions: [
          newCondition({
            source: "path",
            path: "accountNumber",
            operator: "eq",
            value: UNKNOWN_ACCOUNT,
          }),
        ],
        status: 404,
        body: {
          status: "FAILED",
          responseCode: "ACCOUNT_NOT_FOUND",
          message: "No account exists for the given account number",
          data: { accountNumber: "{{path.accountNumber}}" },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
      newScenario({
        name: "Active account",
        description: "Default response: a healthy savings account with a random balance.",
        isDefault: true,
        status: 200,
        body: {
          status: "SUCCESS",
          responseCode: "0000",
          message: "Balance enquiry successful",
          data: {
            accountNumber: "{{path.accountNumber}}",
            accountTitle: "Rahim Uddin",
            accountType: "SAVINGS",
            branch: "Gulshan Corporate Branch",
            currency: '{{query.currency || "BDT"}}',
            availableBalance: "{{randomDecimal(1000,900000,2)}}",
            ledgerBalance: "{{randomDecimal(1000,900000,2)}}",
            holdAmount: 0,
            accountStatus: "ACTIVE",
            asOf: "{{now}}",
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * 3. POST /customer/nid-verify
 * ------------------------------------------------------------------ */

function nidVerify(projectId: string): EndpointDef {
  return newEndpoint(projectId, {
    name: "NID Verification",
    method: "POST",
    path: "/customer/nid-verify",
    description:
      "Verifies a customer against the national ID database. Shows a custom rule (an NID is " +
      "10, 13 or 17 digits) and an age check driven by the date of birth.",
    tags: ["kyc", "customer"],
    notes: `Bearer token: ${BEARER_TOKEN}. NID 1234567890 always answers NID_MISMATCH.`,
    auth: { type: "bearer", token: BEARER_TOKEN },
    request: {
      contentType: "application/json",
      allowUnknownFields: true,
      validationMode: "collectAll",
      body: [
        newField({
          name: "nid",
          label: "National ID number",
          type: "string",
          required: true,
          description: "Old (10 or 13 digit) or smart-card (17 digit) national ID number.",
          example: "1990123456789",
          rules: [
            rule("numericString", undefined, "nid may contain digits only"),
            rule(
              "custom",
              "value.length === 10 || value.length === 13 || value.length === 17",
              "nid must be 10, 13 or 17 digits long",
            ),
          ],
        }),
        newField({
          name: "dateOfBirth",
          label: "Date of birth",
          type: "string",
          required: true,
          description: "Date of birth as printed on the NID, in YYYY-MM-DD form.",
          example: "1990-04-17",
          rules: [
            rule("dateFormat", "YYYY-MM-DD", "dateOfBirth must use the format YYYY-MM-DD"),
            rule("minAge", 18, "The customer must be at least 18 years old"),
          ],
        }),
        newField({
          name: "name",
          label: "Full name",
          type: "string",
          required: true,
          description: "Full name in English, exactly as printed on the NID.",
          example: "Rahim Uddin",
          rules: [rule("minLength", 3, "name must be at least 3 characters")],
        }),
      ],
      query: [],
      headers: [],
    },
    scenarios: [
      newScenario({
        name: "NID mismatch",
        description: "The submitted details do not match the national ID record.",
        conditions: [
          newCondition({ source: "body", path: "nid", operator: "eq", value: "1234567890" }),
        ],
        status: 200,
        body: {
          status: "FAILED",
          responseCode: "NID_MISMATCH",
          message: "The submitted details do not match the national ID record",
          data: {
            nid: "{{body.nid}}",
            verified: false,
            mismatchedFields: ["name", "dateOfBirth"],
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
      newScenario({
        name: "Verified",
        description: "Default response: the NID record matches the submitted details.",
        isDefault: true,
        status: 200,
        body: {
          status: "SUCCESS",
          responseCode: "NID_VERIFIED",
          message: "National ID verified successfully",
          data: {
            verified: true,
            nid: "{{body.nid}}",
            name: "{{body.name}}",
            dateOfBirth: "{{body.dateOfBirth}}",
            fatherName: "Karim Uddin",
            motherName: "Ayesha Begum",
            gender: "MALE",
            permanentAddress: "House 12, Road 5, Dhanmondi, Dhaka-1205",
            verificationId: "{{uuid}}",
            verifiedAt: "{{now}}",
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * 4. POST /otp/send + POST /otp/verify
 * ------------------------------------------------------------------ */

function otpSend(projectId: string): EndpointDef {
  return newEndpoint(projectId, {
    name: "Send OTP",
    method: "POST",
    path: "/otp/send",
    description:
      "Sends a 6-digit one-time password to the customer's mobile number and returns the " +
      "otpId that /otp/verify expects.",
    tags: ["otp", "security"],
    notes: `Mobile ${THROTTLED_MOBILE} always answers OTP_LIMIT_EXCEEDED.`,
    auth: { type: "apiKey", headerName: "x-api-key", token: API_KEY },
    request: {
      contentType: "application/json",
      allowUnknownFields: true,
      validationMode: "collectAll",
      body: [
        newField({
          name: "mobile",
          label: "Mobile number",
          type: "string",
          required: true,
          description: "11-digit Bangladeshi mobile number the OTP is sent to.",
          example: "01712345678",
          rules: [
            rule("pattern", MOBILE_PATTERN, "mobile must be a valid Bangladeshi mobile number"),
          ],
        }),
        newField({
          name: "purpose",
          label: "Purpose",
          type: "string",
          required: false,
          description: "What the OTP authorises. Defaults to TRANSACTION.",
          example: "TRANSACTION",
          defaultValue: "TRANSACTION",
          rules: [
            rule("enum", ["LOGIN", "TRANSACTION", "REGISTRATION"], "purpose must be one of: {arg}"),
          ],
        }),
      ],
      query: [],
      headers: [],
    },
    scenarios: [
      newScenario({
        name: "Throttled",
        description: "Too many OTPs were requested for this mobile number.",
        conditions: [
          newCondition({ source: "body", path: "mobile", operator: "eq", value: THROTTLED_MOBILE }),
        ],
        status: 429,
        headers: { "retry-after": "300" },
        body: {
          status: "FAILED",
          responseCode: "OTP_LIMIT_EXCEEDED",
          message: "Too many OTP requests. Try again after 5 minutes",
          data: { mobile: "{{body.mobile}}", retryAfterSeconds: 300 },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
      newScenario({
        name: "OTP sent",
        description: "Default response: the OTP was handed to the SMS gateway.",
        isDefault: true,
        status: 200,
        body: {
          status: "SUCCESS",
          responseCode: "OTP_SENT",
          message: "OTP has been sent to the registered mobile number",
          data: {
            otpId: "{{uuid}}",
            mobile: "{{body.mobile}}",
            purpose: "{{body.purpose}}",
            expiresInSeconds: 120,
            attemptsAllowed: 3,
            sentAt: "{{now}}",
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
    ],
  });
}

function otpVerify(projectId: string): EndpointDef {
  return newEndpoint(projectId, {
    name: "Verify OTP",
    method: "POST",
    path: "/otp/verify",
    description:
      "Verifies the 6-digit OTP that /otp/send issued and returns a short-lived " +
      "authorisation token.",
    tags: ["otp", "security"],
    notes: "OTP 000000 always answers OTP_INVALID.",
    auth: { type: "apiKey", headerName: "x-api-key", token: API_KEY },
    request: {
      contentType: "application/json",
      allowUnknownFields: true,
      validationMode: "collectAll",
      body: [
        newField({
          name: "mobile",
          label: "Mobile number",
          type: "string",
          required: true,
          description: "The mobile number the OTP was sent to.",
          example: "01712345678",
          rules: [
            rule("pattern", MOBILE_PATTERN, "mobile must be a valid Bangladeshi mobile number"),
          ],
        }),
        newField({
          name: "otpId",
          label: "OTP id",
          type: "string",
          required: false,
          description: "The otpId returned by /otp/send.",
          example: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
          rules: [rule("uuid", undefined, "otpId must be a valid UUID")],
        }),
        newField({
          name: "otp",
          label: "One-time password",
          type: "string",
          required: true,
          description: "The 6-digit code the customer received.",
          example: "483920",
          rules: [
            rule("exactLength", 6, "otp must be exactly 6 digits"),
            rule("numericString", undefined, "otp may contain digits only"),
          ],
        }),
      ],
      query: [],
      headers: [],
    },
    scenarios: [
      newScenario({
        name: "Wrong OTP",
        description: "The code does not match the one that was issued.",
        conditions: [
          newCondition({ source: "body", path: "otp", operator: "eq", value: "000000" }),
        ],
        status: 200,
        body: {
          status: "FAILED",
          responseCode: "OTP_INVALID",
          message: "The OTP you entered is incorrect",
          data: {
            mobile: "{{body.mobile}}",
            verified: false,
            remainingAttempts: 2,
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
      newScenario({
        name: "OTP verified",
        description: "Default response: the code matches and a session token is issued.",
        isDefault: true,
        status: 200,
        body: {
          status: "SUCCESS",
          responseCode: "OTP_VERIFIED",
          message: "OTP verified successfully",
          data: {
            mobile: "{{body.mobile}}",
            verified: true,
            authToken: "{{randomString(32)}}",
            expiresInSeconds: 600,
            verifiedAt: "{{now}}",
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * 5. GET /transactions
 * ------------------------------------------------------------------ */

function transactions(projectId: string): EndpointDef {
  return newEndpoint(projectId, {
    name: "Transaction History",
    method: "GET",
    path: "/transactions",
    description:
      "Paginated statement lines. Every query parameter is validated and coerced, so " +
      "?page=abc is rejected while ?page=2 arrives as the number 2.",
    tags: ["accounts", "reporting"],
    notes: "status=FAILED returns an empty page so you can test empty-state rendering.",
    auth: { type: "apiKey", headerName: "x-api-key", token: API_KEY },
    request: {
      contentType: "none",
      allowUnknownFields: true,
      validationMode: "collectAll",
      body: [],
      query: [
        newField({
          name: "page",
          label: "Page",
          type: "integer",
          required: false,
          description: "1-based page number.",
          example: 1,
          defaultValue: 1,
          rules: [rule("min", 1, "page must be 1 or greater")],
        }),
        newField({
          name: "limit",
          label: "Page size",
          type: "integer",
          required: false,
          description: "Rows per page, at most 100.",
          example: 20,
          defaultValue: 20,
          rules: [
            rule("min", 1, "limit must be 1 or greater"),
            rule("max", 100, "limit may not exceed 100"),
          ],
        }),
        newField({
          name: "from",
          label: "From date",
          type: "string",
          required: false,
          description: "Start of the statement window, YYYY-MM-DD.",
          example: "2026-08-01",
          rules: [rule("dateFormat", "YYYY-MM-DD", "from must use the format YYYY-MM-DD")],
        }),
        newField({
          name: "to",
          label: "To date",
          type: "string",
          required: false,
          description: "End of the statement window, YYYY-MM-DD.",
          example: "2026-08-12",
          rules: [rule("dateFormat", "YYYY-MM-DD", "to must use the format YYYY-MM-DD")],
        }),
        newField({
          name: "status",
          label: "Status filter",
          type: "string",
          required: false,
          description: "Only return transactions in this state.",
          example: "SUCCESS",
          rules: [
            rule("enum", ["SUCCESS", "FAILED", "PENDING"], "status must be one of: {arg}"),
          ],
        }),
      ],
      headers: [],
    },
    scenarios: [
      newScenario({
        name: "Empty page",
        description: "No failed transactions in the sandbox - handy for empty-state testing.",
        conditions: [
          newCondition({ source: "query", path: "status", operator: "eq", value: "FAILED" }),
        ],
        status: 200,
        body: {
          status: "SUCCESS",
          responseCode: "0000",
          message: "No transactions found for the given filter",
          data: {
            page: "{{query.page}}",
            limit: "{{query.limit}}",
            total: 0,
            totalPages: 0,
            items: [],
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
      newScenario({
        name: "Statement page",
        description: "Default response: one page of statement lines.",
        isDefault: true,
        status: 200,
        body: {
          status: "SUCCESS",
          responseCode: "0000",
          message: "Transaction history fetched successfully",
          data: {
            page: "{{query.page}}",
            limit: "{{query.limit}}",
            total: 137,
            totalPages: 7,
            filter: {
              from: '{{query.from || "2026-08-01"}}',
              to: '{{query.to || "2026-08-12"}}',
              status: '{{query.status || "ALL"}}',
            },
            items: [
              {
                transactionId: "{{randomDigits(12)}}",
                type: "DEBIT",
                channel: "NPSB",
                amount: "{{randomDecimal(100,25000,2)}}",
                currency: "BDT",
                counterparty: "Rahim Uddin",
                counterpartyAccount: "2020000000009",
                status: "SUCCESS",
                postedAt: "{{now}}",
              },
              {
                transactionId: "{{randomDigits(12)}}",
                type: "CREDIT",
                channel: "BEFTN",
                amount: "{{randomDecimal(100,25000,2)}}",
                currency: "BDT",
                counterparty: "Era Infotech Ltd",
                counterpartyAccount: "3030000000004",
                status: '{{pick("SUCCESS","PENDING")}}',
                postedAt: "{{now}}",
              },
            ],
          },
          requestId: "{{uuid}}",
          timestamp: "{{now}}",
        },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * 6. POST /soap/transfer-status/:referenceNo (SOAP / XML)
 * ------------------------------------------------------------------ */

/** Reference number that always answers with a SOAP Fault. */
const UNKNOWN_REFERENCE = "NPSB00000000";

const SOAP_REQUEST_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:npsb="urn:npsb:core">
  <soap:Body>
    <npsb:GetTransferStatusRequest>
      <npsb:ReferenceNo>NPSB12345678</npsb:ReferenceNo>
    </npsb:GetTransferStatusRequest>
  </soap:Body>
</soap:Envelope>`;

function transferStatusSoap(projectId: string): EndpointDef {
  return newEndpoint(projectId, {
    name: "Transfer Status (SOAP)",
    method: "POST",
    path: "/soap/transfer-status/:referenceNo",
    description:
      "SOAP counterpart of the fund transfer flow - looks up a transfer by its reference " +
      "number and answers with a SOAP envelope. Demonstrates the studio's non-JSON content " +
      "types: the request and response bodies are raw XML, not a validated field tree.",
    tags: ["payments", "npsb", "soap"],
    notes:
      "The studio does not parse XML, so a scenario can only match the whole raw body " +
      "(contains/regex) or a header such as SOAPAction - never a field inside it. This demo " +
      "sidesteps that by keying the reference number off the URL (:referenceNo) instead of the " +
      `envelope. Call it with ${UNKNOWN_REFERENCE} to see the SOAP Fault response.`,
    auth: { type: "none" },
    request: {
      contentType: "text/xml",
      allowUnknownFields: true,
      validationMode: "collectAll",
      body: [],
      query: [],
      headers: [],
      sampleBody: SOAP_REQUEST_SAMPLE,
    },
    responseContentType: "text/xml",
    scenarios: [
      newScenario({
        name: "Reference not found",
        description: `Reference ${UNKNOWN_REFERENCE} does not exist in the sandbox ledger.`,
        conditions: [
          newCondition({
            source: "path",
            path: "referenceNo",
            operator: "eq",
            value: UNKNOWN_REFERENCE,
          }),
        ],
        status: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Client</faultcode>
      <faultstring>No transfer found for reference {{path.referenceNo}}</faultstring>
      <detail>
        <referenceNo>{{path.referenceNo}}</referenceNo>
      </detail>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`,
      }),
      newScenario({
        name: "Transfer status",
        description: "Default response: a completed transfer.",
        isDefault: true,
        status: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:npsb="urn:npsb:core">
  <soap:Body>
    <npsb:GetTransferStatusResponse>
      <npsb:ReferenceNo>{{path.referenceNo}}</npsb:ReferenceNo>
      <npsb:Status>COMPLETED</npsb:Status>
      <npsb:Amount>{{randomDecimal(100,50000,2)}}</npsb:Amount>
      <npsb:Currency>BDT</npsb:Currency>
      <npsb:SettledAt>{{now}}</npsb:SettledAt>
      <npsb:TraceId>{{uuid}}</npsb:TraceId>
    </npsb:GetTransferStatusResponse>
  </soap:Body>
</soap:Envelope>`,
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * What `SeedService.seedDemoData()` installs
 * ------------------------------------------------------------------ */

/** Skipped (not re-seeded) when a project with this slug already exists. */
export const DEMO_SLUG = "core-banking";

export const DEMO_PROJECT = {
  name: "Core Banking Sandbox",
  slug: DEMO_SLUG,
  description:
    "A faithful stand-in for the core banking / NPSB APIs: fund transfer, balance " +
    "enquiry, NID verification, OTP and transaction history. Use it to build and test " +
    "integrations before production access is granted.",
  color: "#2563eb",
  defaultHeaders: {
    "x-sandbox": "core-banking",
    "cache-control": "no-store",
  },
};

export const ENDPOINT_BUILDERS: Array<(projectId: string) => EndpointDef> = [
  fundTransfer,
  accountBalance,
  nidVerify,
  otpSend,
  otpVerify,
  transactions,
  transferStatusSoap,
];
