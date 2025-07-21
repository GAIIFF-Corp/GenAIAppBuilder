import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface ConsolidatedStackProps extends cdk.StackProps {
  adminEmail?: string;
  allowedOrigins?: string[];
}

/**
 * Consolidated Generative AI Application Builder Stack
 * This stack combines all functionality into a single CloudFormation template
 * with a single DynamoDB table for all data storage needs.
 */
export class ConsolidatedStack extends cdk.Stack {
  // Core Infrastructure
  public mainTable: dynamodb.Table;
  public webBucket: s3.Bucket;
  public accessLogsBucket: s3.Bucket;
  public distribution: cloudfront.Distribution;
  
  // Authentication
  public userPool: cognito.UserPool;
  public userPoolClient: cognito.UserPoolClient;
  public userPoolDomain: cognito.UserPoolDomain;
  
  // API and Lambda
  public api: apigateway.RestApi;
  public chatLambda: lambda.Function;
  public deploymentLambda: lambda.Function;
  public modelInfoLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: ConsolidatedStackProps = {}) {
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

  private createMainTable(): void {
    this.mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: `${this.stackName}-MainTable`,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'PK', // Partition Key
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'SK', // Sort Key
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

  private createS3Resources(): void {
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

  private createLambdaFunctions(): void {
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

  private createCognitoResources(adminEmail?: string): void {
    // User Pool with self-registration enabled
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${this.stackName}-UserPool`,
      selfSignUpEnabled: true, // Enable self-registration
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
        requireSymbols: false, // Make it easier for users
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
          'http://localhost:5174',
          'http://localhost:5175',
          'https://dh1h6woy104ss.cloudfront.net'
        ],
        logoutUrls: [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
          'https://dh1h6woy104ss.cloudfront.net'
        ]
      },
      refreshTokenValidity: cdk.Duration.days(3650), // Maximum: 10 years
      accessTokenValidity: cdk.Duration.hours(24), // Maximum: 24 hours
      idTokenValidity: cdk.Duration.hours(24), // Maximum: 24 hours
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

  private createApiGateway(): void {
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

  private createCloudFrontDistribution(): void {
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

  private createSSMParameters(): void {
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

  private createOutputs(): void {
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
