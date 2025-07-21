"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsolidatedStack = void 0;
const cdk = require("aws-cdk-lib");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const cognito = require("aws-cdk-lib/aws-cognito");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const s3 = require("aws-cdk-lib/aws-s3");
const ssm = require("aws-cdk-lib/aws-ssm");
/**
 * Consolidated Generative AI Application Builder Stack
 * This stack combines all functionality into a single CloudFormation template
 * with a single DynamoDB table for all data storage needs.
 */
class ConsolidatedStack extends cdk.Stack {
    constructor(scope, id, props = {}) {
        super(scope, id, props);
        // Create the single DynamoDB table for all data
        this.createMainTable();
        // Create S3 buckets
        this.createS3Resources();
        // Create Lambda functions
        this.createLambdaFunctions();
        // Create Cognito resources
        this.createCognitoResources(props.adminEmail);
        // Create API Gateway
        this.createApiGateway();
        // Create CloudFront distribution
        this.createCloudFrontDistribution();
        // Create SSM parameters
        this.createSSMParameters();
        // Create outputs
        this.createOutputs();
    }
    createMainTable() {
        this.mainTable = new dynamodb.Table(this, 'MainTable', {
            tableName: `${this.stackName}-MainTable`,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            partitionKey: {
                name: 'PK',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'SK',
                type: dynamodb.AttributeType.STRING
            },
            timeToLiveAttribute: 'TTL',
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        // Add Global Secondary Indexes for different access patterns
        this.mainTable.addGlobalSecondaryIndex({
            indexName: 'GSI1',
            partitionKey: {
                name: 'GSI1PK',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'GSI1SK',
                type: dynamodb.AttributeType.STRING
            }
        });
        this.mainTable.addGlobalSecondaryIndex({
            indexName: 'StatusIndex',
            partitionKey: {
                name: 'EntityType',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'Status',
                type: dynamodb.AttributeType.STRING
            }
        });
    }
    createS3Resources() {
        // Access logs bucket
        this.accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
            bucketName: `${this.stackName.toLowerCase()}-access-logs-${this.account}-${this.region}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true
        });
        // Web assets bucket
        this.webBucket = new s3.Bucket(this, 'WebBucket', {
            bucketName: `${this.stackName.toLowerCase()}-web-assets-${this.account}-${this.region}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            serverAccessLogsBucket: this.accessLogsBucket,
            serverAccessLogsPrefix: 'web-bucket-logs/'
        });
    }
    createLambdaFunctions() {
        // Common Lambda role
        const lambdaRole = new iam.Role(this, 'LambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ],
            inlinePolicies: {
                DynamoDBAccess: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'dynamodb:BatchGetItem',
                                'dynamodb:BatchWriteItem',
                                'dynamodb:ConditionCheckItem',
                                'dynamodb:DeleteItem',
                                'dynamodb:GetItem',
                                'dynamodb:PutItem',
                                'dynamodb:Query',
                                'dynamodb:Scan',
                                'dynamodb:UpdateItem'
                            ],
                            resources: [
                                this.mainTable.tableArn,
                                `${this.mainTable.tableArn}/index/*`
                            ]
                        })
                    ]
                }),
                BedrockAccess: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'bedrock:InvokeModel',
                                'bedrock:InvokeModelWithResponseStream',
                                'bedrock:ListFoundationModels',
                                'bedrock:GetFoundationModel'
                            ],
                            resources: ['*']
                        })
                    ]
                }),
                S3Access: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                's3:GetObject',
                                's3:PutObject',
                                's3:DeleteObject'
                            ],
                            resources: [`${this.webBucket.bucketArn}/*`]
                        })
                    ]
                })
            }
        });
        // Chat Lambda Function
        this.chatLambda = new lambda.Function(this, 'ChatLambda', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromInline(`
import json
import boto3
import os
from datetime import datetime
import uuid

dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client('bedrock-runtime')
table_name = os.environ['MAIN_TABLE_NAME']
table = dynamodb.Table(table_name)

def handler(event, context):
    try:
        # Parse the request
        body = json.loads(event.get('body', '{}'))
        user_id = event['requestContext']['authorizer']['claims']['sub']
        message = body.get('message', '')
        conversation_id = body.get('conversationId', str(uuid.uuid4()))
        
        # Store user message
        timestamp = datetime.utcnow().isoformat()
        table.put_item(
            Item={
                'PK': f'USER#{user_id}',
                'SK': f'CONV#{conversation_id}#{timestamp}',
                'EntityType': 'Message',
                'ConversationId': conversation_id,
                'Message': message,
                'Role': 'user',
                'Timestamp': timestamp
            }
        )
        
        # Simple response for now (can be enhanced with actual Bedrock integration)
        ai_response = f"I received your message: {message}. This is a simple echo response."
        
        # Store AI response
        ai_timestamp = datetime.utcnow().isoformat()
        table.put_item(
            Item={
                'PK': f'USER#{user_id}',
                'SK': f'CONV#{conversation_id}#{ai_timestamp}',
                'EntityType': 'Message',
                'ConversationId': conversation_id,
                'Message': ai_response,
                'Role': 'assistant',
                'Timestamp': ai_timestamp
            }
        )
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            'body': json.dumps({
                'conversationId': conversation_id,
                'response': ai_response,
                'timestamp': ai_timestamp
            })
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'error': str(e)})
        }
      `),
            role: lambdaRole,
            timeout: cdk.Duration.minutes(15),
            memorySize: 1024,
            environment: {
                MAIN_TABLE_NAME: this.mainTable.tableName
            }
        });
        // Deployment Management Lambda
        this.deploymentLambda = new lambda.Function(this, 'DeploymentLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.MAIN_TABLE_NAME;

exports.handler = async (event, context) => {
    try {
        const method = event.httpMethod;
        const userId = event.requestContext.authorizer.claims.sub;
        
        switch (method) {
            case 'GET':
                return await listDeployments(userId);
            case 'POST':
                return await createDeployment(userId, JSON.parse(event.body));
            case 'PUT':
                return await updateDeployment(userId, event.pathParameters.id, JSON.parse(event.body));
            case 'DELETE':
                return await deleteDeployment(userId, event.pathParameters.id);
            default:
                return {
                    statusCode: 405,
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({ error: 'Method not allowed' })
                };
        }
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message })
        };
    }
};

