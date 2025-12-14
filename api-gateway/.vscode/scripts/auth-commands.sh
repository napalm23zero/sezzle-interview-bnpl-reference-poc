#!/bin/bash
#
# Quick Auth Commands - Copy-paste ready examples
# -----------------------------------------------
# This file contains individual curl commands for auth operations.
# Copy and paste the commands you need.
#
# Prerequisites:
# 1. API Gateway running: npm run dev
# 2. Infrastructure running: PostgreSQL + Redis
#

BASE_URL="http://localhost:3000"

# ============================================================================
# 1. REGISTER USER
# ============================================================================
# Creates a new user account. No authentication required.
# Returns: user info + access token + refresh token

curl -X POST "${BASE_URL}/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "firstName": "John",
    "lastName": "Doe",
    "role": "consumer"
  }' | jq

# Roles available: admin, merchant, consumer

# ============================================================================
# 2. LOGIN
# ============================================================================
# Authenticates user and returns tokens.
# Account locks after 5 failed attempts for 15 minutes.

curl -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }' | jq

# ============================================================================
# 3. ACCESS PROTECTED ENDPOINT
# ============================================================================
# Use the access token from login/register response.
# Replace <ACCESS_TOKEN> with your actual token.

curl -X GET "${BASE_URL}/auth/me" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" | jq

# ============================================================================
# 4. REFRESH TOKENS
# ============================================================================
# Exchange refresh token for new access + refresh tokens.
# Old refresh token becomes invalid (token rotation).
# Replace <REFRESH_TOKEN> with your actual token.

curl -X POST "${BASE_URL}/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<REFRESH_TOKEN>"
  }' | jq

# ============================================================================
# 5. LOGOUT (Single Session)
# ============================================================================
# Revokes the provided refresh token.
# Access token remains valid until expiry.

curl -X POST "${BASE_URL}/auth/logout" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<REFRESH_TOKEN>"
  }' | jq

# ============================================================================
# 6. LOGOUT ALL SESSIONS
# ============================================================================
# Revokes ALL refresh tokens for the user.
# Requires authentication.

curl -X POST "${BASE_URL}/auth/logout-all" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" | jq

# ============================================================================
# PASSWORD REQUIREMENTS
# ============================================================================
# - Minimum 8 characters
# - At least 1 uppercase letter
# - At least 1 lowercase letter  
# - At least 1 number
# - At least 1 special character (!@#$%^&*()_+-=[]{}|;:,.<>?)

# ============================================================================
# TOKEN LIFETIMES
# ============================================================================
# - Access Token: 15 minutes (configurable via JWT_ACCESS_TOKEN_EXPIRY)
# - Refresh Token: 7 days (configurable via JWT_REFRESH_TOKEN_EXPIRY)

# ============================================================================
# EXAMPLE: Complete Flow
# ============================================================================
# Uncomment and run this section for a complete demo

# # 1. Register
# REGISTER=$(curl -s -X POST "${BASE_URL}/auth/register" \
#   -H "Content-Type: application/json" \
#   -d '{
#     "email": "test-'$(date +%s)'@example.com",
#     "password": "SecurePass123!",
#     "firstName": "Test",
#     "lastName": "User",
#     "role": "consumer"
#   }')
# echo "Register Response:" && echo "$REGISTER" | jq
#
# # 2. Extract tokens
# ACCESS_TOKEN=$(echo "$REGISTER" | jq -r '.data.accessToken')
# REFRESH_TOKEN=$(echo "$REGISTER" | jq -r '.data.refreshToken')
#
# # 3. Get user info
# echo "User Info:" && curl -s -X GET "${BASE_URL}/auth/me" \
#   -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq
#
# # 4. Refresh tokens
# REFRESH=$(curl -s -X POST "${BASE_URL}/auth/refresh" \
#   -H "Content-Type: application/json" \
#   -d "{\"refreshToken\": \"${REFRESH_TOKEN}\"}")
# echo "Refresh Response:" && echo "$REFRESH" | jq
#
# # 5. Logout
# NEW_REFRESH=$(echo "$REFRESH" | jq -r '.data.refreshToken')
# curl -s -X POST "${BASE_URL}/auth/logout" \
#   -H "Content-Type: application/json" \
#   -d "{\"refreshToken\": \"${NEW_REFRESH}\"}" | jq
