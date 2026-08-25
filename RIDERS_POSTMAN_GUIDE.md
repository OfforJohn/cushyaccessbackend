# Riders API - Postman Documentation

## Overview
This document provides complete instructions for testing the Riders Registration, Login, and Identity Verification APIs using Postman.

## Import Postman Collection

1. **Open Postman**
2. Click **Import** button (top-left)
3. Select **Upload Files** tab
4. Choose `Riders_API.postman_collection.json` from the project root
5. Click **Import**

The collection will load with 4 pre-configured requests.

---

## Environment Variables Setup

The collection uses Postman environment variables for easy configuration:

| Variable | Default | Purpose |
|----------|---------|---------|
| `base_url` | `http://localhost:4000` | API base URL (change if running on different port) |
| `rider_id` | Empty | Store rider ID from register response |
| `access_token` | Empty | Store JWT token from login response |
| `username` | `+1234567890` | Default test phone number |

### How to Set Variables

1. In Postman, click **Variables** tab (bottom of screen)
2. Update `base_url` if needed (e.g., `http://localhost:3000`)
3. Variables will auto-populate from request responses

---

## API Endpoints

### 1. Register Rider
**Endpoint:** `POST /api/v1/riders/register`  
**Auth Required:** No (Public)  
**Description:** Register a new rider with first name, last name, phone number, and optional password

#### Request Body
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+1234567890",
  "email": "john.doe@example.com",
  "password": "SecurePassword123!",
  "identity_number": "ID123456789",
  "identity_document_url": "https://example.com/documents/id.jpg"
}
```

#### Response (Success)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "+1234567890",
  "first_name": "John",
  "last_name": "Doe",
  "name": "John Doe",
  "phone": "+1234567890",
  "email": "john.doe@example.com",
  "status": "PENDING",
  "identity_number": "ID123456789",
  "identity_document_url": "https://example.com/documents/id.jpg",
  "is_identity_verified": false,
  "createdAt": "2026-02-27T15:45:00Z",
  "updatedAt": "2026-02-27T15:45:00Z"
}
```

#### Notes
- **Password:** Optional (min 6 characters) - can be set during registration or later
- **Phone:** Must be unique, becomes the username
- **Email:** Optional
- **Identity fields:** Optional (can be added/verified later)
- **Status:** Always starts as "PENDING"

**Copy the `id` from response into `rider_id` variable for next steps**

---

### 2. Login
**Endpoint:** `POST /api/v1/riders/login`  
**Auth Required:** No (Public)  
**Description:** Authenticate rider using phone number as username and password

#### Request Body
```json
{
  "username": "+1234567890",
  "password": "SecurePassword123!"
}
```