async function listDeployments(userId) {
    const params = {
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
            ':pk': \`USER#\${userId}\`,
            ':sk': 'DEPLOYMENT#'
        }
    };
    
    const result = await dynamodb.query(params).promise();
    
    return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ deployments: result.Items })
    };
}

async function createDeployment(userId, deployment) {
    const deploymentId = require('crypto').randomUUID();
    const timestamp = new Date().toISOString();
    
    const item = {
        PK: \`USER#\${userId}\`,
        SK: \`DEPLOYMENT#\${deploymentId}\`,
        EntityType: 'Deployment',
        DeploymentId: deploymentId,
        Name: deployment.name,
        Description: deployment.description,
        Status: 'CREATING',
        CreatedAt: timestamp,
        UpdatedAt: timestamp,
        ...deployment
    };
    
    await dynamodb.put({
        TableName: tableName,
        Item: item
    }).promise();
    
    return {
        statusCode: 201,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(item)
    };
}

async function updateDeployment(userId, deploymentId, updates) {
    const timestamp = new Date().toISOString();
    
    const params = {
        TableName: tableName,
        Key: {
            PK: \`USER#\${userId}\`,
            SK: \`DEPLOYMENT#\${deploymentId}\`
        },
        UpdateExpression: 'SET UpdatedAt = :timestamp',
        ExpressionAttributeValues: {
            ':timestamp': timestamp
        },
        ReturnValues: 'ALL_NEW'
    };
    
    // Add update expressions for each field
    Object.keys(updates).forEach(key => {
        if (key !== 'PK' && key !== 'SK') {
            params.UpdateExpression += \`, \${key} = :\${key}\`;
            params.ExpressionAttributeValues[\`:\${key}\`] = updates[key];
        }
    });
    
    const result = await dynamodb.update(params).promise();
    
    return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(result.Attributes)
    };
}

async function deleteDeployment(userId, deploymentId) {
    await dynamodb.delete({
        TableName: tableName,
        Key: {
            PK: \`USER#\${userId}\`,
            SK: \`DEPLOYMENT#\${deploymentId}\`
        }
    }).promise();
    
    return {
        statusCode: 204,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: ''
    };
}
      `),
            role: lambdaRole,
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                MAIN_TABLE_NAME: this.mainTable.tableName
            }
        });
        // Model Info Lambda
        this.modelInfoLambda = new lambda.Function(this, 'ModelInfoLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const bedrock = new AWS.Bedrock();

exports.handler = async (event, context) => {
    try {
        const models = await bedrock.listFoundationModels().promise();
        
        const supportedModels = models.modelSummaries
            .filter(model => model.modelId.includes('claude') || model.modelId.includes('titan'))
            .map(model => ({
                modelId: model.modelId,
                modelName: model.modelName,
                providerName: model.providerName,
                inputModalities: model.inputModalities,
                outputModalities: model.outputModalities
            }));
        
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ models: supportedModels })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message })
        };
    }
};
      `),
            role: lambdaRole,
            timeout: cdk.Duration.minutes(2),
            memorySize: 256,
            environment: {
                MAIN_TABLE_NAME: this.mainTable.tableName
            }
        });
    }
    createCognitoResources(adminEmail) {
        // User Pool with self-registration enabled
        this.userPool = new cognito.UserPool(this, 'UserPool', {
            userPoolName: `${this.stackName}-UserPool`,
            selfSignUpEnabled: true,
            signInAliases: {
                email: true
            },
            autoVerify: {
                email: true
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
                tempPasswordValidity: cdk.Duration.days(7)
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            // Email configuration for verification
            userVerification: {
                emailSubject: 'Welcome to Generative AI Application Builder - Verify your email',
                emailBody: 'Welcome to Generative AI Application Builder! Please click the link below to verify your email address: {##Verify Email##}',
                emailStyle: cognito.VerificationEmailStyle.LINK
            },
            // Standard attributes
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true
                },
                givenName: {
                    required: false,
                    mutable: true
                },
                familyName: {
                    required: false,
                    mutable: true
                }
            }
        });
        // User Pool Client with Hosted UI configuration
        this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
            userPool: this.userPool,
            generateSecret: false,
            authFlows: {
                adminUserPassword: true,
                custom: true,
                userPassword: true,
                userSrp: true
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                    implicitCodeGrant: true // Enable for hosted UI
                },
                scopes: [
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.PROFILE,
                    cognito.OAuthScope.COGNITO_ADMIN
                ],
                callbackUrls: [
                    'http://localhost:5173',
                    'http://localhost:5174'
                ],
                logoutUrls: [
                    'http://localhost:5173',
                    'http://localhost:5174'
                ]
            },
            refreshTokenValidity: cdk.Duration.days(3650),
            accessTokenValidity: cdk.Duration.hours(24),
            idTokenValidity: cdk.Duration.hours(24),
            // Enable Hosted UI features
            supportedIdentityProviders: [
                cognito.UserPoolClientIdentityProvider.COGNITO
            ]
        });
        // User Pool Domain
        this.userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
            userPool: this.userPool,
            cognitoDomain: {
                domainPrefix: `${this.stackName.toLowerCase()}-${cdk.Aws.ACCOUNT_ID}`
            }
        });
    }
    createApiGateway() {
        // REST API
        this.api = new apigateway.RestApi(this, 'Api', {
            restApiName: `${this.stackName}-API`,
            description: 'Consolidated Generative AI Application Builder API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'X-Amz-Security-Token'
                ]
            },
            deployOptions: {
                stageName: 'prod',
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
                metricsEnabled: true
            }
        });
        // Cognito Authorizer
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
            cognitoUserPools: [this.userPool],
            identitySource: 'method.request.header.Authorization'
        });
        // Chat endpoints
        const chatResource = this.api.root.addResource('chat');
        chatResource.addMethod('POST', new apigateway.LambdaIntegration(this.chatLambda), {
            authorizer: authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // Deployment endpoints
        const deploymentsResource = this.api.root.addResource('deployments');
        deploymentsResource.addMethod('GET', new apigateway.LambdaIntegration(this.deploymentLambda), {
            authorizer: authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        deploymentsResource.addMethod('POST', new apigateway.LambdaIntegration(this.deploymentLambda), {
            authorizer: authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        const deploymentResource = deploymentsResource.addResource('{id}');
        deploymentResource.addMethod('GET', new apigateway.LambdaIntegration(this.deploymentLambda), {
            authorizer: authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        deploymentResource.addMethod('PUT', new apigateway.LambdaIntegration(this.deploymentLambda), {
            authorizer: authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        deploymentResource.addMethod('DELETE', new apigateway.LambdaIntegration(this.deploymentLambda), {
            authorizer: authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // Model info endpoints
        const modelsResource = this.api.root.addResource('models');
        modelsResource.addMethod('GET', new apigateway.LambdaIntegration(this.modelInfoLambda), {
            authorizer: authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
    }
    createCloudFrontDistribution() {
        // Origin Access Identity for S3
        const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
            comment: `OAI for ${this.stackName}`
        });
        // Grant CloudFront access to S3 bucket
        this.webBucket.grantRead(oai);
        // CloudFront Distribution
        this.distribution = new cloudfront.Distribution(this, 'Distribution', {
            defaultBehavior: {
                origin: new origins.S3Origin(this.webBucket, {
                    originAccessIdentity: oai
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                compress: true
            },
            additionalBehaviors: {
                '/prod/*': {
                    origin: new origins.RestApiOrigin(this.api),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER
                }
            },
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html'
                }
            ],
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            enabled: true,
            comment: `${this.stackName} CloudFront Distribution`
        });
    }
    createSSMParameters() {
        // Web configuration parameter
        const webConfig = {
            ApiEndpoint: this.api.url,
            IsInternalUser: 'false',
            CognitoRedirectUrl: `https://${this.distribution.distributionDomainName}`,
            UserPoolId: this.userPool.userPoolId,
            UserPoolClientId: this.userPoolClient.userPoolClientId,
            AwsRegion: this.region,
            CognitoDomain: `${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`
        };
        new ssm.StringParameter(this, 'WebConfigParameter', {
            parameterName: `/gaab-webconfig/${this.stackName}`,
            stringValue: JSON.stringify(webConfig),
            description: 'Web configuration for the Generative AI Application Builder',
            type: ssm.ParameterType.STRING
        });
    }
    createOutputs() {
        new cdk.CfnOutput(this, 'CloudFrontWebUrl', {
            value: `https://${this.distribution.distributionDomainName}`,
            description: 'CloudFront Distribution URL'
        });
        new cdk.CfnOutput(this, 'RestEndpointUrl', {
            value: this.api.url,
            description: 'REST API Endpoint URL'
        });
        new cdk.CfnOutput(this, 'CognitoClientId', {
            value: this.userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID'
        });
        new cdk.CfnOutput(this, 'MainTableName', {
            value: this.mainTable.tableName,
            description: 'Main DynamoDB Table Name'
        });
        new cdk.CfnOutput(this, 'WebConfigKey', {
            value: `/gaab-webconfig/${this.stackName}`,
            description: 'SSM Parameter key for web configuration'
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId,
            description: 'Cognito User Pool ID'
        });
        new cdk.CfnOutput(this, 'CognitoDomain', {
            value: `${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
            description: 'Cognito Domain'
        });
    }
}
exports.ConsolidatedStack = ConsolidatedStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc29saWRhdGVkLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29uc29saWRhdGVkLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyx5REFBeUQ7QUFDekQseURBQXlEO0FBQ3pELDhEQUE4RDtBQUM5RCxtREFBbUQ7QUFDbkQscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQseUNBQXlDO0FBRXpDLDJDQUEyQztBQVEzQzs7OztHQUlHO0FBQ0gsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQWtCOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxRQUFnQyxFQUFFO1FBQzFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLGdEQUFnRDtRQUNoRCxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFFdkIsb0JBQW9CO1FBQ3BCLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBRXpCLDBCQUEwQjtRQUMxQixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUU3QiwyQkFBMkI7UUFDM0IsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUU5QyxxQkFBcUI7UUFDckIsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFFeEIsaUNBQWlDO1FBQ2pDLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO1FBRXBDLHdCQUF3QjtRQUN4QixJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUUzQixpQkFBaUI7UUFDakIsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ3ZCLENBQUM7SUFFTyxlQUFlO1FBQ3JCLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDckQsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsWUFBWTtZQUN4QyxVQUFVLEVBQUUsUUFBUSxDQUFDLGVBQWUsQ0FBQyxXQUFXO1lBQ2hELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJO2dCQUNWLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxFQUFFLElBQUk7Z0JBQ1YsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELG1CQUFtQixFQUFFLEtBQUs7WUFDMUIsbUJBQW1CLEVBQUUsSUFBSTtZQUN6QixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILDZEQUE2RDtRQUM3RCxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQ3JDLFNBQVMsRUFBRSxNQUFNO1lBQ2pCLFlBQVksRUFBRTtnQkFDWixJQUFJLEVBQUUsUUFBUTtnQkFDZCxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsT0FBTyxFQUFFO2dCQUNQLElBQUksRUFBRSxRQUFRO2dCQUNkLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7U0FDRixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQ3JDLFNBQVMsRUFBRSxhQUFhO1lBQ3hCLFlBQVksRUFBRTtnQkFDWixJQUFJLEVBQUUsWUFBWTtnQkFDbEIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELE9BQU8sRUFBRTtnQkFDUCxJQUFJLEVBQUUsUUFBUTtnQkFDZCxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLGlCQUFpQjtRQUN2QixxQkFBcUI7UUFDckIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDOUQsVUFBVSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsZ0JBQWdCLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUN4RixVQUFVLEVBQUUsRUFBRSxDQUFDLGdCQUFnQixDQUFDLFVBQVU7WUFDMUMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDakQsVUFBVSxFQUFFLElBQUk7WUFDaEIsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxpQkFBaUIsRUFBRSxJQUFJO1NBQ3hCLENBQUMsQ0FBQztRQUVILG9CQUFvQjtRQUNwQixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ2hELFVBQVUsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLGVBQWUsSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ3ZGLFVBQVUsRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsVUFBVTtZQUMxQyxpQkFBaUIsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsU0FBUztZQUNqRCxVQUFVLEVBQUUsSUFBSTtZQUNoQixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsc0JBQXNCLEVBQUUsSUFBSSxDQUFDLGdCQUFnQjtZQUM3QyxzQkFBc0IsRUFBRSxrQkFBa0I7U0FDM0MsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLHFCQUFxQjtRQUMzQixxQkFBcUI7UUFDckIsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDbEQsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO1lBQzNELGVBQWUsRUFBRTtnQkFDZixHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDBDQUEwQyxDQUFDO2FBQ3ZGO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLGNBQWMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUM7b0JBQ3JDLFVBQVUsRUFBRTt3QkFDVixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7NEJBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7NEJBQ3hCLE9BQU8sRUFBRTtnQ0FDUCx1QkFBdUI7Z0NBQ3ZCLHlCQUF5QjtnQ0FDekIsNkJBQTZCO2dDQUM3QixxQkFBcUI7Z0NBQ3JCLGtCQUFrQjtnQ0FDbEIsa0JBQWtCO2dDQUNsQixnQkFBZ0I7Z0NBQ2hCLGVBQWU7Z0NBQ2YscUJBQXFCOzZCQUN0Qjs0QkFDRCxTQUFTLEVBQUU7Z0NBQ1QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRO2dDQUN2QixHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxVQUFVOzZCQUNyQzt5QkFDRixDQUFDO3FCQUNIO2lCQUNGLENBQUM7Z0JBQ0YsYUFBYSxFQUFFLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQztvQkFDcEMsVUFBVSxFQUFFO3dCQUNWLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQzs0QkFDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSzs0QkFDeEIsT0FBTyxFQUFFO2dDQUNQLHFCQUFxQjtnQ0FDckIsdUNBQXVDO2dDQUN2Qyw4QkFBOEI7Z0NBQzlCLDRCQUE0Qjs2QkFDN0I7NEJBQ0QsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO3lCQUNqQixDQUFDO3FCQUNIO2lCQUNGLENBQUM7Z0JBQ0YsUUFBUSxFQUFFLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQztvQkFDL0IsVUFBVSxFQUFFO3dCQUNWLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQzs0QkFDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSzs0QkFDeEIsT0FBTyxFQUFFO2dDQUNQLGNBQWM7Z0NBQ2QsY0FBYztnQ0FDZCxpQkFBaUI7NkJBQ2xCOzRCQUNELFNBQVMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLElBQUksQ0FBQzt5QkFDN0MsQ0FBQztxQkFDSDtpQkFDRixDQUFDO2FBQ0g7U0FDRixDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN4RCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxlQUFlO1lBQ3hCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQTRFNUIsQ0FBQztZQUNGLElBQUksRUFBRSxVQUFVO1lBQ2hCLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDakMsVUFBVSxFQUFFLElBQUk7WUFDaEIsV0FBVyxFQUFFO2dCQUNYLGVBQWUsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVM7YUFDMUM7U0FDRixDQUFDLENBQUM7UUFFSCwrQkFBK0I7UUFDL0IsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDcEUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsZUFBZTtZQUN4QixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQW9JNUIsQ0FBQztZQUNGLElBQUksRUFBRSxVQUFVO1lBQ2hCLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDaEMsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUU7Z0JBQ1gsZUFBZSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUzthQUMxQztTQUNGLENBQUMsQ0FBQztRQUVILG9CQUFvQjtRQUNwQixJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDbEUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsZUFBZTtZQUN4QixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09BZ0M1QixDQUFDO1lBQ0YsSUFBSSxFQUFFLFVBQVU7WUFDaEIsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUNoQyxVQUFVLEVBQUUsR0FBRztZQUNmLFdBQVcsRUFBRTtnQkFDWCxlQUFlLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTO2FBQzFDO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLHNCQUFzQixDQUFDLFVBQW1CO1FBQ2hELDJDQUEyQztRQUMzQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQ3JELFlBQVksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLFdBQVc7WUFDMUMsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixhQUFhLEVBQUU7Z0JBQ2IsS0FBSyxFQUFFLElBQUk7YUFDWjtZQUNELFVBQVUsRUFBRTtnQkFDVixLQUFLLEVBQUUsSUFBSTthQUNaO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLFNBQVMsRUFBRSxDQUFDO2dCQUNaLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGFBQWEsRUFBRSxJQUFJO2dCQUNuQixjQUFjLEVBQUUsS0FBSztnQkFDckIsb0JBQW9CLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO2FBQzNDO1lBQ0QsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVTtZQUNuRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLHVDQUF1QztZQUN2QyxnQkFBZ0IsRUFBRTtnQkFDaEIsWUFBWSxFQUFFLGtFQUFrRTtnQkFDaEYsU0FBUyxFQUFFLDRIQUE0SDtnQkFDdkksVUFBVSxFQUFFLE9BQU8sQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJO2FBQ2hEO1lBQ0Qsc0JBQXNCO1lBQ3RCLGtCQUFrQixFQUFFO2dCQUNsQixLQUFLLEVBQUU7b0JBQ0wsUUFBUSxFQUFFLElBQUk7b0JBQ2QsT0FBTyxFQUFFLElBQUk7aUJBQ2Q7Z0JBQ0QsU0FBUyxFQUFFO29CQUNULFFBQVEsRUFBRSxLQUFLO29CQUNmLE9BQU8sRUFBRSxJQUFJO2lCQUNkO2dCQUNELFVBQVUsRUFBRTtvQkFDVixRQUFRLEVBQUUsS0FBSztvQkFDZixPQUFPLEVBQUUsSUFBSTtpQkFDZDthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsZ0RBQWdEO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxPQUFPLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN2RSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVE7WUFDdkIsY0FBYyxFQUFFLEtBQUs7WUFDckIsU0FBUyxFQUFFO2dCQUNULGlCQUFpQixFQUFFLElBQUk7Z0JBQ3ZCLE1BQU0sRUFBRSxJQUFJO2dCQUNaLFlBQVksRUFBRSxJQUFJO2dCQUNsQixPQUFPLEVBQUUsSUFBSTthQUNkO1lBQ0QsS0FBSyxFQUFFO2dCQUNMLEtBQUssRUFBRTtvQkFDTCxzQkFBc0IsRUFBRSxJQUFJO29CQUM1QixpQkFBaUIsRUFBRSxJQUFJLENBQUMsdUJBQXVCO2lCQUNoRDtnQkFDRCxNQUFNLEVBQUU7b0JBQ04sT0FBTyxDQUFDLFVBQVUsQ0FBQyxLQUFLO29CQUN4QixPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ3pCLE9BQU8sQ0FBQyxVQUFVLENBQUMsT0FBTztvQkFDMUIsT0FBTyxDQUFDLFVBQVUsQ0FBQyxhQUFhO2lCQUNqQztnQkFDRCxZQUFZLEVBQUU7b0JBQ1osdUJBQXVCO29CQUN2Qix1QkFBdUI7aUJBQ3hCO2dCQUNELFVBQVUsRUFBRTtvQkFDVix1QkFBdUI7b0JBQ3ZCLHVCQUF1QjtpQkFDeEI7YUFDRjtZQUNELG9CQUFvQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztZQUM3QyxtQkFBbUIsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDM0MsZUFBZSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN2Qyw0QkFBNEI7WUFDNUIsMEJBQTBCLEVBQUU7Z0JBQzFCLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQyxPQUFPO2FBQy9DO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsbUJBQW1CO1FBQ25CLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxPQUFPLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN2RSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVE7WUFDdkIsYUFBYSxFQUFFO2dCQUNiLFlBQVksRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUU7YUFDdEU7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU8sZ0JBQWdCO1FBQ3RCLFdBQVc7UUFDWCxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQzdDLFdBQVcsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLE1BQU07WUFDcEMsV0FBVyxFQUFFLG9EQUFvRDtZQUNqRSwyQkFBMkIsRUFBRTtnQkFDM0IsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFO29CQUNaLGNBQWM7b0JBQ2QsWUFBWTtvQkFDWixlQUFlO29CQUNmLFdBQVc7b0JBQ1gsc0JBQXNCO2lCQUN2QjthQUNGO1lBQ0QsYUFBYSxFQUFFO2dCQUNiLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixZQUFZLEVBQUUsVUFBVSxDQUFDLGtCQUFrQixDQUFDLElBQUk7Z0JBQ2hELGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGNBQWMsRUFBRSxJQUFJO2FBQ3JCO1NBQ0YsQ0FBQyxDQUFDO1FBRUgscUJBQXFCO1FBQ3JCLE1BQU0sVUFBVSxHQUFHLElBQUksVUFBVSxDQUFDLDBCQUEwQixDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDbEYsZ0JBQWdCLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO1lBQ2pDLGNBQWMsRUFBRSxxQ0FBcUM7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsaUJBQWlCO1FBQ2pCLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN2RCxZQUFZLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7WUFDaEYsVUFBVSxFQUFFLFVBQVU7WUFDdEIsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87U0FDeEQsQ0FBQyxDQUFDO1FBRUgsdUJBQXVCO1FBQ3ZCLE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ3JFLG1CQUFtQixDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxVQUFVLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUU7WUFDNUYsVUFBVSxFQUFFLFVBQVU7WUFDdEIsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87U0FDeEQsQ0FBQyxDQUFDO1FBQ0gsbUJBQW1CLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRTtZQUM3RixVQUFVLEVBQUUsVUFBVTtZQUN0QixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUFDLENBQUM7UUFFSCxNQUFNLGtCQUFrQixHQUFHLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNuRSxrQkFBa0IsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFO1lBQzNGLFVBQVUsRUFBRSxVQUFVO1lBQ3RCLGlCQUFpQixFQUFFLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPO1NBQ3hELENBQUMsQ0FBQztRQUNILGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxVQUFVLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUU7WUFDM0YsVUFBVSxFQUFFLFVBQVU7WUFDdEIsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87U0FDeEQsQ0FBQyxDQUFDO1FBQ0gsa0JBQWtCLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRTtZQUM5RixVQUFVLEVBQUUsVUFBVTtZQUN0QixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzNELGNBQWMsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBRTtZQUN0RixVQUFVLEVBQUUsVUFBVTtZQUN0QixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU8sNEJBQTRCO1FBQ2xDLGdDQUFnQztRQUNoQyxNQUFNLEdBQUcsR0FBRyxJQUFJLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQzNELE9BQU8sRUFBRSxXQUFXLElBQUksQ0FBQyxTQUFTLEVBQUU7U0FDckMsQ0FBQyxDQUFDO1FBRUgsdUNBQXVDO1FBQ3ZDLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBRTlCLDBCQUEwQjtRQUMxQixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksVUFBVSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3BFLGVBQWUsRUFBRTtnQkFDZixNQUFNLEVBQUUsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7b0JBQzNDLG9CQUFvQixFQUFFLEdBQUc7aUJBQzFCLENBQUM7Z0JBQ0Ysb0JBQW9CLEVBQUUsVUFBVSxDQUFDLG9CQUFvQixDQUFDLGlCQUFpQjtnQkFDdkUsY0FBYyxFQUFFLFVBQVUsQ0FBQyxjQUFjLENBQUMsY0FBYztnQkFDeEQsYUFBYSxFQUFFLFVBQVUsQ0FBQyxhQUFhLENBQUMsY0FBYztnQkFDdEQsUUFBUSxFQUFFLElBQUk7YUFDZjtZQUNELG1CQUFtQixFQUFFO2dCQUNuQixTQUFTLEVBQUU7b0JBQ1QsTUFBTSxFQUFFLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDO29CQUMzQyxvQkFBb0IsRUFBRSxVQUFVLENBQUMsb0JBQW9CLENBQUMsaUJBQWlCO29CQUN2RSxjQUFjLEVBQUUsVUFBVSxDQUFDLGNBQWMsQ0FBQyxTQUFTO29CQUNuRCxhQUFhLEVBQUUsVUFBVSxDQUFDLGFBQWEsQ0FBQyxjQUFjO29CQUN0RCxXQUFXLEVBQUUsVUFBVSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0I7b0JBQ3BELG1CQUFtQixFQUFFLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxVQUFVO2lCQUMvRDthQUNGO1lBQ0QsaUJBQWlCLEVBQUUsWUFBWTtZQUMvQixjQUFjLEVBQUU7Z0JBQ2Q7b0JBQ0UsVUFBVSxFQUFFLEdBQUc7b0JBQ2Ysa0JBQWtCLEVBQUUsR0FBRztvQkFDdkIsZ0JBQWdCLEVBQUUsYUFBYTtpQkFDaEM7YUFDRjtZQUNELFVBQVUsRUFBRSxVQUFVLENBQUMsVUFBVSxDQUFDLGVBQWU7WUFDakQsT0FBTyxFQUFFLElBQUk7WUFDYixPQUFPLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUywwQkFBMEI7U0FDckQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLG1CQUFtQjtRQUN6Qiw4QkFBOEI7UUFDOUIsTUFBTSxTQUFTLEdBQUc7WUFDaEIsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRztZQUN6QixjQUFjLEVBQUUsT0FBTztZQUN2QixrQkFBa0IsRUFBRSxXQUFXLElBQUksQ0FBQyxZQUFZLENBQUMsc0JBQXNCLEVBQUU7WUFDekUsVUFBVSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVTtZQUNwQyxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLGdCQUFnQjtZQUN0RCxTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDdEIsYUFBYSxFQUFFLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxVQUFVLFNBQVMsSUFBSSxDQUFDLE1BQU0sb0JBQW9CO1NBQ3pGLENBQUM7UUFFRixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQ2xELGFBQWEsRUFBRSxtQkFBbUIsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUNsRCxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUM7WUFDdEMsV0FBVyxFQUFFLDZEQUE2RDtZQUMxRSxJQUFJLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO1NBQy9CLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxhQUFhO1FBQ25CLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLFdBQVcsSUFBSSxDQUFDLFlBQVksQ0FBQyxzQkFBc0IsRUFBRTtZQUM1RCxXQUFXLEVBQUUsNkJBQTZCO1NBQzNDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRztZQUNuQixXQUFXLEVBQUUsdUJBQXVCO1NBQ3JDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCO1lBQzNDLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUztZQUMvQixXQUFXLEVBQUUsMEJBQTBCO1NBQ3hDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxtQkFBbUIsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUMxQyxXQUFXLEVBQUUseUNBQXlDO1NBQ3ZELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3BDLEtBQUssRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVU7WUFDL0IsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN2QyxLQUFLLEVBQUUsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLFVBQVUsU0FBUyxJQUFJLENBQUMsTUFBTSxvQkFBb0I7WUFDaEYsV0FBVyxFQUFFLGdCQUFnQjtTQUM5QixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE1c0JELDhDQTRzQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29uc29saWRhdGVkU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgYWRtaW5FbWFpbD86IHN0cmluZztcbiAgYWxsb3dlZE9yaWdpbnM/OiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBDb25zb2xpZGF0ZWQgR2VuZXJhdGl2ZSBBSSBBcHBsaWNhdGlvbiBCdWlsZGVyIFN0YWNrXG4gKiBUaGlzIHN0YWNrIGNvbWJpbmVzIGFsbCBmdW5jdGlvbmFsaXR5IGludG8gYSBzaW5nbGUgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGVcbiAqIHdpdGggYSBzaW5nbGUgRHluYW1vREIgdGFibGUgZm9yIGFsbCBkYXRhIHN0b3JhZ2UgbmVlZHMuXG4gKi9cbmV4cG9ydCBjbGFzcyBDb25zb2xpZGF0ZWRTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8vIENvcmUgSW5mcmFzdHJ1Y3R1cmVcbiAgcHVibGljIG1haW5UYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyB3ZWJCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIGFjY2Vzc0xvZ3NCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIGRpc3RyaWJ1dGlvbjogY2xvdWRmcm9udC5EaXN0cmlidXRpb247XG4gIFxuICAvLyBBdXRoZW50aWNhdGlvblxuICBwdWJsaWMgdXNlclBvb2w6IGNvZ25pdG8uVXNlclBvb2w7XG4gIHB1YmxpYyB1c2VyUG9vbENsaWVudDogY29nbml0by5Vc2VyUG9vbENsaWVudDtcbiAgcHVibGljIHVzZXJQb29sRG9tYWluOiBjb2duaXRvLlVzZXJQb29sRG9tYWluO1xuICBcbiAgLy8gQVBJIGFuZCBMYW1iZGFcbiAgcHVibGljIGFwaTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuICBwdWJsaWMgY2hhdExhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgZGVwbG95bWVudExhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgbW9kZWxJbmZvTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENvbnNvbGlkYXRlZFN0YWNrUHJvcHMgPSB7fSkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSBzaW5nbGUgRHluYW1vREIgdGFibGUgZm9yIGFsbCBkYXRhXG4gICAgdGhpcy5jcmVhdGVNYWluVGFibGUoKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgUzMgYnVja2V0c1xuICAgIHRoaXMuY3JlYXRlUzNSZXNvdXJjZXMoKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgTGFtYmRhIGZ1bmN0aW9uc1xuICAgIHRoaXMuY3JlYXRlTGFtYmRhRnVuY3Rpb25zKCk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIENvZ25pdG8gcmVzb3VyY2VzXG4gICAgdGhpcy5jcmVhdGVDb2duaXRvUmVzb3VyY2VzKHByb3BzLmFkbWluRW1haWwpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBBUEkgR2F0ZXdheVxuICAgIHRoaXMuY3JlYXRlQXBpR2F0ZXdheSgpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvblxuICAgIHRoaXMuY3JlYXRlQ2xvdWRGcm9udERpc3RyaWJ1dGlvbigpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBTU00gcGFyYW1ldGVyc1xuICAgIHRoaXMuY3JlYXRlU1NNUGFyYW1ldGVycygpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBvdXRwdXRzXG4gICAgdGhpcy5jcmVhdGVPdXRwdXRzKCk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZU1haW5UYWJsZSgpOiB2b2lkIHtcbiAgICB0aGlzLm1haW5UYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnTWFpblRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tTWFpblRhYmxlYCxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ1BLJywgLy8gUGFydGl0aW9uIEtleVxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklOR1xuICAgICAgfSxcbiAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgbmFtZTogJ1NLJywgLy8gU29ydCBLZXlcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgIH0sXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAnVFRMJyxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgR2xvYmFsIFNlY29uZGFyeSBJbmRleGVzIGZvciBkaWZmZXJlbnQgYWNjZXNzIHBhdHRlcm5zXG4gICAgdGhpcy5tYWluVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnR1NJMScsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ0dTSTFQSycsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAnR1NJMVNLJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMubWFpblRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ1N0YXR1c0luZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAnRW50aXR5VHlwZScsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAnU3RhdHVzJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlUzNSZXNvdXJjZXMoKTogdm9pZCB7XG4gICAgLy8gQWNjZXNzIGxvZ3MgYnVja2V0XG4gICAgdGhpcy5hY2Nlc3NMb2dzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQWNjZXNzTG9nc0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lLnRvTG93ZXJDYXNlKCl9LWFjY2Vzcy1sb2dzLSR7dGhpcy5hY2NvdW50fS0ke3RoaXMucmVnaW9ufWAsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZVxuICAgIH0pO1xuXG4gICAgLy8gV2ViIGFzc2V0cyBidWNrZXRcbiAgICB0aGlzLndlYkJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1dlYkJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lLnRvTG93ZXJDYXNlKCl9LXdlYi1hc3NldHMtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgc2VydmVyQWNjZXNzTG9nc0J1Y2tldDogdGhpcy5hY2Nlc3NMb2dzQnVja2V0LFxuICAgICAgc2VydmVyQWNjZXNzTG9nc1ByZWZpeDogJ3dlYi1idWNrZXQtbG9ncy8nXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxhbWJkYUZ1bmN0aW9ucygpOiB2b2lkIHtcbiAgICAvLyBDb21tb24gTGFtYmRhIHJvbGVcbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcbiAgICAgIF0sXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICBEeW5hbW9EQkFjY2VzczogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6QmF0Y2hHZXRJdGVtJyxcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6QmF0Y2hXcml0ZUl0ZW0nLFxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpDb25kaXRpb25DaGVja0l0ZW0nLFxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpEZWxldGVJdGVtJyxcbiAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXG4gICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlNjYW4nLFxuICAgICAgICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJ1xuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICB0aGlzLm1haW5UYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICBgJHt0aGlzLm1haW5UYWJsZS50YWJsZUFybn0vaW5kZXgvKmBcbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICBdXG4gICAgICAgIH0pLFxuICAgICAgICBCZWRyb2NrQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbScsXG4gICAgICAgICAgICAgICAgJ2JlZHJvY2s6TGlzdEZvdW5kYXRpb25Nb2RlbHMnLFxuICAgICAgICAgICAgICAgICdiZWRyb2NrOkdldEZvdW5kYXRpb25Nb2RlbCdcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICBdXG4gICAgICAgIH0pLFxuICAgICAgICBTM0FjY2VzczogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICAnczM6RGVsZXRlT2JqZWN0J1xuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtgJHt0aGlzLndlYkJ1Y2tldC5idWNrZXRBcm59LypgXVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICBdXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBDaGF0IExhbWJkYSBGdW5jdGlvblxuICAgIHRoaXMuY2hhdExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NoYXRMYW1iZGEnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuaW1wb3J0IGpzb25cbmltcG9ydCBib3RvM1xuaW1wb3J0IG9zXG5mcm9tIGRhdGV0aW1lIGltcG9ydCBkYXRldGltZVxuaW1wb3J0IHV1aWRcblxuZHluYW1vZGIgPSBib3RvMy5yZXNvdXJjZSgnZHluYW1vZGInKVxuYmVkcm9jayA9IGJvdG8zLmNsaWVudCgnYmVkcm9jay1ydW50aW1lJylcbnRhYmxlX25hbWUgPSBvcy5lbnZpcm9uWydNQUlOX1RBQkxFX05BTUUnXVxudGFibGUgPSBkeW5hbW9kYi5UYWJsZSh0YWJsZV9uYW1lKVxuXG5kZWYgaGFuZGxlcihldmVudCwgY29udGV4dCk6XG4gICAgdHJ5OlxuICAgICAgICAjIFBhcnNlIHRoZSByZXF1ZXN0XG4gICAgICAgIGJvZHkgPSBqc29uLmxvYWRzKGV2ZW50LmdldCgnYm9keScsICd7fScpKVxuICAgICAgICB1c2VyX2lkID0gZXZlbnRbJ3JlcXVlc3RDb250ZXh0J11bJ2F1dGhvcml6ZXInXVsnY2xhaW1zJ11bJ3N1YiddXG4gICAgICAgIG1lc3NhZ2UgPSBib2R5LmdldCgnbWVzc2FnZScsICcnKVxuICAgICAgICBjb252ZXJzYXRpb25faWQgPSBib2R5LmdldCgnY29udmVyc2F0aW9uSWQnLCBzdHIodXVpZC51dWlkNCgpKSlcbiAgICAgICAgXG4gICAgICAgICMgU3RvcmUgdXNlciBtZXNzYWdlXG4gICAgICAgIHRpbWVzdGFtcCA9IGRhdGV0aW1lLnV0Y25vdygpLmlzb2Zvcm1hdCgpXG4gICAgICAgIHRhYmxlLnB1dF9pdGVtKFxuICAgICAgICAgICAgSXRlbT17XG4gICAgICAgICAgICAgICAgJ1BLJzogZidVU0VSI3t1c2VyX2lkfScsXG4gICAgICAgICAgICAgICAgJ1NLJzogZidDT05WI3tjb252ZXJzYXRpb25faWR9I3t0aW1lc3RhbXB9JyxcbiAgICAgICAgICAgICAgICAnRW50aXR5VHlwZSc6ICdNZXNzYWdlJyxcbiAgICAgICAgICAgICAgICAnQ29udmVyc2F0aW9uSWQnOiBjb252ZXJzYXRpb25faWQsXG4gICAgICAgICAgICAgICAgJ01lc3NhZ2UnOiBtZXNzYWdlLFxuICAgICAgICAgICAgICAgICdSb2xlJzogJ3VzZXInLFxuICAgICAgICAgICAgICAgICdUaW1lc3RhbXAnOiB0aW1lc3RhbXBcbiAgICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgICBcbiAgICAgICAgIyBTaW1wbGUgcmVzcG9uc2UgZm9yIG5vdyAoY2FuIGJlIGVuaGFuY2VkIHdpdGggYWN0dWFsIEJlZHJvY2sgaW50ZWdyYXRpb24pXG4gICAgICAgIGFpX3Jlc3BvbnNlID0gZlwiSSByZWNlaXZlZCB5b3VyIG1lc3NhZ2U6IHttZXNzYWdlfS4gVGhpcyBpcyBhIHNpbXBsZSBlY2hvIHJlc3BvbnNlLlwiXG4gICAgICAgIFxuICAgICAgICAjIFN0b3JlIEFJIHJlc3BvbnNlXG4gICAgICAgIGFpX3RpbWVzdGFtcCA9IGRhdGV0aW1lLnV0Y25vdygpLmlzb2Zvcm1hdCgpXG4gICAgICAgIHRhYmxlLnB1dF9pdGVtKFxuICAgICAgICAgICAgSXRlbT17XG4gICAgICAgICAgICAgICAgJ1BLJzogZidVU0VSI3t1c2VyX2lkfScsXG4gICAgICAgICAgICAgICAgJ1NLJzogZidDT05WI3tjb252ZXJzYXRpb25faWR9I3thaV90aW1lc3RhbXB9JyxcbiAgICAgICAgICAgICAgICAnRW50aXR5VHlwZSc6ICdNZXNzYWdlJyxcbiAgICAgICAgICAgICAgICAnQ29udmVyc2F0aW9uSWQnOiBjb252ZXJzYXRpb25faWQsXG4gICAgICAgICAgICAgICAgJ01lc3NhZ2UnOiBhaV9yZXNwb25zZSxcbiAgICAgICAgICAgICAgICAnUm9sZSc6ICdhc3Npc3RhbnQnLFxuICAgICAgICAgICAgICAgICdUaW1lc3RhbXAnOiBhaV90aW1lc3RhbXBcbiAgICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICdzdGF0dXNDb2RlJzogMjAwLFxuICAgICAgICAgICAgJ2hlYWRlcnMnOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxYLUFtei1EYXRlLEF1dGhvcml6YXRpb24sWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuJyxcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdPUFRJT05TLFBPU1QsR0VUJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdib2R5JzoganNvbi5kdW1wcyh7XG4gICAgICAgICAgICAgICAgJ2NvbnZlcnNhdGlvbklkJzogY29udmVyc2F0aW9uX2lkLFxuICAgICAgICAgICAgICAgICdyZXNwb25zZSc6IGFpX3Jlc3BvbnNlLFxuICAgICAgICAgICAgICAgICd0aW1lc3RhbXAnOiBhaV90aW1lc3RhbXBcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOlxuICAgICAgICBwcmludChmXCJFcnJvcjoge3N0cihlKX1cIilcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICdzdGF0dXNDb2RlJzogNTAwLFxuICAgICAgICAgICAgJ2hlYWRlcnMnOiB7XG4gICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgJ2JvZHknOiBqc29uLmR1bXBzKHsnZXJyb3InOiBzdHIoZSl9KVxuICAgICAgICB9XG4gICAgICBgKSxcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTUFJTl9UQUJMRV9OQU1FOiB0aGlzLm1haW5UYWJsZS50YWJsZU5hbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIERlcGxveW1lbnQgTWFuYWdlbWVudCBMYW1iZGFcbiAgICB0aGlzLmRlcGxveW1lbnRMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdEZXBsb3ltZW50TGFtYmRhJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcbmNvbnN0IEFXUyA9IHJlcXVpcmUoJ2F3cy1zZGsnKTtcbmNvbnN0IGR5bmFtb2RiID0gbmV3IEFXUy5EeW5hbW9EQi5Eb2N1bWVudENsaWVudCgpO1xuY29uc3QgdGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuTUFJTl9UQUJMRV9OQU1FO1xuXG5leHBvcnRzLmhhbmRsZXIgPSBhc3luYyAoZXZlbnQsIGNvbnRleHQpID0+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBtZXRob2QgPSBldmVudC5odHRwTWV0aG9kO1xuICAgICAgICBjb25zdCB1c2VySWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5hdXRob3JpemVyLmNsYWltcy5zdWI7XG4gICAgICAgIFxuICAgICAgICBzd2l0Y2ggKG1ldGhvZCkge1xuICAgICAgICAgICAgY2FzZSAnR0VUJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgbGlzdERlcGxveW1lbnRzKHVzZXJJZCk7XG4gICAgICAgICAgICBjYXNlICdQT1NUJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgY3JlYXRlRGVwbG95bWVudCh1c2VySWQsIEpTT04ucGFyc2UoZXZlbnQuYm9keSkpO1xuICAgICAgICAgICAgY2FzZSAnUFVUJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdXBkYXRlRGVwbG95bWVudCh1c2VySWQsIGV2ZW50LnBhdGhQYXJhbWV0ZXJzLmlkLCBKU09OLnBhcnNlKGV2ZW50LmJvZHkpKTtcbiAgICAgICAgICAgIGNhc2UgJ0RFTEVURSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGRlbGV0ZURlcGxveW1lbnQodXNlcklkLCBldmVudC5wYXRoUGFyYW1ldGVycy5pZCk7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwNSxcbiAgICAgICAgICAgICAgICAgICAgaGVhZGVyczogeyAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonIH0sXG4gICAgICAgICAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdNZXRob2Qgbm90IGFsbG93ZWQnIH0pXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyB9LFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogZXJyb3IubWVzc2FnZSB9KVxuICAgICAgICB9O1xuICAgIH1cbn07XG5cbmFzeW5jIGZ1bmN0aW9uIGxpc3REZXBsb3ltZW50cyh1c2VySWQpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB7XG4gICAgICAgIFRhYmxlTmFtZTogdGFibGVOYW1lLFxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnUEsgPSA6cGsgQU5EIGJlZ2luc193aXRoKFNLLCA6c2spJyxcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xuICAgICAgICAgICAgJzpwayc6IFxcYFVTRVIjXFwke3VzZXJJZH1cXGAsXG4gICAgICAgICAgICAnOnNrJzogJ0RFUExPWU1FTlQjJ1xuICAgICAgICB9XG4gICAgfTtcbiAgICBcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9kYi5xdWVyeShwYXJhbXMpLnByb21pc2UoKTtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgIGhlYWRlcnM6IHsgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRlcGxveW1lbnRzOiByZXN1bHQuSXRlbXMgfSlcbiAgICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVEZXBsb3ltZW50KHVzZXJJZCwgZGVwbG95bWVudCkge1xuICAgIGNvbnN0IGRlcGxveW1lbnRJZCA9IHJlcXVpcmUoJ2NyeXB0bycpLnJhbmRvbVVVSUQoKTtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgXG4gICAgY29uc3QgaXRlbSA9IHtcbiAgICAgICAgUEs6IFxcYFVTRVIjXFwke3VzZXJJZH1cXGAsXG4gICAgICAgIFNLOiBcXGBERVBMT1lNRU5UI1xcJHtkZXBsb3ltZW50SWR9XFxgLFxuICAgICAgICBFbnRpdHlUeXBlOiAnRGVwbG95bWVudCcsXG4gICAgICAgIERlcGxveW1lbnRJZDogZGVwbG95bWVudElkLFxuICAgICAgICBOYW1lOiBkZXBsb3ltZW50Lm5hbWUsXG4gICAgICAgIERlc2NyaXB0aW9uOiBkZXBsb3ltZW50LmRlc2NyaXB0aW9uLFxuICAgICAgICBTdGF0dXM6ICdDUkVBVElORycsXG4gICAgICAgIENyZWF0ZWRBdDogdGltZXN0YW1wLFxuICAgICAgICBVcGRhdGVkQXQ6IHRpbWVzdGFtcCxcbiAgICAgICAgLi4uZGVwbG95bWVudFxuICAgIH07XG4gICAgXG4gICAgYXdhaXQgZHluYW1vZGIucHV0KHtcbiAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXG4gICAgICAgIEl0ZW06IGl0ZW1cbiAgICB9KS5wcm9taXNlKCk7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogMjAxLFxuICAgICAgICBoZWFkZXJzOiB7ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoaXRlbSlcbiAgICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVEZXBsb3ltZW50KHVzZXJJZCwgZGVwbG95bWVudElkLCB1cGRhdGVzKSB7XG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIFxuICAgIGNvbnN0IHBhcmFtcyA9IHtcbiAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXG4gICAgICAgIEtleToge1xuICAgICAgICAgICAgUEs6IFxcYFVTRVIjXFwke3VzZXJJZH1cXGAsXG4gICAgICAgICAgICBTSzogXFxgREVQTE9ZTUVOVCNcXCR7ZGVwbG95bWVudElkfVxcYFxuICAgICAgICB9LFxuICAgICAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUIFVwZGF0ZWRBdCA9IDp0aW1lc3RhbXAnLFxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgICAnOnRpbWVzdGFtcCc6IHRpbWVzdGFtcFxuICAgICAgICB9LFxuICAgICAgICBSZXR1cm5WYWx1ZXM6ICdBTExfTkVXJ1xuICAgIH07XG4gICAgXG4gICAgLy8gQWRkIHVwZGF0ZSBleHByZXNzaW9ucyBmb3IgZWFjaCBmaWVsZFxuICAgIE9iamVjdC5rZXlzKHVwZGF0ZXMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgaWYgKGtleSAhPT0gJ1BLJyAmJiBrZXkgIT09ICdTSycpIHtcbiAgICAgICAgICAgIHBhcmFtcy5VcGRhdGVFeHByZXNzaW9uICs9IFxcYCwgXFwke2tleX0gPSA6XFwke2tleX1cXGA7XG4gICAgICAgICAgICBwYXJhbXMuRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlc1tcXGA6XFwke2tleX1cXGBdID0gdXBkYXRlc1trZXldO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vZGIudXBkYXRlKHBhcmFtcykucHJvbWlzZSgpO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgaGVhZGVyczogeyAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3VsdC5BdHRyaWJ1dGVzKVxuICAgIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRlbGV0ZURlcGxveW1lbnQodXNlcklkLCBkZXBsb3ltZW50SWQpIHtcbiAgICBhd2FpdCBkeW5hbW9kYi5kZWxldGUoe1xuICAgICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcbiAgICAgICAgS2V5OiB7XG4gICAgICAgICAgICBQSzogXFxgVVNFUiNcXCR7dXNlcklkfVxcYCxcbiAgICAgICAgICAgIFNLOiBcXGBERVBMT1lNRU5UI1xcJHtkZXBsb3ltZW50SWR9XFxgXG4gICAgICAgIH1cbiAgICB9KS5wcm9taXNlKCk7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogMjA0LFxuICAgICAgICBoZWFkZXJzOiB7ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicgfSxcbiAgICAgICAgYm9keTogJydcbiAgICB9O1xufVxuICAgICAgYCksXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBNQUlOX1RBQkxFX05BTUU6IHRoaXMubWFpblRhYmxlLnRhYmxlTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gTW9kZWwgSW5mbyBMYW1iZGFcbiAgICB0aGlzLm1vZGVsSW5mb0xhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ01vZGVsSW5mb0xhbWJkYScsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUlubGluZShgXG5jb25zdCBBV1MgPSByZXF1aXJlKCdhd3Mtc2RrJyk7XG5jb25zdCBiZWRyb2NrID0gbmV3IEFXUy5CZWRyb2NrKCk7XG5cbmV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIChldmVudCwgY29udGV4dCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IGJlZHJvY2subGlzdEZvdW5kYXRpb25Nb2RlbHMoKS5wcm9taXNlKCk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBzdXBwb3J0ZWRNb2RlbHMgPSBtb2RlbHMubW9kZWxTdW1tYXJpZXNcbiAgICAgICAgICAgIC5maWx0ZXIobW9kZWwgPT4gbW9kZWwubW9kZWxJZC5pbmNsdWRlcygnY2xhdWRlJykgfHwgbW9kZWwubW9kZWxJZC5pbmNsdWRlcygndGl0YW4nKSlcbiAgICAgICAgICAgIC5tYXAobW9kZWwgPT4gKHtcbiAgICAgICAgICAgICAgICBtb2RlbElkOiBtb2RlbC5tb2RlbElkLFxuICAgICAgICAgICAgICAgIG1vZGVsTmFtZTogbW9kZWwubW9kZWxOYW1lLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyTmFtZTogbW9kZWwucHJvdmlkZXJOYW1lLFxuICAgICAgICAgICAgICAgIGlucHV0TW9kYWxpdGllczogbW9kZWwuaW5wdXRNb2RhbGl0aWVzLFxuICAgICAgICAgICAgICAgIG91dHB1dE1vZGFsaXRpZXM6IG1vZGVsLm91dHB1dE1vZGFsaXRpZXNcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicgfSxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbW9kZWxzOiBzdXBwb3J0ZWRNb2RlbHMgfSlcbiAgICAgICAgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvcjonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicgfSxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSlcbiAgICAgICAgfTtcbiAgICB9XG59O1xuICAgICAgYCksXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMiksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBNQUlOX1RBQkxFX05BTUU6IHRoaXMubWFpblRhYmxlLnRhYmxlTmFtZVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVDb2duaXRvUmVzb3VyY2VzKGFkbWluRW1haWw/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICAvLyBVc2VyIFBvb2wgd2l0aCBzZWxmLXJlZ2lzdHJhdGlvbiBlbmFibGVkXG4gICAgdGhpcy51c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdVc2VyUG9vbCcsIHtcbiAgICAgIHVzZXJQb29sTmFtZTogYCR7dGhpcy5zdGFja05hbWV9LVVzZXJQb29sYCxcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLCAvLyBFbmFibGUgc2VsZi1yZWdpc3RyYXRpb25cbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgZW1haWw6IHRydWVcbiAgICAgIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7XG4gICAgICAgIGVtYWlsOiB0cnVlXG4gICAgICB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsIC8vIE1ha2UgaXQgZWFzaWVyIGZvciB1c2Vyc1xuICAgICAgICB0ZW1wUGFzc3dvcmRWYWxpZGl0eTogY2RrLkR1cmF0aW9uLmRheXMoNylcbiAgICAgIH0sXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgLy8gRW1haWwgY29uZmlndXJhdGlvbiBmb3IgdmVyaWZpY2F0aW9uXG4gICAgICB1c2VyVmVyaWZpY2F0aW9uOiB7XG4gICAgICAgIGVtYWlsU3ViamVjdDogJ1dlbGNvbWUgdG8gR2VuZXJhdGl2ZSBBSSBBcHBsaWNhdGlvbiBCdWlsZGVyIC0gVmVyaWZ5IHlvdXIgZW1haWwnLFxuICAgICAgICBlbWFpbEJvZHk6ICdXZWxjb21lIHRvIEdlbmVyYXRpdmUgQUkgQXBwbGljYXRpb24gQnVpbGRlciEgUGxlYXNlIGNsaWNrIHRoZSBsaW5rIGJlbG93IHRvIHZlcmlmeSB5b3VyIGVtYWlsIGFkZHJlc3M6IHsjI1ZlcmlmeSBFbWFpbCMjfScsXG4gICAgICAgIGVtYWlsU3R5bGU6IGNvZ25pdG8uVmVyaWZpY2F0aW9uRW1haWxTdHlsZS5MSU5LXG4gICAgICB9LFxuICAgICAgLy8gU3RhbmRhcmQgYXR0cmlidXRlc1xuICAgICAgc3RhbmRhcmRBdHRyaWJ1dGVzOiB7XG4gICAgICAgIGVtYWlsOiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBnaXZlbk5hbWU6IHtcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBmYW1pbHlOYW1lOiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIG11dGFibGU6IHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gVXNlciBQb29sIENsaWVudCB3aXRoIEhvc3RlZCBVSSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy51c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdVc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLFxuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIGFkbWluVXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgICBjdXN0b206IHRydWUsXG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgdXNlclNycDogdHJ1ZVxuICAgICAgfSxcbiAgICAgIG9BdXRoOiB7XG4gICAgICAgIGZsb3dzOiB7XG4gICAgICAgICAgYXV0aG9yaXphdGlvbkNvZGVHcmFudDogdHJ1ZSxcbiAgICAgICAgICBpbXBsaWNpdENvZGVHcmFudDogdHJ1ZSAvLyBFbmFibGUgZm9yIGhvc3RlZCBVSVxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLk9QRU5JRCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuUFJPRklMRSxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuQ09HTklUT19BRE1JTlxuICAgICAgICBdLFxuICAgICAgICBjYWxsYmFja1VybHM6IFtcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo1MTczJyxcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo1MTc0J1xuICAgICAgICBdLFxuICAgICAgICBsb2dvdXRVcmxzOiBbXG4gICAgICAgICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsXG4gICAgICAgICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3NCdcbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIHJlZnJlc2hUb2tlblZhbGlkaXR5OiBjZGsuRHVyYXRpb24uZGF5cygzNjUwKSwgLy8gTWF4aW11bTogMTAgeWVhcnNcbiAgICAgIGFjY2Vzc1Rva2VuVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5ob3VycygyNCksIC8vIE1heGltdW06IDI0IGhvdXJzXG4gICAgICBpZFRva2VuVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5ob3VycygyNCksIC8vIE1heGltdW06IDI0IGhvdXJzXG4gICAgICAvLyBFbmFibGUgSG9zdGVkIFVJIGZlYXR1cmVzXG4gICAgICBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVyczogW1xuICAgICAgICBjb2duaXRvLlVzZXJQb29sQ2xpZW50SWRlbnRpdHlQcm92aWRlci5DT0dOSVRPXG4gICAgICBdXG4gICAgfSk7XG5cbiAgICAvLyBVc2VyIFBvb2wgRG9tYWluXG4gICAgdGhpcy51c2VyUG9vbERvbWFpbiA9IG5ldyBjb2duaXRvLlVzZXJQb29sRG9tYWluKHRoaXMsICdVc2VyUG9vbERvbWFpbicsIHtcbiAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxuICAgICAgY29nbml0b0RvbWFpbjoge1xuICAgICAgICBkb21haW5QcmVmaXg6IGAke3RoaXMuc3RhY2tOYW1lLnRvTG93ZXJDYXNlKCl9LSR7Y2RrLkF3cy5BQ0NPVU5UX0lEfWBcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQXBpR2F0ZXdheSgpOiB2b2lkIHtcbiAgICAvLyBSRVNUIEFQSVxuICAgIHRoaXMuYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1BUElgLFxuICAgICAgZGVzY3JpcHRpb246ICdDb25zb2xpZGF0ZWQgR2VuZXJhdGl2ZSBBSSBBcHBsaWNhdGlvbiBCdWlsZGVyIEFQSScsXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcbiAgICAgICAgICAnQ29udGVudC1UeXBlJyxcbiAgICAgICAgICAnWC1BbXotRGF0ZScsXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nLFxuICAgICAgICAgICdYLUFwaS1LZXknLFxuICAgICAgICAgICdYLUFtei1TZWN1cml0eS1Ub2tlbidcbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgc3RhZ2VOYW1lOiAncHJvZCcsXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgZGF0YVRyYWNlRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbWV0cmljc0VuYWJsZWQ6IHRydWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gQXV0aG9yaXplclxuICAgIGNvbnN0IGF1dGhvcml6ZXIgPSBuZXcgYXBpZ2F0ZXdheS5Db2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCAnQXBpQXV0aG9yaXplcicsIHtcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt0aGlzLnVzZXJQb29sXSxcbiAgICAgIGlkZW50aXR5U291cmNlOiAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLkF1dGhvcml6YXRpb24nXG4gICAgfSk7XG5cbiAgICAvLyBDaGF0IGVuZHBvaW50c1xuICAgIGNvbnN0IGNoYXRSZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2NoYXQnKTtcbiAgICBjaGF0UmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odGhpcy5jaGF0TGFtYmRhKSwge1xuICAgICAgYXV0aG9yaXplcjogYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICB9KTtcblxuICAgIC8vIERlcGxveW1lbnQgZW5kcG9pbnRzXG4gICAgY29uc3QgZGVwbG95bWVudHNSZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2RlcGxveW1lbnRzJyk7XG4gICAgZGVwbG95bWVudHNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuZGVwbG95bWVudExhbWJkYSksIHtcbiAgICAgIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgfSk7XG4gICAgZGVwbG95bWVudHNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih0aGlzLmRlcGxveW1lbnRMYW1iZGEpLCB7XG4gICAgICBhdXRob3JpemVyOiBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgY29uc3QgZGVwbG95bWVudFJlc291cmNlID0gZGVwbG95bWVudHNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xuICAgIGRlcGxveW1lbnRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuZGVwbG95bWVudExhbWJkYSksIHtcbiAgICAgIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgfSk7XG4gICAgZGVwbG95bWVudFJlc291cmNlLmFkZE1ldGhvZCgnUFVUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odGhpcy5kZXBsb3ltZW50TGFtYmRhKSwge1xuICAgICAgYXV0aG9yaXplcjogYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICB9KTtcbiAgICBkZXBsb3ltZW50UmVzb3VyY2UuYWRkTWV0aG9kKCdERUxFVEUnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih0aGlzLmRlcGxveW1lbnRMYW1iZGEpLCB7XG4gICAgICBhdXRob3JpemVyOiBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgLy8gTW9kZWwgaW5mbyBlbmRwb2ludHNcbiAgICBjb25zdCBtb2RlbHNSZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ21vZGVscycpO1xuICAgIG1vZGVsc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odGhpcy5tb2RlbEluZm9MYW1iZGEpLCB7XG4gICAgICBhdXRob3JpemVyOiBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVDbG91ZEZyb250RGlzdHJpYnV0aW9uKCk6IHZvaWQge1xuICAgIC8vIE9yaWdpbiBBY2Nlc3MgSWRlbnRpdHkgZm9yIFMzXG4gICAgY29uc3Qgb2FpID0gbmV3IGNsb3VkZnJvbnQuT3JpZ2luQWNjZXNzSWRlbnRpdHkodGhpcywgJ09BSScsIHtcbiAgICAgIGNvbW1lbnQ6IGBPQUkgZm9yICR7dGhpcy5zdGFja05hbWV9YFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgQ2xvdWRGcm9udCBhY2Nlc3MgdG8gUzMgYnVja2V0XG4gICAgdGhpcy53ZWJCdWNrZXQuZ3JhbnRSZWFkKG9haSk7XG5cbiAgICAvLyBDbG91ZEZyb250IERpc3RyaWJ1dGlvblxuICAgIHRoaXMuZGlzdHJpYnV0aW9uID0gbmV3IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKHRoaXMsICdEaXN0cmlidXRpb24nLCB7XG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbih0aGlzLndlYkJ1Y2tldCwge1xuICAgICAgICAgIG9yaWdpbkFjY2Vzc0lkZW50aXR5OiBvYWlcbiAgICAgICAgfSksXG4gICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRCxcbiAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICBjb21wcmVzczogdHJ1ZVxuICAgICAgfSxcbiAgICAgIGFkZGl0aW9uYWxCZWhhdmlvcnM6IHtcbiAgICAgICAgJy9wcm9kLyonOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5SZXN0QXBpT3JpZ2luKHRoaXMuYXBpKSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXG4gICAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkFMTF9WSUVXRVJcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGRlZmF1bHRSb290T2JqZWN0OiAnaW5kZXguaHRtbCcsXG4gICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaHR0cFN0YXR1czogNDA0LFxuICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCdcbiAgICAgICAgfVxuICAgICAgXSxcbiAgICAgIHByaWNlQ2xhc3M6IGNsb3VkZnJvbnQuUHJpY2VDbGFzcy5QUklDRV9DTEFTU18xMDAsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgY29tbWVudDogYCR7dGhpcy5zdGFja05hbWV9IENsb3VkRnJvbnQgRGlzdHJpYnV0aW9uYFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTU01QYXJhbWV0ZXJzKCk6IHZvaWQge1xuICAgIC8vIFdlYiBjb25maWd1cmF0aW9uIHBhcmFtZXRlclxuICAgIGNvbnN0IHdlYkNvbmZpZyA9IHtcbiAgICAgIEFwaUVuZHBvaW50OiB0aGlzLmFwaS51cmwsXG4gICAgICBJc0ludGVybmFsVXNlcjogJ2ZhbHNlJyxcbiAgICAgIENvZ25pdG9SZWRpcmVjdFVybDogYGh0dHBzOi8vJHt0aGlzLmRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICBVc2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBVc2VyUG9vbENsaWVudElkOiB0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBBd3NSZWdpb246IHRoaXMucmVnaW9uLFxuICAgICAgQ29nbml0b0RvbWFpbjogYCR7dGhpcy51c2VyUG9vbERvbWFpbi5kb21haW5OYW1lfS5hdXRoLiR7dGhpcy5yZWdpb259LmFtYXpvbmNvZ25pdG8uY29tYFxuICAgIH07XG5cbiAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnV2ViQ29uZmlnUGFyYW1ldGVyJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYC9nYWFiLXdlYmNvbmZpZy8ke3RoaXMuc3RhY2tOYW1lfWAsXG4gICAgICBzdHJpbmdWYWx1ZTogSlNPTi5zdHJpbmdpZnkod2ViQ29uZmlnKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnV2ViIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBHZW5lcmF0aXZlIEFJIEFwcGxpY2F0aW9uIEJ1aWxkZXInLFxuICAgICAgdHlwZTogc3NtLlBhcmFtZXRlclR5cGUuU1RSSU5HXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZU91dHB1dHMoKTogdm9pZCB7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnRXZWJVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt0aGlzLmRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIFVSTCdcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZXN0RW5kcG9pbnRVcmwnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcGkudXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdSRVNUIEFQSSBFbmRwb2ludCBVUkwnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29nbml0b0NsaWVudElkJywge1xuICAgICAgdmFsdWU6IHRoaXMudXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ01haW5UYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5tYWluVGFibGUudGFibGVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdNYWluIER5bmFtb0RCIFRhYmxlIE5hbWUnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2ViQ29uZmlnS2V5Jywge1xuICAgICAgdmFsdWU6IGAvZ2FhYi13ZWJjb25maWcvJHt0aGlzLnN0YWNrTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdTU00gUGFyYW1ldGVyIGtleSBmb3Igd2ViIGNvbmZpZ3VyYXRpb24nXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIElEJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvZ25pdG9Eb21haW4nLCB7XG4gICAgICB2YWx1ZTogYCR7dGhpcy51c2VyUG9vbERvbWFpbi5kb21haW5OYW1lfS5hdXRoLiR7dGhpcy5yZWdpb259LmFtYXpvbmNvZ25pdG8uY29tYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBEb21haW4nXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==