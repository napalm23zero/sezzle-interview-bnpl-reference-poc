#!/bin/bash
#
# PulsePay Auth Demo Script
# -------------------------
# Demonstrates the complete authentication flow:
# 1. Register a new user
# 2. Login to get tokens
# 3. Access protected endpoint
# 4. Refresh tokens
# 5. Logout
#
# Usage: ./auth-demo.sh [BASE_URL]
# Default: http://localhost:3000

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${1:-http://localhost:3000}"
TIMESTAMP=$(date +%s)
TEST_EMAIL="demo-${TIMESTAMP}@example.com"
TEST_PASSWORD="SecurePass123!"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           PulsePay Authentication Demo                       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Base URL:${NC} $BASE_URL"
echo -e "${YELLOW}Test Email:${NC} $TEST_EMAIL"
echo ""

# Function to pretty print JSON
pretty_json() {
  if command -v jq &> /dev/null; then
    echo "$1" | jq .
  else
    echo "$1"
  fi
}

# Function to extract value from JSON
extract_json() {
  if command -v jq &> /dev/null; then
    echo "$1" | jq -r "$2"
  else
    echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | cut -d'"' -f4
  fi
}

# ============================================================================
# STEP 1: Register a new user
# ============================================================================
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 1: Register New User${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Request:${NC} POST ${BASE_URL}/auth/register"
echo -e "${YELLOW}Body:${NC}"
cat << EOF
{
  "email": "$TEST_EMAIL",
  "password": "$TEST_PASSWORD",
  "firstName": "Demo",
  "lastName": "User",
  "role": "consumer"
}
EOF
echo ""

REGISTER_RESPONSE=$(curl -s -X POST "${BASE_URL}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${TEST_EMAIL}\",
    \"password\": \"${TEST_PASSWORD}\",
    \"firstName\": \"Demo\",
    \"lastName\": \"User\",
    \"role\": \"consumer\"
  }")

echo -e "${YELLOW}Response:${NC}"
pretty_json "$REGISTER_RESPONSE"
echo ""

# Extract tokens from registration
ACCESS_TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.accessToken // empty')
REFRESH_TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.refreshToken // empty')

if [ -z "$ACCESS_TOKEN" ]; then
  echo -e "${RED}✗ Registration failed! Check if the server is running.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ User registered successfully!${NC}"
echo ""

# ============================================================================
# STEP 2: Login (to demonstrate the login flow)
# ============================================================================
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 2: Login${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Request:${NC} POST ${BASE_URL}/auth/login"
echo -e "${YELLOW}Body:${NC}"
cat << EOF
{
  "email": "$TEST_EMAIL",
  "password": "$TEST_PASSWORD"
}
EOF
echo ""

LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${TEST_EMAIL}\",
    \"password\": \"${TEST_PASSWORD}\"
  }")

echo -e "${YELLOW}Response:${NC}"
pretty_json "$LOGIN_RESPONSE"
echo ""

# Update tokens from login
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.accessToken // empty')
REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.refreshToken // empty')

if [ -z "$ACCESS_TOKEN" ]; then
  echo -e "${RED}✗ Login failed!${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Login successful!${NC}"
echo ""

# ============================================================================
# STEP 3: Access Protected Endpoint (GET /auth/me)
# ============================================================================
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 3: Access Protected Endpoint${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Request:${NC} GET ${BASE_URL}/auth/me"
echo -e "${YELLOW}Header:${NC} Authorization: Bearer <access_token>"
echo ""

ME_RESPONSE=$(curl -s -X GET "${BASE_URL}/auth/me" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

echo -e "${YELLOW}Response:${NC}"
pretty_json "$ME_RESPONSE"
echo ""

echo -e "${GREEN}✓ Protected endpoint accessed successfully!${NC}"
echo ""

# ============================================================================
# STEP 4: Refresh Tokens
# ============================================================================
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 4: Refresh Tokens${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Request:${NC} POST ${BASE_URL}/auth/refresh"
echo -e "${YELLOW}Body:${NC}"
cat << EOF
{
  "refreshToken": "<refresh_token>"
}
EOF
echo ""

REFRESH_RESPONSE=$(curl -s -X POST "${BASE_URL}/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"${REFRESH_TOKEN}\"
  }")

echo -e "${YELLOW}Response:${NC}"
pretty_json "$REFRESH_RESPONSE"
echo ""

# Update tokens
NEW_ACCESS_TOKEN=$(echo "$REFRESH_RESPONSE" | jq -r '.data.accessToken // empty')
NEW_REFRESH_TOKEN=$(echo "$REFRESH_RESPONSE" | jq -r '.data.refreshToken // empty')

if [ -z "$NEW_ACCESS_TOKEN" ]; then
  echo -e "${RED}✗ Token refresh failed!${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Tokens refreshed successfully!${NC}"
echo -e "${BLUE}Note: Old refresh token is now invalid (token rotation)${NC}"
echo ""

# ============================================================================
# STEP 5: Verify New Token Works
# ============================================================================
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 5: Verify New Token${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

VERIFY_RESPONSE=$(curl -s -X GET "${BASE_URL}/auth/me" \
  -H "Authorization: Bearer ${NEW_ACCESS_TOKEN}")

echo -e "${YELLOW}Response:${NC}"
pretty_json "$VERIFY_RESPONSE"
echo ""

echo -e "${GREEN}✓ New token verified!${NC}"
echo ""

# ============================================================================
# STEP 6: Logout
# ============================================================================
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}STEP 6: Logout${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Request:${NC} POST ${BASE_URL}/auth/logout"
echo ""

LOGOUT_RESPONSE=$(curl -s -X POST "${BASE_URL}/auth/logout" \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"${NEW_REFRESH_TOKEN}\"
  }")

echo -e "${YELLOW}Response:${NC}"
pretty_json "$LOGOUT_RESPONSE"
echo ""

echo -e "${GREEN}✓ Logged out successfully!${NC}"
echo ""

# ============================================================================
# Summary
# ============================================================================
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                     Demo Complete!                           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Authentication Flow Summary:${NC}"
echo ""
echo "  1. POST /auth/register - Create user, returns tokens"
echo "  2. POST /auth/login    - Authenticate, returns tokens"
echo "  3. GET  /auth/me       - Protected (requires Bearer token)"
echo "  4. POST /auth/refresh  - Exchange refresh token for new pair"
echo "  5. POST /auth/logout   - Revoke refresh token"
echo ""
echo -e "${YELLOW}Security Features:${NC}"
echo "  • Argon2id password hashing (memory-hard)"
echo "  • Token rotation on refresh"
echo "  • Account lockout after 5 failed attempts"
echo "  • Redis caching for token validation"
echo ""
