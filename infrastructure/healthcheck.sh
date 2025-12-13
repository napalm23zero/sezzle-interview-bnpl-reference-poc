#!/bin/bash

# PulsePay Infrastructure Health Check
# This script validates all services are up and running

# Don't exit on error - we want to check all services
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  🏥 PulsePay Infrastructure Health Check${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

check_service() {
    local name=$1
    local command=$2
    local icon=$3
    
    printf "  ${icon} %-20s ... " "$name"
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ OK${NC}"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

print_section() {
    echo ""
    echo -e "${YELLOW}▶ $1${NC}"
    echo ""
}

print_header

# ============================================
# DATABASES
# ============================================
print_section "Databases"

check_service "PostgreSQL" \
    "docker exec pulsepay-postgres psql -U pulsepay -d postgres -c 'SELECT 1' 2>/dev/null" \
    "🐘"

check_service "MySQL" \
    "docker exec pulsepay-mysql mysql -u pulsepay -ppulsepay_dev -D pulsepay_ledger -e 'SELECT 1' 2>/dev/null" \
    "🐬"

check_service "Redis" \
    "docker exec pulsepay-redis redis-cli PING 2>/dev/null | grep -q PONG" \
    "🔴"

check_service "Elasticsearch" \
    "docker exec pulsepay-elasticsearch curl -s http://localhost:9200/_cluster/health 2>/dev/null | grep -qE '(green|yellow)'" \
    "🔍"

# ============================================
# AWS LOCAL (LocalStack)
# ============================================
print_section "AWS Local (LocalStack)"

check_service "LocalStack" \
    "docker exec pulsepay-localstack curl -s http://localhost:4566/_localstack/health 2>/dev/null | grep -q running" \
    "☁️ "

check_service "SQS Queues" \
    "docker exec pulsepay-localstack awslocal sqs list-queues 2>/dev/null | grep -q QueueUrls" \
    "📨"

check_service "SNS Topics" \
    "docker exec pulsepay-localstack awslocal sns list-topics 2>/dev/null" \
    "📢"

# ============================================
# OBSERVABILITY
# ============================================
print_section "Observability Stack"

check_service "Prometheus" \
    "docker exec pulsepay-prometheus wget -q --spider http://localhost:9090/-/ready 2>/dev/null || docker exec pulsepay-prometheus curl -s http://localhost:9090/-/ready 2>/dev/null" \
    "📊"

check_service "Grafana" \
    "docker exec pulsepay-grafana curl -s http://localhost:3000/api/health 2>/dev/null | grep -q ok || docker exec pulsepay-grafana wget -q -O- http://localhost:3000/api/health 2>/dev/null | grep -q ok" \
    "📈"

check_service "Jaeger" \
    "docker exec pulsepay-jaeger wget -q --spider http://localhost:16686/ 2>/dev/null || curl -s http://localhost:16686/ 2>/dev/null" \
    "🔭"

check_service "OTEL Collector" \
    "docker exec pulsepay-otel-collector wget -q -O- http://localhost:13133/ 2>/dev/null || curl -s http://localhost:18888/metrics 2>/dev/null | head -1" \
    "📡"

# ============================================
# SUMMARY
# ============================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TOTAL=$((PASSED + FAILED))

if [ $FAILED -eq 0 ]; then
    echo -e "  ${GREEN}🎉 All services healthy!${NC}"
else
    echo -e "  ${YELLOW}⚠️  Some services need attention${NC}"
fi

echo ""
echo -e "  Summary: ${GREEN}$PASSED passed${NC} / ${RED}$FAILED failed${NC} / $TOTAL total"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Exit with error code if any service failed
[ $FAILED -eq 0 ] && exit 0 || exit 1
