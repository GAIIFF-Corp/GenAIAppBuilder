#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ConsolidatedStack } from '../lib/consolidated-stack';

const app = new cdk.App();

// Get configuration from context or environment variables
const stackName = app.node.tryGetContext('stackName') || process.env.STACK_NAME || 'GAIIFFGenAIBuilder';

new ConsolidatedStack(app, stackName, {
  description: 'Consolidated Generative AI Application Builder - Single Stack Architecture with Self-Registration',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  }
});

app.synth();
