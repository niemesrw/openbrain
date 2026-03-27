import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import * as path from "path";

interface ApiStackProps extends cdk.StackProps {
  vectorBucketName: string;
  userPool: cognito.UserPool;
  webClient: cognito.UserPoolClient;
  cliClient: cognito.UserPoolClient;
  agentKeysTable: dynamodb.Table;
  usersTable: dynamodb.Table;
  agentTasksTable: dynamodb.Table;
  dcrClientsTable: dynamodb.Table;
  customDomain?: string;
  alarmEmail?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigwv2.HttpApi;
  public readonly handler: lambdaNode.NodejsFunction;
  public readonly apiEndpointHostname: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      vectorBucketName,
      userPool,
      webClient,
      cliClient,
      agentKeysTable,
      usersTable,
      agentTasksTable,
      dcrClientsTable,
      customDomain,
      alarmEmail,
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
        AGENT_TASKS_TABLE: agentTasksTable.tableName,
        USER_POOL_ID: userPool.userPoolId,
        ...(customDomain && { CUSTOM_DOMAIN: customDomain }),
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
    agentTasksTable.grantReadWriteData(this.handler);

    // Chat handler Lambda (LLM + brain tools via Bedrock Converse)
    const chatHandler = new lambdaNode.NodejsFunction(this, "ChatHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "chat.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        CHAT_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AGENT_KEYS_TABLE: agentKeysTable.tableName,
        USERS_TABLE: usersTable.tableName,
        AGENT_TASKS_TABLE: agentTasksTable.tableName,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    // Chat handler needs same permissions as MCP handler
    chatHandler.addToRolePolicy(
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
    chatHandler.addToRolePolicy(
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
    agentKeysTable.grantReadWriteData(chatHandler);
    usersTable.grantReadData(chatHandler);
    agentTasksTable.grantReadWriteData(chatHandler);

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
        // Kept to preserve cross-stack CloudFormation references from auth stack.
        // The verifier no longer checks these — it accepts any client in the pool.
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
        identitySource: [], // Intentionally empty to support either JWT-only or API-key-only requests, and to avoid API Gateway requiring multiple identity headers (which would also affect cache key behavior if caching is re-enabled).
        resultsCacheTtl: cdk.Duration.seconds(0),
      }
    );

    // HTTP API
    this.api = new apigwv2.HttpApi(this, "BrainApi", {
      apiName: "open-brain-mcp",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      },
    });

    const integration = new apigwv2Integrations.HttpLambdaIntegration(
      "McpIntegration",
      this.handler
    );

    // MCP route — auth handled in-Lambda (returns 401 + WWW-Authenticate for OAuth discovery)
    this.api.addRoutes({
      path: "/mcp",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET],
      integration,
    });

    // Chat route (LLM + brain tools)
    const chatIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "ChatIntegration",
      chatHandler,
    );
    this.api.addRoutes({
      path: "/chat",
      methods: [apigwv2.HttpMethod.POST],
      integration: chatIntegration,
      authorizer,
    });

    // OAuth handler Lambda (discovery, authorization proxy, DCR)
    const oauthHandler = new lambdaNode.NodejsFunction(this, "OAuthHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "oauth.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        REGION: this.region,
        DCR_CLIENTS_TABLE: dcrClientsTable.tableName,
        ...(customDomain && { CUSTOM_DOMAIN: customDomain }),
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    // OAuth Lambda needs to create Cognito app clients (DCR)
    oauthHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:CreateUserPoolClient",
          "cognito-idp:DescribeUserPoolClient",
        ],
        resources: [userPool.userPoolArn],
      })
    );
    dcrClientsTable.grantReadWriteData(oauthHandler);

    const oauthIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "OAuthIntegration",
      oauthHandler,
    );

    // OAuth discovery + proxy routes (no auth required)
    this.api.addRoutes({
      path: "/.well-known/oauth-protected-resource",
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/.well-known/oauth-authorization-server",
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/oauth/authorize",
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/oauth/token",
      methods: [apigwv2.HttpMethod.POST],
      integration: oauthIntegration,
    });
    this.api.addRoutes({
      path: "/register",
      methods: [apigwv2.HttpMethod.POST],
      integration: oauthIntegration,
    });

    // Background agent runner (scheduled hourly)
    const agentRunner = new lambdaNode.NodejsFunction(this, "AgentRunner", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "..", "..", "..", "lambda", "src", "agent-runner.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        VECTOR_BUCKET_NAME: vectorBucketName,
        EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
        METADATA_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        CHAT_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        AGENT_TASKS_TABLE: agentTasksTable.tableName,
      },
      bundling: {
        externalModules: ["@aws-sdk/*"],
        minify: true,
        sourceMap: true,
      },
    });

    agentTasksTable.grantReadWriteData(agentRunner);

    agentRunner.addToRolePolicy(
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
    agentRunner.addToRolePolicy(
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

    new events.Rule(this, "AgentRunnerSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: "Triggers the background agent runner every 5 minutes",
      targets: [new targets.LambdaFunction(agentRunner)],
    });

    // CloudWatch alarm + SNS alert on agent runner errors
    const alarmTopic = new sns.Topic(this, "AgentRunnerAlarmTopic", {
      displayName: "Open Brain Agent Runner Errors",
    });
    if (alarmEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alarmEmail));
    }
    new cloudwatch.Alarm(this, "AgentRunnerErrorAlarm", {
      alarmName: "openbrain-agent-runner-errors",
      alarmDescription: "Agent runner Lambda is throwing errors",
      metric: agentRunner.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cwActions.SnsAction(alarmTopic));

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.apiEndpoint,
      exportName: "BrainApiUrl",
    });

    this.apiEndpointHostname = cdk.Fn.select(2, cdk.Fn.split("/", this.api.apiEndpoint));
  }
}
