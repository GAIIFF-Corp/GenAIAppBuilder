#!/bin/bash

# Consolidated Generative AI Application Builder Deployment Script

set -e

echo "🚀 Starting deployment of Generative AI Application Builder"
echo "=============================================="

STACK_NAME=${1:-"GAIIFFGenAIBuilder"}

echo "📦 Stack Name: $STACK_NAME"
echo "🔐 Authentication: Self-registration enabled via Cognito Hosted UI"
echo ""

# Install infrastructure dependencies
echo "📦 Installing infrastructure dependencies..."
cd infrastructure
npm install

# Build and deploy the CDK stack
echo "🏗️  Building and deploying infrastructure..."
npm run build
npx cdk bootstrap
npx cdk deploy --require-approval never \
    --context stackName="$STACK_NAME"

# Get stack outputs
echo "📋 Getting stack outputs..."
STACK_OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs' --output json)

API_ENDPOINT=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="RestEndpointUrl") | .OutputValue')
USER_POOL_ID=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="UserPoolId") | .OutputValue')
USER_POOL_CLIENT_ID=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="CognitoClientId") | .OutputValue')
COGNITO_DOMAIN=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="CognitoDomain") | .OutputValue')
CLOUDFRONT_URL=$(echo $STACK_OUTPUTS | jq -r '.[] | select(.OutputKey=="CloudFrontWebUrl") | .OutputValue')

echo "✅ Infrastructure deployed successfully!"
echo ""
echo "📊 Stack Information:"
echo "  - API Endpoint: $API_ENDPOINT"
echo "  - CloudFront URL: $CLOUDFRONT_URL"
echo "  - User Pool ID: $USER_POOL_ID"
echo "  - Client ID: $USER_POOL_CLIENT_ID"
echo "  - Cognito Domain: $COGNITO_DOMAIN"
echo ""

# Create runtime configuration for unified UI
echo "⚙️  Creating runtime configuration..."

cd ../

# Create runtime config for unified UI
cat > ui-unified/public/runtimeConfig.json << EOF
{
  "ApiEndpoint": "$API_ENDPOINT",
  "IsInternalUser": "false",
  "CognitoRedirectUrl": "http://localhost:5175",
  "UserPoolId": "$USER_POOL_ID",
  "UserPoolClientId": "$USER_POOL_CLIENT_ID",
  "AwsRegion": "$(aws configure get region)",
  "CognitoDomain": "$COGNITO_DOMAIN"
}
EOF

# Update Cognito User Pool Client to allow localhost URLs
echo "🔐 Updating Cognito configuration for local development..."
aws cognito-idp update-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$USER_POOL_CLIENT_ID" \
    --callback-urls "$CLOUDFRONT_URL" "http://localhost:5175" \
    --logout-urls "$CLOUDFRONT_URL" "http://localhost:5175" \
    --supported-identity-providers "COGNITO" \
    --allowed-o-auth-flows "code" "implicit" \
    --allowed-o-auth-scopes "email" "openid" "profile" "aws.cognito.signin.user.admin" \
    --explicit-auth-flows "ALLOW_ADMIN_USER_PASSWORD_AUTH" "ALLOW_CUSTOM_AUTH" "ALLOW_REFRESH_TOKEN_AUTH" "ALLOW_USER_PASSWORD_AUTH" "ALLOW_USER_SRP_AUTH"

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "🚀 Next Steps:"
echo "1. Install UI dependencies:"
echo "   cd ui-unified && npm install"
echo ""
echo "2. Start the unified application:"
echo "   ./start-unified-ui.sh        # Unified interface (port 5175)"
echo ""
echo "3. User Registration:"
echo "   🔐 Users can self-register using the Cognito Hosted UI"
echo "   📧 Email verification is required for new accounts"
echo "   🔑 Password requirements: 8+ chars, uppercase, lowercase, numbers"
echo ""
echo "📱 Access URLs:"
echo "  - Unified UI: http://localhost:5175"
echo "  - Dashboard: http://localhost:5175/"
echo "  - Chat Interface: http://localhost:5175/chat"
echo "  - CloudFront: $CLOUDFRONT_URL"
echo "  - Cognito Hosted UI: https://$COGNITO_DOMAIN/login?client_id=$USER_POOL_CLIENT_ID&response_type=code&scope=email+openid+profile&redirect_uri=http://localhost:5175"
echo ""
echo "Happy building! 🎯"
