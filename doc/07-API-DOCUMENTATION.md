# 07-API-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document defines the RESTful API endpoints, request payloads, response formats, and authentication rules for the verified capability platform. All endpoints enforce strict server-side validation and role-based access control (RBAC).

Sessions are issued by Supabase Auth and presented as `Authorization: Bearer <access_token>`. Field names in request bodies are camelCase.

---

## 2. Base URL & Versioning
* **Base URL:** `/api/v1`
* **Protocol:** HTTPS only
* **Content-Type:** `application/json`

---

## 3. Authentication Endpoints

Credentials are owned by Supabase Auth. These endpoints create accounts and exchange credentials for a session on the server, so the service-role key is never exposed to the browser and role claims are always written server-side.

### A. Register User
* **Endpoint:** `POST /api/v1/auth/register`
* **Description:** Registers a new user account (worker, employer, or training provider) in Supabase Auth and writes the server-controlled role claim.
* **Request Body:**
  ```json
  {
    "phoneNumber": "+233241234567",
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "role": "worker",
    "fullName": "Ama Mensah"
  }
  ```
At least one of `phoneNumber` or `email` is required. Passwords must be at least 12 characters and include an uppercase letter, a lowercase letter, and a number.

Response (201 Created): Returns the user object and role. A session is not issued until the account is confirmed.

### B. Login User
* **Endpoint:** `POST /api/v1/auth/login`
* **Description:** Authenticates an existing user through Supabase Auth and returns a session.
* **Request Body:**
  ```json
  {
    "phoneNumber": "+233241234567",
    "password": "SecurePassword123!"
  }
  ```
Response (200 OK): Returns the user object, role, and a session containing the access token, refresh token, and expiry.

### C. Current Profile
* **Endpoint:** `GET /api/v1/auth/me`
* **Description:** Returns the authenticated caller's profile and role.
* **Authorization:** `Authorization: Bearer <access_token>`

Response (200 OK): Returns the caller's id, role, full name, location, organization, and avatar.

---

## 4. Worker & Proof Ingestion Endpoints

### A. Log Work Proof
* **Endpoint:** `POST /api/v1/workers/proofs`
* **Description:** Allows a worker to submit a completed task proof (voice/photo log). Requires worker authorization.
* **Request Body (Multipart Form-Data):**
  ```json
  {
    "skillTag": "Refrigeration Repair",
    "description": "Replaced commercial compressor and fixed electrical fault.",
    "submissionGps": "5.6037,-0.1870"
  }
  ```
`media_file` is uploaded as multipart binary to a private Supabase Storage bucket. Only image and audio types on an allow-list are accepted, files are size-capped, and stored object paths use unpredictable random identifiers.

Response (201 Created): Returns work proof ID, metadata check status, and generated verification token.

---

## 5. Verification Endpoints (SMS / WhatsApp Loop)

### A. Get Verification Details
* **Endpoint:** `GET /api/v1/verifications/{token}`
* **Description:** Public endpoint accessed via SMS/WhatsApp web link by clients to view task confirmation details.

Response (200 OK): Returns task summary and worker skill category without exposing private PII.

### B. Submit Client Confirmation
* **Endpoint:** `POST /api/v1/verifications/{token}`
* **Description:** Submits the client's "Yes/No" confirmation response along with device telemetry. The link is single-use; a second submission returns `409`.
* **Request Body:**
  ```json
  {
    "response": "confirmed",
    "verifierGps": "5.6039,-0.1872"
  }
  ```
`response` must be `confirmed` or `rejected`.

Response (200 OK): Returns success status and triggers background anti-fraud score calculation.

Possible errors: `404` invalid link, `409` link already used, `410` link expired.

---

## 6. Employer & Matching Endpoints

### A. Create Capability Spec
* **Endpoint:** `POST /api/v1/employers/specs`
* **Description:** Allows an employer to create a verifiable hiring filter. Requires employer authorization.
* **Request Body:**
  ```json
  {
    "requiredSkill": "Industrial Machine Operator",
    "minProofThreshold": 15,
    "maxDistanceKm": 20
  }
  ```
Response (201 Created): Returns created spec object.

### B. Zero-Knowledge Talent Search
* **Endpoint:** `GET /api/v1/employers/search`
* **Description:** Searches for verified workers matching active spec criteria while masking personal identity.
* **Query Parameters:** `spec_id=UUID`

Response (200 OK): Returns list of anonymized candidate tokens, aggregate proof counts, and trust scores.

---

## 7. Standard Error Response Format
All error responses follow a consistent JSON structure:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid authentication token provided.",
    "status": 401
  }
}
```
