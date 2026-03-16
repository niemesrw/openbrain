import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

interface ApiStackProps extends cdk.StackProps {
  vectorBucketName: string;
  userPool: cognito.UserPool;
  webClient: cognito.UserPoolClient;
  cliClient: cognito.UserPoolClient;
  agentKeysTable: dynamodb.Table;
  usersTable: dynamodb.Table;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigwv2.HttpApi;
  public readonly handler: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      vectorBucketName,
      userPool,
      webClient,
      cliClient,
      agentKeysTable,
      usersTable,
    } = props;

    // Main MCP handler Lambda
    this.handler = new lambdaNode.NodejsFunction(this, "McpHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "index.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AGENT_KEYS_TABLE: agentKeysTable.tableName,
        USERS_TABLE: usersTable.tableName,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    // S3 Vectors permissions
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "s3vectors:CreateIndex",
          "s3vectors:QueryVectors",
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:ListVectors",
          "s3vectors:ListIndexes",
        ],
        resources: [
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}`,
          `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/*`,
        ],
      })
    );

    // Bedrock permissions
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    // DynamoDB permissions for main handler
    agentKeysTable.grantReadWriteData(this.handler);
    usersTable.grantReadData(this.handler);

    // Custom Lambda authorizer (supports both JWT and API key)
    const authorizerFn = new lambdaNode.NodejsFunction(this, "AuthorizerFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        __dirname,
        "..",
        "..",
        "..",
        "lambda",
        "src",
        "auth",
        "authorizer.ts"
      ),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        REGION: this.region,
        AGENT_KEYS_TABLE: agentKeysTable.tableName,
        CLI_CLIENT_ID: cliClient.userPoolClientId,
        WEB_CLIENT_ID: webClient.userPoolClientId,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Authorizer needs to read agent keys for API key validation
    agentKeysTable.grantReadData(authorizerFn);

    const authorizer = new apigwv2Authorizers.HttpLambdaAuthorizer(
      "BrainAuthorizer",
      authorizerFn,
      {
        authorizerName: "brain-custom-authorizer",
        responseTypes: [
          apigwv2Authorizers.HttpLambdaResponseType.SIMPLE,
        ],
        identitySource: [
          "$request.header.Authorization",
          "$request.header.x-api-key",
        ],
        resultsCacheTtl: cdk.Duration.seconds(0),
      }
    );

    // HTTP API
    this.api = new apigwv2.HttpApi(this, "BrainApi", {
      apiName: "open-brain-mcp",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.GET],
        allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      },
    });

    const integration = new apigwv2Integrations.HttpLambdaIntegration(
      "McpIntegration",
      this.handler
    );

    // Authenticated route
    this.api.addRoutes({
      path: "/mcp",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });

    // Health check (no auth)
    this.api.addRoutes({
      path: "/mcp",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.apiEndpoint,
      exportName: "BrainApiUrl",
    });
  }
}
