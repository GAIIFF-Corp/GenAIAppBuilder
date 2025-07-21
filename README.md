# Consolidated Generative AI Application Builder

A simplified, single-stack architecture for building and deploying generative AI applications on AWS. This project combines all functionality into one CloudFormation stack with a single DynamoDB table and a unified user interface, making deployment and management much simpler.

## 🏗️ Architecture

### Single Stack Design
- **One CloudFormation Stack**: All resources in a single template
- **One DynamoDB Table**: Unified data storage with composite keys
- **One User Interface**: Combined deployment management and chat interface
- **Simplified Deployment**: No nested stacks or complex dependencies

### Components
- **Infrastructure**: AWS CDK stack with all AWS resources
- **Unified UI**: React application combining deployment management and chat interface (port 5175)

### AWS Resources
- **DynamoDB**: Single table for all data (conversations, deployments, configurations)
- **Lambda Functions**: Chat processing, deployment management, model info
- **API Gateway**: REST API with Cognito authentication
- **Cognito**: User authentication and authorization
- **CloudFront**: Content delivery for web assets
- **S3**: Static website hosting and access logs
- **SSM**: Configuration parameter storage

## 🚀 Quick Start

### Prerequisites
- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- AWS CDK CLI (`npm install -g aws-cdk`)
- jq (for JSON processing in scripts)

### 1. Deploy Infrastructure

```bash
# Clone or navigate to the project directory
cd /Users/sgg/Applications/GAIIFFGenAIBuilder

# Deploy (no email required - users self-register)
./deploy.sh
```

The deployment script will:
- Install dependencies
- Deploy the CDK stack with self-registration enabled
- Configure Cognito Hosted UI for authentication
- Create runtime configuration files
- Enable user self-registration with email verification

### 2. Start Local UI

```bash
# Start the Unified UI (combines deployment management and chat)
./start-unified-ui.sh
```

### 3. Access Application

- **Unified UI**: http://localhost:5175
  - **Dashboard**: http://localhost:5175/ (deployment management)
  - **Chat Interface**: http://localhost:5175/chat (AI chat)
- **CloudFront**: (URL provided after deployment)

### 4. User Registration & Login

- **Self-Registration**: Users can create accounts directly through the UI
- **Email Verification**: Required for new accounts
- **Password Requirements**: 8+ characters, uppercase, lowercase, numbers
- **Authentication**: Powered by Cognito Hosted UI

## 📊 Data Model

The single DynamoDB table uses composite keys to store different entity types:

### Primary Key Structure
- **PK (Partition Key)**: Entity identifier
- **SK (Sort Key)**: Sub-entity or timestamp

### Entity Types

#### User Messages
```
PK: USER#{userId}
SK: CONV#{conversationId}#{timestamp}
EntityType: Message
```

#### Deployments
```
PK: USER#{userId}  
SK: DEPLOYMENT#{deploymentId}
EntityType: Deployment
```

#### Model Configurations
```
PK: MODEL#{modelId}
SK: CONFIG#{configId}
EntityType: ModelConfig
```

### Global Secondary Indexes
- **GSI1**: Alternative access patterns
- **StatusIndex**: Query by entity type and status

## 🔧 Development

### Infrastructure Changes

```bash
cd infrastructure
npm run build
npm run diff    # Preview changes
npm run deploy  # Deploy changes
```

### UI Development

```bash
# Unified UI (includes both deployment management and chat)
cd ui-unified
npm install
npm start
```

### Adding New Features

1. **Backend**: Modify Lambda functions in the CDK stack
2. **Frontend**: Add components to the React applications
3. **API**: Update API Gateway routes and methods
4. **Data**: Extend the DynamoDB table schema

## 🛠️ Configuration

### Environment Variables
- `STACK_NAME`: CloudFormation stack name (default: GAIIFFGenAIBuilder)
- `AWS_REGION`: AWS region for deployment

### Runtime Configuration
The UIs load configuration from `/runtimeConfig.json`:

```json
{
  "ApiEndpoint": "https://api-id.execute-api.region.amazonaws.com/prod/",
  "UserPoolId": "region_poolId",
  "UserPoolClientId": "clientId",
  "AwsRegion": "us-east-1",
  "CognitoDomain": "domain.auth.region.amazoncognito.com"
}
```

## 🔐 Security

### Authentication
- Cognito User Pools with self-registration enabled
- Cognito Hosted UI for seamless sign-up/sign-in experience
- OAuth 2.0 with authorization code flow
- Email verification for new accounts
- JWT tokens for API authentication

### Authorization
- API Gateway with Cognito authorizer
- User-scoped data access
- IAM roles with least privilege

### Data Protection
- DynamoDB encryption at rest
- S3 bucket encryption
- HTTPS/TLS for all communications

## 📈 Monitoring

### CloudWatch Metrics
- Lambda function performance
- API Gateway request metrics
- DynamoDB read/write capacity
- Cognito authentication events

### Logging
- Lambda function logs
- API Gateway access logs
- CloudFront access logs

## 🧪 Testing

### Infrastructure Testing
```bash
cd infrastructure
npm test
```

### UI Testing
```bash
# Unified UI
cd ui-unified
npm test
```

## 🚨 Troubleshooting

### Common Issues

#### Deployment Fails
- Check AWS credentials and permissions
- Verify CDK bootstrap is complete
- Check for resource naming conflicts

#### UI Won't Load
- Verify `runtimeConfig.json` exists and is valid
- Check Cognito callback URLs include localhost
- Confirm API Gateway CORS settings

#### Authentication Issues
- Verify Cognito User Pool configuration
- Check callback/logout URLs
- Confirm user exists and is confirmed

#### Chat Not Working
- Check Lambda function logs in CloudWatch
- Verify DynamoDB permissions
- Test API endpoints directly

### Logs and Debugging

```bash
# View CloudFormation events
aws cloudformation describe-stack-events --stack-name GAIIFFGenAIBuilder

# View Lambda logs
aws logs tail /aws/lambda/GAIIFFGenAIBuilder-ChatLambda --follow

# Test API directly
curl -H "Authorization: Bearer $JWT_TOKEN" \
     https://api-id.execute-api.region.amazonaws.com/prod/chat
```

## 🧹 Cleanup

To remove all resources:

```bash
cd infrastructure
npm run destroy
```

This will delete the CloudFormation stack and all associated resources.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section
2. Review CloudWatch logs
3. Open an issue with detailed information

---

**Happy Building!** 🎯