#### Response (Success)
```json
{
  "error": false,
  "message": "AUTHENTICATED_SUCCESSFULLY",
  "data": {
    "rider": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "username": "+1234567890",
      "first_name": "John",
      "last_name": "Doe",
      "phone": "+1234567890",
      "email": "john.doe@example.com",
      "status": "PENDING",
      "is_identity_verified": false
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Error Cases
- **Password not set:** If rider registered without password
  ```json
  {
    "error": true,
    "message": "PASSWORD_NOT_SET"
  }
  ```
- **Wrong password:**
  ```json
  {
    "error": true,
    "message": "INCORRECT_PASSWORD"
  }
  ```
- **Rider not found:**
  ```json
  {
    "error": true,
    "message": "RIDER_NOT_FOUND"
  }
  ```

**Copy the `access_token` from response into `access_token` variable for protected endpoints**

---

### 3. Set/Update Password (Optional)
**Endpoint:** `POST /api/v1/riders/set-password?id=<RIDER_ID>`  
**Auth Required:** Yes (Bearer Token)  
**Description:** Update password for a rider (only needed if changing password after registration)

#### Headers Required
```
Authorization: Bearer {{access_token}}
Content-Type: application/json
```

#### Request Body
```json
{
  "password": "NewSecurePassword456!"
}
```

#### Response (Success)
```json
{
  "error": false,
  "message": "PASSWORD_SET_SUCCESSFULLY"
}
```

#### Notes
- **Optional endpoint:** Only use if rider needs to change password
- **Requires authentication:** Must include JWT token in Authorization header
- **Minimum length:** 6 characters

---

### 4. Verify Identity
**Endpoint:** `POST /api/v1/riders/verify?id=<RIDER_ID>`  
**Auth Required:** No (Admin/Manual endpoint)  
**Description:** Verify a rider's identity and change status to VERIFIED

#### Query Parameters
- `id` (required): Rider ID from registration response

#### Response (Success)
```json
{
  "error": false,
  "message": "IDENTITY_VERIFIED"
}
```

#### Notes
- **Admin endpoint:** Used by admin/verification team to approve identity
- **Status change:** Changes rider status from "PENDING" to "VERIFIED"
- **Requires manual call:** Not typically called by riders themselves

---

## Complete Test Workflow

### Scenario: New Rider Registration & Login

#### Step 1: Register
1. Open **Register Rider** request in collection
2. Update phone number (+ any other fields)
3. Click **Send**
4. Copy the `id` field from response
5. In **Variables** tab, paste into `rider_id` field

#### Step 2: Login
1. Open **Login** request
2. Update `username` to your test phone number
3. Update `password` to match registration password
4. Click **Send**
5. Copy `access_token` from response
6. In **Variables** tab, paste into `access_token` field

#### Step 3: (Optional) Update Password
1. Open **Set Password** request
2. Ensure `{{rider_id}}` is set in Variables
3. Ensure Authorization header has `Bearer {{access_token}}`
4. Update password in request body
5. Click **Send**

#### Step 4: (Admin Only) Verify Identity
1. Open **Verify Identity** request
2. Ensure `{{rider_id}}` is set in query parameter
3. Click **Send**
4. Rider status changes from "PENDING" to "VERIFIED"

---

## Testing Checklist

- [ ] Register new rider with phone, name, password
- [ ] Verify rider created in database
- [ ] Login with correct credentials
- [ ] Receive valid JWT token
- [ ] Attempt login with wrong password (should fail)
- [ ] Attempt login with non-existent phone (should fail)
- [ ] Update password (requires token)
- [ ] Login with new password
- [ ] Verify identity (admin endpoint)
- [ ] Check rider status changed to VERIFIED

---

## Common Issues & Solutions

### Issue: "UNAUTHORIZED" Error
**Cause:** Route is protected and missing JWT token  
**Solution:** 
- Check if endpoint requires auth (see table above)
- For protected endpoints, add `Authorization: Bearer {{access_token}}` header
- Ensure `access_token` variable is set from login response

### Issue: "EXISTING_RIDER_WITH_PHONE_OR_USERNAME" Error
**Cause:** Phone number already registered  
**Solution:** Use a different phone number in registration

### Issue: "PASSWORD_NOT_SET" on Login
**Cause:** Rider registered without password  
**Solution:** 
- Use set-password endpoint to add password first, OR
- Register with password field included

### Issue: "RIDER_NOT_FOUND" on Login
**Cause:** Phone number not registered  
**Solution:** Verify phone number matches registration exactly (including country code)

### Issue: Token Expired
**Cause:** JWT token has expired  
**Solution:** Login again to get fresh token

---

## Database Verification

You can verify riders were created by querying the database directly:

```sql
SELECT id, username, first_name, last_name, phone, status, is_identity_verified 
FROM rider 
ORDER BY "createdAt" DESC 
LIMIT 10;
```

---

## Quick Reference

| Action | Endpoint | Method | Auth | Status |
|--------|----------|--------|------|--------|
| Register | `/api/v1/riders/register` | POST | No | Public |
| Login | `/api/v1/riders/login` | POST | No | Public |
| Set Password | `/api/v1/riders/set-password` | POST | Yes | Protected |
| Verify Identity | `/api/v1/riders/verify` | POST | No | Admin |

---

## File Location

- **Collection:** `Riders_API.postman_collection.json` (project root)
- **Service:** `src/riders/riders.service.ts`
- **Controller:** `src/riders/riders.controller.ts`
- **Entity:** `src/users/model/rider.entity.ts`

---

## Support

For issues or questions:
1. Check the **Common Issues** section above
2. Verify all required fields are included
3. Ensure base_url matches your API server
4. Check server logs for detailed error messages
