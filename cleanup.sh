#!/bin/bash

# Cleanup script for Generative AI Application Builder

set -e

STACK_NAME=${1:-"GAIIFFGenAIBuilder"}

echo "🧹 Cleaning up Generative AI Application Builder"
echo "=============================================="
echo "📦 Stack Name: $STACK_NAME"
echo ""

read -p "⚠️  This will delete ALL resources. Are you sure? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cleanup cancelled"
    exit 1
fi

echo "🗑️  Destroying CloudFormation stack..."
cd infrastructure
npx cdk destroy --force

echo ""
echo "🧹 Cleaning up local files..."
rm -f ../ui-deployment/public/runtimeConfig.json
rm -f ../ui-chat/public/runtimeConfig.json

echo ""
echo "✅ Cleanup completed successfully!"
echo "All AWS resources have been removed."
