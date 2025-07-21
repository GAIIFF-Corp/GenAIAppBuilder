import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
export declare class ConsolidatedStack extends cdk.Stack {
    mainTable: dynamodb.Table;
    webBucket: s3.Bucket;
    accessLogsBucket: s3.Bucket;
    distribution: cloudfront.Distribution;
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    userPoolDomain: cognito.UserPoolDomain;
    api: apigateway.RestApi;
    chatLambda: lambda.Function;
    deploymentLambda: lambda.Function;
    modelInfoLambda: lambda.Function;
    constructor(scope: Construct, id: string, props?: ConsolidatedStackProps);
    private createMainTable;
    private createS3Resources;
    private createLambdaFunctions;
    private createCognitoResources;
    private createApiGateway;
    private createCloudFrontDistribution;
    private createSSMParameters;
    private createOutputs;
}
